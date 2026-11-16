import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import type { CheckOutcome, DomainChecker } from "../../src/modules/domains/checker";
import { createLaunchDiagnosticsRecheck, RECHECK_LIMIT } from "../../src/modules/domains/diagnostics-recheck";
import { recheckDueDomains, refreshActiveDomain } from "../../src/modules/domains/lifecycle";
import { getLaunchDiagnostics } from "../../src/modules/organizations/launch-diagnostics";
import { ensureControlledFixtureAccess, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
const platformHost = `rc-platform-${randomUUID()}.example.test`;
const host = (label: string) => `www.${label}-${randomUUID().slice(0, 8)}.klient.example.test`;
const config = { cnameTarget: "edge.auterva.test", reservedBases: ["auterva.test"] };
const notAfter = new Date(Date.now() + 90 * 86_400_000);
let platformSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;

const script = { routing: { ok: true, tlsNotAfter: notAfter } as CheckOutcome, throws: false, calls: 0 };
const checker: DomainChecker = {
  async checkOwnership() { script.calls += 1; if (script.throws) throw new Error("boom"); return { ok: true }; },
  async checkRouting() { return script.routing; },
};
const recheck = createLaunchDiagnosticsRecheck(() => ({ checker, config }));
const call = (org: string, init: { cookie?: string; origin?: string | null; body?: object; host?: string } = {}) => {
  const h = init.host ?? platformHost;
  return recheck(new Request(`http://${h}/api/platform/companies/${org}/launch-diagnostics/recheck`, { method: "POST",
    headers: { host: h, cookie: init.cookie ?? platformSession.cookie, "content-type": "application/json",
      ...(init.origin === null ? {} : { origin: init.origin ?? `http://${h}` }) },
    body: JSON.stringify(init.body ?? { eventKey: randomUUID() }) }), org);
};
const domainOf = async (org: string) => (await db.customDomain.findUniqueOrThrow({ where: { organizationId: org } }));

async function addDomain(org: string, status: string, extra: object = {}) {
  const mapping = await db.hostMapping.create({ data: { hostname: host("d"), area: "COMPANY_PUBLIC", kind: "CUSTOM",
    organizationId: org, status: status === "ACTIVE" ? "ACTIVE" : "PENDING" } });
  await db.customDomain.create({ data: { organizationId: org, hostMappingId: mapping.id, status,
    verificationToken: "secret-proof-token",
    ...(status === "ACTIVE" ? { activatedAt: new Date(), ownershipVerifiedAt: new Date(), routingVerifiedAt: new Date(),
      tlsVerifiedAt: new Date() } : {}), ...extra } });
}

beforeAll(async () => {
  await db.organization.createMany({ data: [a, b, c].map((id, i) => ({ id, slug: `rc-${i}-${id}`, name: `RC ${i}` })) });
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  for (const id of [a, b, c]) {
    await db.hostMapping.create({ data: { hostname: `p-${id}.example.test`, area: "COMPANY_PUBLIC", kind: "PROVIDER",
      organizationId: id, status: "ACTIVE" } });
    await db.hostMapping.create({ data: { hostname: `adm-${id}.example.test`, area: "COMPANY_ADMIN", kind: "PROVIDER",
      organizationId: id, status: "ACTIVE" } });
  }
  await ensureControlledFixtureAccess(db);
  platformSession = await verifiedFixtureSession(db, FIXTURE.users[2]);
  adminSession = await verifiedFixtureSession(db, FIXTURE.users[0]);
});

afterAll(async () => {
  if (platformSession) await platformSession.dispose();
  if (adminSession) await adminSession.dispose();
  await db.auditLog.deleteMany({ where: { organizationId: { in: [a, b, c] } } });
  await db.customDomain.deleteMany({ where: { organizationId: { in: [a, b, c] } } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: [a, b, c] } }, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: [a, b, c] } } });
  await db.$disconnect();
});

test("recheck of an ACTIVE domain records the result without changing its lifecycle", async () => {
  await addDomain(a, "ACTIVE", { version: 3 });
  const res = await call(a);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body.domain.customDomain).toMatchObject({ status: "ACTIVE", state: "ACTIVE", tlsExpiry: "OK",
    tlsNotAfter: notAfter.toISOString(), version: 3 });
  expect(body.domain.customDomain.checkedAt).not.toBeNull();
  expect(body.domain.aliasCheckedAt).not.toBeNull();
  expect(body.domain.adminCheckedAt).not.toBeNull();
  expect(JSON.stringify(body)).not.toContain("secret-proof-token");
  // A failing re-check keeps ACTIVE (no unpublishing on a blip), shows the failure and keeps the last certificate date.
  script.routing = { ok: false, code: "CNAME_MISMATCH" };
  const failed = await (await call(a)).json();
  expect(failed.domain.customDomain).toMatchObject({ status: "ACTIVE", state: "FAILED", category: "DNS",
    tlsNotAfter: notAfter.toISOString() });
  expect((await domainOf(a)).status).toBe("ACTIVE");
  expect((await db.hostMapping.findFirstOrThrow({ where: { organizationId: a, kind: "CUSTOM" } })).status).toBe("ACTIVE");
  script.routing = { ok: true, tlsNotAfter: notAfter };
  expect((await (await call(a)).json()).domain.customDomain.state).toBe("ACTIVE");
  expect(await db.auditLog.count({ where: { organizationId: a } })).toBe(0); // no lifecycle change, nothing to audit
});

test("recheck of a non-active domain uses the normal verification; no domain only confirms hosts", async () => {
  await addDomain(b, "PENDING_OWNERSHIP");
  const body = await (await call(b)).json();
  expect(body.domain.customDomain).toMatchObject({ status: "READY", state: "READY", tlsNotAfter: notAfter.toISOString() });
  expect(await db.customDomain.count({ where: { organizationId: b, status: "READY" } })).toBe(1);
  const none = await (await call(c)).json();
  expect(none.domain.customDomain).toBeNull();
  expect(none.domain.aliasCheckedAt).not.toBeNull();
});

test("recheck access: superadmin on platform host with Origin only; strict body; archived and unknown refused", async () => {
  expect((await call(a, { cookie: adminSession.cookie })).status).toBe(403);
  expect((await call(a, { origin: null })).status).toBe(403);
  expect((await call(a, { origin: "https://evil.example.test" })).status).toBe(403);
  expect((await call(a, { host: `p-${a}.example.test` })).status).toBe(404);
  expect((await call(a, { body: { eventKey: "x" } })).status).toBe(400);
  expect((await call(a, { body: { eventKey: randomUUID(), extra: 1 } })).status).toBe(400);
  expect((await call("nope")).status).toBe(400);
  expect((await call(randomUUID())).status).toBe(403); // unknown company is not told apart from a forbidden one
  await db.organization.update({ where: { id: c }, data: { archivedAt: new Date() } });
  const archived = await call(c);
  expect(archived.status).toBe(409);
  expect(await archived.json()).toEqual({ code: "DOMAIN_COMPANY_ARCHIVED" });
  await db.organization.update({ where: { id: c }, data: { archivedAt: null } });
});

test("recheck is limited per company; a checker failure is a 5xx that changes nothing", async () => {
  const before = (await domainOf(a)).checkedAt;
  script.throws = true;
  expect((await call(a)).status).toBe(500);
  script.throws = false;
  expect((await domainOf(a)).checkedAt).toEqual(before);
  let last = 0;
  for (let i = 0; i < RECHECK_LIMIT + 1; i += 1) last = (await call(a)).status;
  expect(last).toBe(429);
  const limited = await call(a);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect((await call(b)).status).toBe(200); // other company has its own budget
});

test("periodic re-check: only stale ACTIVE domains of non-archived companies, one failure does not stop the rest", async () => {
  const now = new Date();
  const stale = new Date(now.getTime() - 25 * 3_600_000);
  const fresh = new Date(now.getTime() - 3_600_000);
  await db.customDomain.deleteMany({ where: { organizationId: { in: [a, b, c] } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: [a, b, c] }, kind: "CUSTOM" } });
  await addDomain(a, "ACTIVE", { checkedAt: stale, lastFailureCode: "DNS_ERROR" });
  await addDomain(b, "ACTIVE", { checkedAt: fresh });
  await addDomain(c, "ACTIVE", { checkedAt: null });
  const errors: unknown[] = [];
  const checked = await recheckDueDomains(db, checker, config, now, { onError: (e) => errors.push(e) });
  expect(errors).toEqual([]);
  expect(checked).toBeGreaterThanOrEqual(2);
  expect((await domainOf(a))).toMatchObject({ lastFailureCode: null, status: "ACTIVE" });
  expect((await domainOf(a)).checkedAt!.getTime()).toBe(now.getTime());
  expect((await domainOf(a)).tlsNotAfter).toEqual(notAfter);
  expect((await domainOf(b)).checkedAt).toEqual(fresh);
  expect((await domainOf(c)).checkedAt).not.toBeNull();
  // Archived company and a domain that changed while the probe ran are skipped.
  await db.customDomain.update({ where: { organizationId: a }, data: { checkedAt: stale } });
  await db.organization.update({ where: { id: a }, data: { archivedAt: now } });
  expect(await refreshActiveDomain(db, checker, { organizationId: a, config, now })).toBe(false);
  expect((await domainOf(a)).checkedAt).toEqual(stale);
  await db.organization.update({ where: { id: a }, data: { archivedAt: null } });
  const racing: DomainChecker = { checkOwnership: async () => {
    await db.customDomain.update({ where: { organizationId: a }, data: { version: { increment: 1 } } });
    return { ok: true };
  }, checkRouting: async () => ({ ok: true }) };
  expect(await refreshActiveDomain(db, racing, { organizationId: a, config, now })).toBe(false);
  // Diagnostics read of the refreshed company stays a pure read.
  expect(await getLaunchDiagnostics(db, a, now)).not.toBeNull();
});
