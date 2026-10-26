import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob, failJob, finishJob, startMailAttempt } from "../../src/modules/jobs/queue";

const first = createPrismaClient(process.env.DATABASE_URL ?? "");
const second = createPrismaClient(process.env.DATABASE_URL ?? "");
const prefix = `fixture:jobs:${randomUUID()}:`;
afterEach(async () => { await first.job.deleteMany({ where: { dedupeKey: { startsWith: prefix } } }); });
afterAll(async () => { await first.$disconnect(); await second.$disconnect(); });

test("two PostgreSQL workers claim one due job only once", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const job = await first.job.create({ data: {
    kind: "RATE_LIMIT_SWEEP", dedupeKey: `${prefix}one`, payload: {}, runAt: new Date("2026-10-26T09:00:00.000Z"),
  } });
  const claims = await Promise.all([claimNextJob(first, now, 30_000), claimNextJob(second, now, 30_000)]);
  const claimed = claims.filter((item) => item !== null);
  expect(claimed).toHaveLength(1);
  expect(claimed[0]).toMatchObject({ id: job.id, attempts: 1, lockedUntil: new Date("2026-10-26T10:00:30.000Z") });
  expect(claimed[0].leaseToken).toMatch(/^[0-9a-f-]{36}$/);
  expect(await first.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RUNNING", attempts: 1 });
});

test("expired lease is reclaimed and stale owner cannot mark delivery", async () => {
  const at = new Date("2026-10-26T10:00:00.000Z");
  const job = await first.job.create({ data: {
    kind: "MAIL_INVITATION", dedupeKey: `${prefix}fence`, payload: {}, runAt: at,
  } });
  const original = await claimNextJob(first, at, 30_000);
  expect(original).not.toBeNull();
  const later = new Date("2026-10-26T10:00:31.000Z");
  const replacement = await claimNextJob(second, later, 30_000);
  expect(replacement?.id).toBe(job.id);
  expect(replacement?.leaseToken).not.toBe(original?.leaseToken);
  expect(await finishJob(first, original!, "SENT", later, "old-provider-id")).toBe(false);
  expect(await finishJob(second, replacement!, "SENT", later, "one-provider-id")).toBe(true);
  expect(await first.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "SENT", providerId: "one-provider-id", attempts: 2, leaseToken: null, lockedUntil: null,
  });
});

test("transient failure backs off and exhausted mail is quarantined", async () => {
  const at = new Date("2026-10-26T10:00:00.000Z");
  const job = await first.job.create({ data: {
    kind: "MAIL_INVITATION", dedupeKey: `${prefix}retry`, payload: {}, runAt: at, maxAttempts: 2,
  } });
  const firstClaim = await claimNextJob(first, at, 30_000);
  expect(await startMailAttempt(first, firstClaim!, at)).toBe(true);
  expect(await failJob(first, firstClaim!, "MAIL_TRANSIENT", at)).toBe(true);
  expect(await first.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "PENDING", runAt: new Date("2026-10-26T10:00:05.000Z"), errorCode: "MAIL_TRANSIENT",
  });
  expect(await claimNextJob(second, new Date("2026-10-26T10:00:04.999Z"), 30_000)).toBeNull();
  const secondClaim = await claimNextJob(second, new Date("2026-10-26T10:00:05.000Z"), 30_000);
  expect(secondClaim?.id).toBe(job.id);
  expect(await startMailAttempt(second, secondClaim!, new Date("2026-10-26T10:00:05.000Z"))).toBe(true);
  expect(await failJob(second, secondClaim!, "MAIL_TRANSIENT", new Date("2026-10-26T10:00:05.000Z"))).toBe(true);
  expect(await first.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "UNCERTAIN", attempts: 2, errorCode: "MAIL_OUTCOME_UNKNOWN", leaseToken: null,
  });
});

test("uncertain provider outcome is retried only inside its 24-hour idempotency window", async () => {
  const at = new Date("2026-10-26T10:00:00.000Z");
  const job = await first.job.create({ data: {
    kind: "MAIL_INVITATION", dedupeKey: `${prefix}uncertain`, payload: { encrypted: "fixture" }, runAt: at,
  } });
  const original = await claimNextJob(first, at, 1_000);
  expect(await startMailAttempt(first, original!, at)).toBe(true);
  const recovered = await claimNextJob(second, new Date("2026-10-26T10:00:02.000Z"), 1_000);
  expect(recovered?.id).toBe(job.id);
  expect(recovered?.leaseToken).not.toBe(original?.leaseToken);
  expect(await claimNextJob(first, new Date("2026-10-27T10:00:01.000Z"), 1_000)).toBeNull();
  expect(await first.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN", attempts: 2,
  });
});

test("restart after the final claimed attempt terminates abandoned jobs", async () => {
  const at = new Date("2026-10-26T10:00:00.000Z");
  const jobs = await Promise.all(["RATE_LIMIT_SWEEP", "MAIL_INVITATION"].map((kind, index) => first.job.create({ data: {
    kind, dedupeKey: `${prefix}abandoned:${kind}`, payload: { encrypted: "fixture" },
    runAt: new Date(at.getTime() + index), maxAttempts: 1,
  } })));
  for (const [index, job] of jobs.entries()) {
    const claim = await claimNextJob(first, new Date(at.getTime() + index), 1_000);
    expect(claim?.id).toBe(job.id);
    if (job.kind.startsWith("MAIL_")) expect(await startMailAttempt(first, claim!, at)).toBe(true);
  }
  expect(await claimNextJob(second, new Date("2026-10-26T10:00:02.000Z"), 1_000)).toBeNull();
  expect(await first.job.findUniqueOrThrow({ where: { id: jobs[0].id } })).toMatchObject({
    status: "FAILED", errorCode: "LEASE_EXHAUSTED", payload: { digest: null },
  });
  expect(await first.job.findUniqueOrThrow({ where: { id: jobs[1].id } })).toMatchObject({
    status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN",
  });
});

test("mail worker leaves unsupported future job kinds untouched", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const media = await first.job.create({ data: { kind: "MEDIA_PROCESS", dedupeKey: `${prefix}media`, payload: {}, runAt: new Date(now.getTime() - 1_000) } });
  const mail = await first.job.create({ data: { kind: "MAIL_REMINDER", dedupeKey: `${prefix}mail`, payload: {}, runAt: now } });
  const claim = await claimNextJob(first, now, 1_000, true);
  expect(claim?.id).toBe(mail.id);
  expect(await first.job.findUniqueOrThrow({ where: { id: media.id } })).toMatchObject({ status: "PENDING", attempts: 0 });
});

test("mail-only recovery leaves an expired non-mail lease and its payload untouched", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const media = await first.job.create({ data: { kind: "MEDIA_PROCESS", dedupeKey: `${prefix}expired-media`,
    payload: { storageKey: "fixture-private-object" }, runAt: now, maxAttempts: 1 } });
  const futureMail = await first.job.create({ data: { kind: "MAIL_FUTURE", dedupeKey: `${prefix}expired-future-mail`,
    payload: { encrypted: "future-consumer" }, runAt: new Date(now.getTime() + 1), maxAttempts: 1 } });
  const mediaClaim = await claimNextJob(first, now, 1_000);
  expect(mediaClaim?.id).toBe(media.id);
  const futureClaim = await claimNextJob(first, new Date(now.getTime() + 1), 1_000);
  expect(futureClaim?.id).toBe(futureMail.id);
  expect(await claimNextJob(second, new Date(now.getTime() + 2_000), 1_000, true)).toBeNull();
  expect(await first.job.findUniqueOrThrow({ where: { id: media.id } })).toMatchObject({
    status: "RUNNING", attempts: 1, payload: { storageKey: "fixture-private-object" },
    leaseToken: mediaClaim!.leaseToken,
  });
  expect(await first.job.findUniqueOrThrow({ where: { id: futureMail.id } })).toMatchObject({
    status: "RUNNING", attempts: 1, payload: { encrypted: "future-consumer" },
    leaseToken: futureClaim!.leaseToken,
  });
});
