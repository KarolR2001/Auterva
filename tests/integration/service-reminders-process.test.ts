import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { processDueReminders } from "../../src/modules/reminders/deliver";
import { lockReminderCompany, reconcileReminders } from "../../src/modules/reminders/reconcile";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const organizationId = randomUUID();
const userId = randomUUID();
const email = `reminder-process-${organizationId}@example.test`;
const children = new Set<ChildProcess>();

afterAll(async () => {
  for (const child of children) child.kill("SIGKILL");
  // The real worker sweeps every company, including the seeded fixture ones; leave no reminder residue there.
  await db.job.deleteMany({ where: { kind: "MAIL_REMINDER", organizationId: { in: [...FIXTURE.organizations] } } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: [...FIXTURE.organizations] } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: [...FIXTURE.organizations] } } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

function startWorker(): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/worker.ts"], {
    cwd: process.cwd(), env: { ...process.env, MAIL_PAYLOAD_KEY: key.toString("hex"),
      MAIL_ENVIRONMENT: "development", MAIL_PROVIDER: "sink", MAIL_ALLOWED_RECIPIENTS: email },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test("two real worker processes and a restart deliver a due reminder exactly once per channel", async () => {
  const registered = new Date(Date.now() - 24 * 60 * 60_000);
  await db.organization.create({ data: { id: organizationId, slug: `rem-proc-${organizationId.slice(0, 8)}`,
    firstAdminRegisteredAt: registered } });
  await db.user.create({ data: { id: userId, name: "Process admin", email, role: "ADMIN_FIRMY",
    organizationId, emailVerified: true, twoFactorEnabled: true } });
  await db.hostMapping.create({ data: { hostname: `rem-proc-${organizationId}.example.test`,
    area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  // Far-future payment so the whole series is planned; the -7 slot is then made due (clock is real here).
  await db.serviceAccess.create({ data: { organizationId, periodVersion: 1, paidThrough: new Date("2099-06-30T00:00:00.000Z") } });
  await db.$transaction(async (tx) => {
    await lockReminderCompany(tx, organizationId);
    await reconcileReminders(tx, organizationId, { now: new Date(), loadKey: () => key });
  });
  await db.reminderIntent.updateMany({ where: { organizationId, offsetDays: 7 },
    data: { slotAt: new Date(Date.now() - 1_000) } });
  const first = startWorker();
  const second = startWorker();
  await waitFor(async () => (await db.reminderIntent.count({ where: { organizationId, offsetDays: 7,
    status: "DELIVERED" } })) === 2, "both channels delivered");
  first.kill("SIGTERM");
  second.kill("SIGTERM");
  await Promise.all([once(first, "close"), once(second, "close")]);
  const jobs = await db.job.findMany({ where: { organizationId } });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ status: "SENT", attempts: 1, providerId: `sink:${jobs[0].id}` });
  // Restart: the delivered key is final; a new worker and a direct sweep add nothing.
  const third = startWorker();
  await waitFor(async () => { await processDueReminders(db, new Date(), key, [organizationId]); return true; }, "restart sweep");
  third.kill("SIGTERM");
  await once(third, "close");
  expect(await db.job.count({ where: { organizationId } })).toBe(1);
  expect(await db.reminderIntent.count({ where: { organizationId, status: "DELIVERED" } })).toBe(2);
  expect(await db.reminderIntent.count({ where: { organizationId, offsetDays: { in: [1, 0] }, status: "PENDING" } })).toBe(4);
});
