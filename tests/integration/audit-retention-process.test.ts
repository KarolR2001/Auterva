import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { scheduleAuditRetention } from "../../src/modules/audit/retention";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const children = new Set<ChildProcess>();
const auditIds: string[] = [];
let jobId: string;

afterAll(async () => {
  for (const child of children) child.kill("SIGKILL");
  if (jobId) {
    await db.auditRetentionManifest.deleteMany({ where: { jobId } });
    await db.job.deleteMany({ where: { id: jobId } });
  }
  await db.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  await db.$disconnect();
});

function startWorker(hold = "") {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/audit-retention-process.ts"], {
    cwd: process.cwd(), env: { ...process.env, TEST_HOLD: hold }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function waitMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Audit worker did not report ${expected}`)); }, 5_000);
    const onMessage = (message: unknown) => {
      if ((message as { event?: string }).event === expected) { cleanup(); resolve(); }
    };
    const onClose = () => { cleanup(); reject(new Error(`Audit worker closed before ${expected}`)); };
    const cleanup = () => { clearTimeout(timeout); child.off("message", onMessage); child.off("close", onClose); };
    child.on("message", onMessage);
    child.on("close", onClose);
  });
}

async function waitSent(id: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if ((await db.job.findUnique({ where: { id }, select: { status: true } }))?.status === "SENT") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Audit maintenance job did not finish after restart");
}

test("killed owner and two real worker processes resume one purge without duplicate manifest", async () => {
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    auditIds.push(id);
    await db.auditLog.create({ data: { id, actorId: "fixture:retention-process", actorRole: "OPERATOR",
      action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: randomUUID(),
      requestId: randomUUID(), createdAt: new Date(now.getTime() - 366 * 86_400_000 - i) } });
  }
  const job = await scheduleAuditRetention(db, now);
  jobId = job.id;
  const killed = startWorker("after_claim");
  await waitMessage(killed, "claimed");
  killed.kill("SIGKILL");
  await once(killed, "close");
  const first = startWorker();
  const second = startWorker();
  try {
    await waitSent(job.id);
  } finally {
    first.kill("SIGTERM"); second.kill("SIGTERM");
    await Promise.all([once(first, "close"), once(second, "close")]);
  }
  expect(await db.auditLog.count({ where: { id: { in: auditIds } } })).toBe(0);
  const manifests = await db.auditRetentionManifest.findMany({ where: { jobId: job.id } });
  expect(manifests).toHaveLength(1);
  expect(manifests[0].count).toBe(3);
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);
});
