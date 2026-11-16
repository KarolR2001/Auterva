import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import type { DomainChecker } from "../../src/modules/domains/checker";
import type { DomainDeps } from "../../src/modules/domains/config";
import { enqueueMail } from "../../src/modules/jobs/outbox";
import { runWorkerLoop } from "../../src/modules/jobs/runner";

/** #417: the worker loop with the periodic domain check. Real loop, real database; only DNS/TLS and the provider are fakes. */
const TEST_TIMEOUT_MS = 60_000;

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const organizationId = randomUUID();
const adminId = randomUUID();
const recipient = `${randomUUID()}@example.test`;
const adminHost = `${randomUUID()}.example.test`;
const customHost = `www.${randomUUID().slice(0, 8)}.klient.example.test`;
// Never-checked domains are taken oldest id first: this id puts the test's own domain at the head of the batch.
const domainId = `00000000-0000-4000-8000-${randomUUID().slice(-12)}`;
const config = { cnameTarget: "edge.auterva.test", reservedBases: ["auterva.test"] };

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `wd-${organizationId}` } });
  await db.hostMapping.create({ data: { organizationId, hostname: adminHost, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, organizationId, name: "Pending admin", email: recipient,
    role: "ADMIN_FIRMY", emailVerified: false } });
  const mapping = await db.hostMapping.create({ data: { organizationId, hostname: customHost, area: "COMPANY_PUBLIC",
    kind: "CUSTOM", status: "ACTIVE" } });
  const at = new Date();
  await db.customDomain.create({ data: { id: domainId, organizationId, hostMappingId: mapping.id, status: "ACTIVE",
    verificationToken: "secret-proof-token", activatedAt: at, ownershipVerifiedAt: at, routingVerifiedAt: at,
    tlsVerifiedAt: at } });
});

afterAll(async () => {
  await db.job.deleteMany({ where: { organizationId } });
  await db.invitation.deleteMany({ where: { organizationId } });
  await db.customDomain.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
}, TEST_TIMEOUT_MS);

async function mailJob() {
  const token = randomUUID();
  const now = new Date();
  await db.invitation.updateMany({ where: { organizationId, revokedAt: null }, data: { revokedAt: now } }); // one pending per recipient
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: recipient,
    issuedHost: adminHost, tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(),
    issuedAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000) } });
  return db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId, recipient,
    referenceId: invitation.id, token, runAt: now }, key));
}

async function waitStatus(id: string, status: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await db.job.findUnique({ where: { id }, select: { status: true } }))?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job did not reach ${status}`);
}

function startLoop(domains: DomainDeps) {
  const controller = new AbortController();
  const done = runWorkerLoop({ db, signal: controller.signal, pollMs: 100, domains,
    context: { key, mode: "development", allowedRecipients: new Set([recipient]),
      provider: { send: async () => ({ kind: "accepted", providerId: "runner-test" }) } } });
  return { controller, done };
}

const domain = () => db.customDomain.findUniqueOrThrow({ where: { organizationId } });

test("a periodic domain check that does not return never holds back mail added meanwhile", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered = () => {};
  const probing = new Promise<void>((resolve) => { entered = resolve; });
  const probed: string[] = [];
  const checker: DomainChecker = {
    async checkOwnership(hostname) {
      entered();
      await gate; // a resolver that hangs
      probed.push(hostname);
      if (hostname !== customHost) throw new Error("not this test's domain"); // never record a result on foreign data
      return { ok: true };
    },
    async checkRouting() { return { ok: true }; },
  };
  const loop = startLoop({ checker, config });
  try {
    await probing; // the domain probe is in flight
    const job = await mailJob(); // mail arrives while it hangs
    await waitStatus(job.id, "SENT");
    expect(probed).toEqual([]); // the probe still has not returned: the mail did not wait for it
    expect((await domain()).checkedAt).toBeNull();
  } finally {
    loop.controller.abort(); // shutdown: the probe in flight may finish, no further domain is started
    release();
    await loop.done;
  }
  expect(probed).toEqual([customHost]);
  expect(await domain()).toMatchObject({ status: "ACTIVE", lastFailureCode: null });
  expect((await domain()).checkedAt).not.toBeNull();
}, TEST_TIMEOUT_MS);

test("without the platform CNAME target the loop checks no domain and records nothing on it", async () => {
  await db.customDomain.update({ where: { organizationId }, data: { checkedAt: null } });
  let calls = 0;
  const checker: DomainChecker = {
    async checkOwnership() { calls += 1; return { ok: true }; },
    async checkRouting() { calls += 1; return { ok: true }; },
  };
  const loop = startLoop({ checker, config: { ...config, cnameTarget: null } });
  try {
    await waitStatus((await mailJob()).id, "SENT"); // the loop ran at least one full pass
  } finally {
    loop.controller.abort();
    await loop.done;
  }
  expect(calls).toBe(0);
  expect(await domain()).toMatchObject({ status: "ACTIVE", checkedAt: null, lastFailureCode: null });
}, TEST_TIMEOUT_MS);
