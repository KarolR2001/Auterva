import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { enqueueMail } from "../../src/modules/jobs/outbox";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const organizationId = randomUUID();
const adminId = randomUUID();
const hostname = `${randomUUID()}.example.test`;
let server: Server;
let providerUrl: string;
const attempts: string[] = [];
const effects = new Map<string, string>();
const children = new Set<ChildProcess>();

afterAll(async () => {
  for (const child of children) child.kill("SIGKILL");
  await db.job.deleteMany({ where: { organizationId } });
  await db.invitation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function setup() {
  if (server) return;
  await db.organization.create({ data: { id: organizationId, slug: `jobs-${organizationId}` } });
  await db.hostMapping.create({ data: { organizationId, hostname, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  server = createServer(async (request, response) => {
    const idempotencyKey = request.headers["idempotency-key"];
    if (request.method !== "POST" || typeof idempotencyKey !== "string") { response.writeHead(400).end(); return; }
    for await (const chunk of request) { void chunk; /* consume before accepting */ }
    attempts.push(idempotencyKey);
    if (!effects.has(idempotencyKey)) effects.set(idempotencyKey, `fixture:${idempotencyKey}`);
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: effects.get(idempotencyKey) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test provider port");
  providerUrl = `http://127.0.0.1:${address.port}/emails`;
}

async function createJob(recipient: string) {
  const now = new Date();
  const token = randomUUID();
  await db.user.upsert({ where: { id: adminId }, create: { id: adminId, organizationId,
    name: "Pending admin", email: recipient, role: "ADMIN_FIRMY", emailVerified: false },
  update: { email: recipient, emailVerified: false } });
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: recipient,
    issuedHost: hostname,
    tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(),
    issuedAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000) } });
  return db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId,
    recipient, referenceId: invitation.id, token, runAt: now }, key));
}

function startWorker(recipient: string, hold = "") {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/job-worker-process.ts"], {
    cwd: process.cwd(), env: { ...process.env, MAIL_PAYLOAD_KEY: key.toString("hex"),
      TEST_PROVIDER_URL: providerUrl, TEST_ALLOWED_RECIPIENT: recipient, TEST_HOLD: hold },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function startActualWorker(recipient: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/worker.ts"], {
    cwd: process.cwd(), env: { ...process.env, MAIL_PAYLOAD_KEY: key.toString("hex"),
      MAIL_ENVIRONMENT: "development", MAIL_PROVIDER: "sink", MAIL_ALLOWED_RECIPIENTS: recipient },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function waitMessage(child: ChildProcess, expected: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Worker did not report ${expected}`)); }, timeoutMs);
    const onMessage = (message: unknown) => {
      if ((message as { event?: string }).event === expected) { cleanup(); resolve(); }
    };
    const onClose = () => { cleanup(); reject(new Error(`Worker closed before ${expected}`)); };
    const cleanup = () => { clearTimeout(timeout); child.off("message", onMessage); child.off("close", onClose); };
    child.on("message", onMessage);
    child.on("close", onClose);
  });
}

async function waitStatus(id: string, status: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await db.job.findUnique({ where: { id }, select: { status: true } }))?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job did not reach ${status}`);
}

test("killed worker after claim and after provider response resumes without duplicate effect", async () => {
  await setup();
  for (const hold of ["after_claim", "after_response"]) {
    const recipient = `${randomUUID()}@example.test`;
    const job = await createJob(recipient);
    const first = startWorker(recipient, hold);
    await waitMessage(first, hold === "after_claim" ? "claimed" : "provider_response");
    first.kill("SIGKILL");
    await once(first, "close");
    const second = startWorker(recipient);
    await waitStatus(job.id, "SENT");
    second.kill("SIGTERM");
    await once(second, "close");
    expect(effects.get(job.id)).toBe(`fixture:${job.id}`);
    expect(attempts.filter((key) => key === job.id)).toHaveLength(hold === "after_claim" ? 1 : 2);
  }
});

test("two actual worker entrypoints claim one job once", async () => {
  await setup();
  const recipient = `${randomUUID()}@example.test`;
  const job = await createJob(recipient);
  const first = startActualWorker(recipient);
  const second = startActualWorker(recipient);
  await waitStatus(job.id, "SENT");
  first.kill("SIGTERM"); second.kill("SIGTERM");
  await Promise.all([once(first, "close"), once(second, "close")]);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "SENT", attempts: 1, providerId: `sink:${job.id}`,
  });
});
