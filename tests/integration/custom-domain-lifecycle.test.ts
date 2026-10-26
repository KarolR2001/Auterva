import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { proxy } from "../../src/proxy";
import { GET as probeRoute } from "../../src/app/.well-known/auterva-domain-check/route";
import type { CheckOutcome, DomainChecker } from "../../src/modules/domains/checker";
import { createPlatformDomainHandlers } from "../../src/modules/domains/http";
import { activateDomain, readDomain, registerDomain, removeDomain, verifyDomain,
  type DomainConfig } from "../../src/modules/domains/lifecycle";
import { createNetworkDomainChecker } from "../../src/modules/domains/network-checker";
import { changePaidThrough } from "../../src/modules/service-period/mutations";
import { resolvePublicVisibility } from "../../src/modules/service-period/public";
import { resolveHostMapping } from "../../src/modules/tenancy/host-registry";
import { createTestPki, startDnsServer, startHttpsServer } from "../fixtures/domain-network";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const config: DomainConfig = { cnameTarget: "edge.auterva.test", reservedBases: ["sites.auterva.test", "auterva.test"] };
const suffix = randomUUID().slice(0, 8);
const [orgA, orgB, orgC] = [randomUUID(), randomUUID(), randomUUID()];
const alias = { a: `a-${suffix}.pub.example.test`, b: `b-${suffix}.pub.example.test` };
const panel = { a: `a-${suffix}.adm.example.test`, b: `b-${suffix}.adm.example.test` };
const platformHost = `platform-${suffix}.example.test`;
const marketingHost = `mkt-${suffix}.example.test`;
const platformSession = randomUUID();
const adminA = randomUUID();
const adminASession = randomUUID();
let platformUserId: string;
let createdPlatformUser = false;
let superCookie: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminCookie: Awaited<ReturnType<typeof verifiedFixtureSession>>;
const hostFor = (label: string) => `www.${label}-${suffix}.klient.example.test`;
const actor = () => ({ actorId: platformUserId, sessionId: platformSession });
const op = (organizationId: string) => ({ ...actor(), organizationId, eventKey: randomUUID(), requestId: randomUUID() });

type Script = { routing: CheckOutcome; ownership: boolean; calls: string[]; gate: Promise<void> | null };
function scripted() {
  const script: Script = { routing: { ok: true }, ownership: true, calls: [], gate: null };
  const checker: DomainChecker = {
    async checkOwnership(host, token) {
      script.calls.push(`own:${host}`);
      const row = await db.customDomain.findFirst({ where: { hostMapping: { hostname: host } }, select: { verificationToken: true } });
      if (script.gate) await script.gate;
      return script.ownership && row?.verificationToken === token ? { ok: true } : { ok: false, code: "OWNERSHIP_TXT_MISMATCH" };
    },
    async checkRouting(host) { script.calls.push(`route:${host}`); return script.routing; },
  };
  return { script, checker };
}

const request = (host: string, path: string, method = "GET") =>
  new NextRequest(`https://${host}${path}`, { method, headers: { host } });

beforeAll(async () => {
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformUserId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformUserId);
  else {
    await db.user.create({ data: { id: platformUserId, name: "Domain operator", email: `domain-${platformUserId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdPlatformUser = true;
  }
  await db.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: `domain-${id}`,
    firstAdminRegisteredAt: new Date("2026-10-01T10:00:00.000Z") })) });
  await db.serviceAccess.createMany({ data: [orgA, orgB].map((organizationId) => ({ organizationId,
    paidThrough: new Date("2099-12-31T00:00:00.000Z") })) });
  await db.hostMapping.createMany({ data: [
    { organizationId: orgA, hostname: alias.a, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    { organizationId: orgB, hostname: alias.b, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    { organizationId: orgA, hostname: panel.a, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { organizationId: orgB, hostname: panel.b, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    { hostname: marketingHost, area: "MARKETING", status: "ACTIVE" },
  ] });
  await db.session.create({ data: { id: platformSession, userId: platformUserId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  await db.user.create({ data: { id: adminA, name: "Company A admin", email: `admin-${adminA}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: orgA } });
  await db.session.create({ data: { id: adminASession, userId: adminA, token: randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  superCookie = await verifiedFixtureSession(db, platformUserId);
  adminCookie = await verifiedFixtureSession(db, adminA);
});

afterAll(async () => {
  await superCookie?.dispose(); await adminCookie?.dispose();
  await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB, orgC] } } });
  await db.customDomain.deleteMany({ where: { organizationId: { in: [orgA, orgB, orgC] } } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: [orgA, orgB, orgC] } },
    { hostname: { in: [platformHost, marketingHost] } }] } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB, orgC] } } });
  await db.session.deleteMany({ where: { id: { in: [platformSession, adminASession] } } });
  await db.user.deleteMany({ where: { id: adminA } });
  if (createdPlatformUser) await db.user.deleteMany({ where: { id: platformUserId } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB, orgC] } } });
  await db.$disconnect();
});

describe("host separation without a custom domain", () => {
  test("no custom domain: alias serves the offer, panel and unknown hosts are neutral, never a public fallback", async () => {
    expect((await proxy(request(alias.a, "/pojazdy/"))).status).toBe(200);
    expect(await resolvePublicVisibility(db, alias.a)).toMatchObject({ organizationId: orgA });
    for (const path of ["/", "/pojazdy/", "/kontakt/", "/sitemap.xml"]) {
      expect((await proxy(request(panel.a, path))).status).toBe(404);
      expect((await proxy(request(`unknown-${suffix}.example.test`, path))).status).toBe(404);
    }
    expect((await proxy(request(panel.a, "/admin/"))).status).toBe(200);
    expect(await resolvePublicVisibility(db, panel.a)).toBeNull();
    expect(await resolvePublicVisibility(db, `unknown-${suffix}.example.test`)).toBeNull();
    for (const area of [alias.a, marketingHost]) {
      expect((await proxy(request(area, "/api/admin/vehicles/"))).status).toBe(404);
      expect((await proxy(request(area, `/api/platform/companies/${orgA}/domains/`))).status).toBe(404);
    }
    expect((await proxy(request(panel.a, `/api/platform/companies/${orgA}/domains/`))).status).toBe(404);
    expect((await proxy(request(alias.a, "/.well-known/auterva-domain-check/"))).status).toBe(404);
  });
});

describe("registration and takeover", () => {
  test("typing a domain is not ready: host stays pending and invisible, alias keeps serving", async () => {
    const hostname = hostFor("pending");
    const state = await registerDomain(db, { ...op(orgA), hostname, expectedVersion: null, config });
    expect(state.domain).toMatchObject({ hostname, status: "PENDING_OWNERSHIP", version: 0, lastFailureCode: null,
      instruction: { ownership: { type: "TXT", name: `_auterva-challenge.${hostname}` },
        routing: { type: "CNAME", name: hostname, value: "edge.auterva.test" } } });
    expect(state.domain!.instruction.ownership.value).toMatch(/^auterva-verification=[A-Za-z0-9_-]{43}$/);
    expect(state.aliasHostname).toBe(alias.a);
    expect(await resolveHostMapping(db, hostname)).toBeNull();
    expect((await proxy(request(hostname, "/"))).status).toBe(404);
    expect(await resolvePublicVisibility(db, hostname)).toBeNull();
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).status).toBe("PENDING");
    expect((await proxy(request(alias.a, "/pojazdy/"))).status).toBe(200);
    // The pending host answers only the routing probe, with a proof bound to its own token.
    expect((await proxy(request(hostname, "/.well-known/auterva-domain-check/"))).status).toBe(200);
    const probe = await probeRoute(new Request(`https://${hostname}/.well-known/auterva-domain-check/`, { headers: { host: hostname } }));
    expect(await probe.json()).toEqual({ proof: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(probe.headers.get("cache-control")).toBe("no-store");
    const stranger = await probeRoute(new Request(`https://x-${hostname}/.well-known/auterva-domain-check/`, { headers: { host: `x-${hostname}` } }));
    expect(stranger.status).toBe(404);
    await removeDomain(db, { ...op(orgA), expectedVersion: 0, config });
  });

  test("a host of another company, in any area, kind or state, cannot be claimed; the owner is not disclosed", async () => {
    const hostname = hostFor("taken");
    await registerDomain(db, { ...op(orgA), hostname, expectedVersion: null, config });
    for (const claimed of [hostname, hostname.toUpperCase(), `${hostname}.`, alias.a, panel.a, platformHost, marketingHost]) {
      await expect(registerDomain(db, { ...op(orgB), hostname: claimed, expectedVersion: null, config }))
        .rejects.toThrow("DOMAIN_TAKEN");
    }
    expect(await db.customDomain.count({ where: { organizationId: orgB } })).toBe(0);
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).organizationId).toBe(orgA);
    for (const invalid of ["localhost", "127.0.0.1", "klient.pl", "*.klient.pl", "https://www.klient.pl", `x.sites.auterva.test`, `${alias.a}:8080`, 5, null]) {
      await expect(registerDomain(db, { ...op(orgB), hostname: invalid, expectedVersion: null, config }))
        .rejects.toThrow("INVALID_HOSTNAME");
    }
    // An existing domain cannot be overwritten without its version, and one company has at most one domain.
    await expect(registerDomain(db, { ...op(orgA), hostname: hostFor("second"), expectedVersion: null, config }))
      .rejects.toThrow("DOMAIN_VERSION_CONFLICT");
    await removeDomain(db, { ...op(orgA), expectedVersion: 0, config });
  });

  test("two companies racing for the same new host: exactly one wins, the other is refused", async () => {
    const hostname = hostFor("race");
    const results = await Promise.allSettled([orgA, orgB].map((id) =>
      registerDomain(db, { ...op(id), hostname, expectedVersion: null, config })).flat());
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.message).toBe("DOMAIN_TAKEN");
    const winner = (await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).organizationId!;
    await removeDomain(db, { ...op(winner), expectedVersion: 0, config });
  });

  test("after removal another company needs its own proof; the previous token proves nothing", async () => {
    const hostname = hostFor("handover");
    const { checker } = scripted();
    await registerDomain(db, { ...op(orgA), hostname, expectedVersion: null, config });
    const oldToken = (await db.customDomain.findUniqueOrThrow({ where: { organizationId: orgA } })).verificationToken;
    await removeDomain(db, { ...op(orgA), expectedVersion: 0, config });
    await registerDomain(db, { ...op(orgB), hostname, expectedVersion: null, config });
    const fresh = await db.customDomain.findUniqueOrThrow({ where: { organizationId: orgB } });
    expect(fresh.verificationToken).not.toBe(oldToken);
    const seen: string[] = [];
    const strict: DomainChecker = { checkOwnership: async (_host, token) => { seen.push(token); return token === oldToken ? { ok: true } : { ok: false, code: "OWNERSHIP_TXT_MISMATCH" }; },
      checkRouting: checker.checkRouting };
    const state = await verifyDomain(db, strict, { ...op(orgB), config });
    expect(seen).toEqual([fresh.verificationToken]);
    expect(state.domain).toMatchObject({ status: "PENDING_OWNERSHIP", lastFailureCode: "OWNERSHIP_TXT_MISMATCH" });
    await removeDomain(db, { ...op(orgB), expectedVersion: 0, config });
  });

  test("only the platform actor may manage domains; a company admin is refused for A and for B", async () => {
    for (const organizationId of [orgA, orgB]) {
      const operation = { actorId: adminA, sessionId: adminASession, organizationId, eventKey: randomUUID(), requestId: randomUUID() };
      await expect(registerDomain(db, { ...operation, hostname: hostFor("forbidden"), expectedVersion: null, config })).rejects.toThrow("FORBIDDEN");
      await expect(verifyDomain(db, scripted().checker, { ...operation, config })).rejects.toThrow();
    }
    expect(await db.hostMapping.count({ where: { hostname: hostFor("forbidden") } })).toBe(0);
  });
});

describe("verification, activation and redirect", () => {
  const hostname = hostFor("cycle");
  const publicPath = "/pojazdy/volkswagen-transporter/?od=2099-01-01&do=2099-01-03&q=a%20b";

  test("bad DNS or TLS keeps the domain waiting and the alias serving; activation needs fresh complete proof", async () => {
    const { script, checker } = scripted();
    await registerDomain(db, { ...op(orgA), hostname, expectedVersion: null, config });
    script.ownership = false;
    let state = await verifyDomain(db, checker, { ...op(orgA), config });
    expect(state.domain).toMatchObject({ status: "PENDING_OWNERSHIP", lastFailureCode: "OWNERSHIP_TXT_MISMATCH", version: 0 });
    // Without ownership proof the host is never probed.
    expect(script.calls.filter((call) => call.startsWith("route:"))).toHaveLength(0);
    script.ownership = true;
    script.routing = { ok: false, code: "TLS_INVALID" };
    state = await verifyDomain(db, checker, { ...op(orgA), config });
    expect(state.domain).toMatchObject({ status: "PENDING_ROUTING", lastFailureCode: "TLS_INVALID", version: 1 });
    await expect(activateDomain(db, checker, { ...op(orgA), expectedVersion: 1, config })).rejects.toThrow("DOMAIN_NOT_READY");
    expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).toMatchObject({ status: "PENDING", canonicalTarget: null });
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname: alias.a } })).canonicalTarget).toBeNull();
    expect((await proxy(request(alias.a, "/pojazdy/"))).status).toBe(200);
    expect((await proxy(request(hostname, "/pojazdy/"))).status).toBe(404);
  });

  test("ready is not active; activation checks again, then redirects the alias with path and query", async () => {
    const { script, checker } = scripted();
    script.routing = { ok: true };
    const ready = await verifyDomain(db, checker, { ...op(orgA), config });
    expect(ready.domain).toMatchObject({ status: "READY", lastFailureCode: null });
    expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).toMatchObject({ status: "PENDING" });
    expect((await proxy(request(alias.a, "/pojazdy/"))).status).toBe(200);
    await expect(activateDomain(db, checker, { ...op(orgA), expectedVersion: ready.domain!.version - 1, config })).rejects.toThrow("DOMAIN_VERSION_CONFLICT");
    // The proof held at the time of the click is not enough when the host broke in the meantime.
    script.routing = { ok: false, code: "TLS_INVALID" };
    await expect(activateDomain(db, checker, { ...op(orgA), expectedVersion: ready.domain!.version, config })).rejects.toThrow("DOMAIN_NOT_READY");
    expect((await readDomain(db, orgA, config))!.domain).toMatchObject({ status: "PENDING_ROUTING", lastFailureCode: "TLS_INVALID" });
    script.routing = { ok: true };
    const again = await verifyDomain(db, checker, { ...op(orgA), config });
    const active = await activateDomain(db, checker, { ...op(orgA), expectedVersion: again.domain!.version, config });
    expect(active.domain).toMatchObject({ hostname, status: "ACTIVE", lastFailureCode: null });
    expect(active.domain!.activatedAt).not.toBeNull();
    expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).toMatchObject({ status: "ACTIVE", canonicalTarget: null });
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname: alias.a } })).canonicalTarget).toBe(hostname);
    // Company B's alias is untouched.
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname: alias.b } })).canonicalTarget).toBeNull();

    const redirect = await proxy(request(alias.a, publicPath));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe(`https://${hostname}${publicPath}`);
    expect(redirect.headers.get("cache-control")).toBe("no-store");
    expect((await proxy(request(alias.a, "/", "HEAD"))).status).toBe(307);
    expect((await proxy(request(alias.a, "/pojazdy/", "POST"))).status).toBe(404);
    expect((await proxy(request(alias.a, "/admin/"))).status).toBe(404);
    expect((await proxy(request(hostname, publicPath))).status).toBe(200);
    expect((await proxy(request(hostname, "/api/admin/vehicles/"))).status).toBe(404);
    expect((await proxy(request(hostname, "/admin/"))).status).toBe(404);
    expect(await resolvePublicVisibility(db, hostname)).toMatchObject({ organizationId: orgA });
    expect((await proxy(request(alias.b, "/pojazdy/"))).status).toBe(200);
  });

  test("shortening the period closes alias and custom domain on the next request, with path and query kept in the retry", async () => {
    const before = await proxy(request(alias.a, publicPath));
    expect(before.headers.get("location")).toBe(`https://${hostname}${publicPath}`);
    expect((await proxy(request(hostname, publicPath))).status).toBe(200);
    expect(await resolvePublicVisibility(db, hostname)).not.toBeNull();
    const version = (await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgA } })).periodVersion;
    await changePaidThrough(db, { ...op(orgA), expectedVersion: version, paidThrough: "2020-01-01" });
    const closed = await proxy(request(alias.a, publicPath));
    expect(closed.status).toBe(404);
    expect(closed.headers.get("location")).toBeNull();
    expect(await resolvePublicVisibility(db, alias.a)).toBeNull();
    expect(await resolvePublicVisibility(db, hostname)).toBeNull();
    expect(await resolvePublicVisibility(db, hostname, new Date("2019-12-31T00:00:00.000Z"))).not.toBeNull();
    // Company B, same moment, is unaffected.
    expect((await proxy(request(alias.b, "/pojazdy/"))).status).toBe(200);
    await changePaidThrough(db, { ...op(orgA), expectedVersion: version + 1, paidThrough: "2099-12-31" });
    expect((await proxy(request(alias.a, publicPath))).headers.get("location")).toBe(`https://${hostname}${publicPath}`);
  });

  test("archive and a missing first registration also close the alias before any redirect", async () => {
    await db.organization.update({ where: { id: orgA }, data: { archivedAt: new Date(), publicUnlockRequired: true } });
    expect((await proxy(request(alias.a, publicPath))).headers.get("location")).toBeNull();
    expect(await resolvePublicVisibility(db, hostname)).toBeNull();
    await db.organization.update({ where: { id: orgA }, data: { archivedAt: null, publicUnlockRequired: false } });
    expect((await proxy(request(alias.a, publicPath))).status).toBe(307);
    // Company C never finished the first registration, so even a consistent active domain stays closed.
    const unregistered = { alias: `c-${suffix}.pub.example.test`, custom: hostFor("unreg") };
    await db.organization.create({ data: { id: orgC, slug: `domain-${orgC}` } });
    await db.serviceAccess.create({ data: { organizationId: orgC, paidThrough: new Date("2099-12-31T00:00:00.000Z") } });
    await db.hostMapping.createMany({ data: [
      { organizationId: orgC, hostname: unregistered.custom, area: "COMPANY_PUBLIC", kind: "CUSTOM", status: "ACTIVE" },
      { organizationId: orgC, hostname: unregistered.alias, area: "COMPANY_PUBLIC", status: "ACTIVE", canonicalTarget: unregistered.custom },
    ] });
    expect((await proxy(request(unregistered.alias, publicPath))).status).toBe(404);
    expect(await resolvePublicVisibility(db, unregistered.custom)).toBeNull();
  });

  test("a corrupt canonical target never becomes an open redirect or serves the offer", async () => {
    const original = hostname;
    // An active custom host that belongs to another company must not be a redirect target either.
    const foreign = hostFor("foreign");
    await db.hostMapping.create({ data: { organizationId: orgB, hostname: foreign, area: "COMPANY_PUBLIC", kind: "CUSTOM", status: "ACTIVE" } });
    for (const target of ["evil.example.net", alias.b, panel.a, foreign, `${original}.evil.net`]) {
      await db.hostMapping.update({ where: { hostname: alias.a }, data: { canonicalTarget: target } });
      const response = await proxy(request(alias.a, "/pojazdy/"));
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
    await db.hostMapping.update({ where: { hostname: alias.a }, data: { canonicalTarget: original } });
    await db.hostMapping.delete({ where: { hostname: foreign } });
  });

  test("a failed re-check demotes the active domain and the alias serves the offer again", async () => {
    const { script, checker } = scripted();
    script.routing = { ok: false, code: "TLS_INVALID" };
    const state = await verifyDomain(db, checker, { ...op(orgA), config });
    expect(state.domain).toMatchObject({ status: "PENDING_ROUTING", lastFailureCode: "TLS_INVALID", activatedAt: null });
    expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).toMatchObject({ status: "PENDING" });
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname: alias.a } })).canonicalTarget).toBeNull();
    expect((await proxy(request(alias.a, publicPath))).status).toBe(200);
    expect((await proxy(request(hostname, publicPath))).status).toBe(404);
  });

  test("DOMAIN_CHANGED audit names the real actor and stores no host, token or failure detail", async () => {
    const rows = await db.auditLog.findMany({ where: { organizationId: orgA, action: "DOMAIN_CHANGED" } });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row).toMatchObject({ actorId: platformUserId, actorRole: "SUPERADMIN_AUTERVA", entityType: "HostMapping" });
      const text = JSON.stringify(row.safeChanges);
      expect(text).not.toContain(hostname);
      expect(text).not.toMatch(/auterva-verification|TLS_INVALID/);
    }
    const key = randomUUID();
    await removeDomain(db, { ...op(orgA), eventKey: key, expectedVersion: (await readDomain(db, orgA, config))!.domain!.version, config });
    await registerDomain(db, { ...op(orgA), hostname: hostFor("replay"), expectedVersion: null, config });
    await expect(removeDomain(db, { ...op(orgA), eventKey: key, expectedVersion: 0, config })).rejects.toThrow();
    expect((await readDomain(db, orgA, config))!.domain).toMatchObject({ status: "PENDING_OWNERSHIP" });
    await removeDomain(db, { ...op(orgA), expectedVersion: 0, config });
  });
});

describe("concurrency", () => {
  test("a stale network result cannot be applied to a domain that was replaced meanwhile", async () => {
    const oldHost = hostFor("stale-old");
    await registerDomain(db, { ...op(orgA), hostname: oldHost, expectedVersion: null, config });
    const { checker, script } = scripted();
    let release!: () => void;
    script.gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = verifyDomain(db, checker, { ...op(orgA), config });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await registerDomain(db, { ...op(orgA), hostname: hostFor("stale-new"), expectedVersion: 0, config });
    release();
    await expect(pending).rejects.toThrow("DOMAIN_VERSION_CONFLICT");
    expect((await readDomain(db, orgA, config))!.domain).toMatchObject({ hostname: hostFor("stale-new"), status: "PENDING_OWNERSHIP", lastFailureCode: null });
    await removeDomain(db, { ...op(orgA), expectedVersion: 0, config });
  });

  test("two parallel activations produce one active domain and one conflict", async () => {
    const hostname = hostFor("twice");
    const { checker } = scripted();
    await registerDomain(db, { ...op(orgA), hostname, expectedVersion: null, config });
    const ready = await verifyDomain(db, checker, { ...op(orgA), config });
    const results = await Promise.allSettled([0, 1].map(() =>
      activateDomain(db, checker, { ...op(orgA), expectedVersion: ready.domain!.version, config })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname: alias.a } })).canonicalTarget).toBe(hostname);
    await removeDomain(db, { ...op(orgA), expectedVersion: (await readDomain(db, orgA, config))!.domain!.version, config });
    // Removing the domain drops the redirect in the same transaction.
    expect((await db.hostMapping.findUniqueOrThrow({ where: { hostname: alias.a } })).canonicalTarget).toBeNull();
    expect(await db.hostMapping.count({ where: { hostname } })).toBe(0);
  });
});

describe("database guards", () => {
  test("constraints refuse a cross-company attachment, a second custom host, a redirect on the wrong row and active-without-proof", async () => {
    const a = await db.hostMapping.create({ data: { organizationId: orgA, hostname: hostFor("guard-a"), area: "COMPANY_PUBLIC", kind: "CUSTOM" } });
    await expect(db.customDomain.create({ data: { organizationId: orgB, hostMappingId: a.id, verificationToken: "t" } })).rejects.toThrow();
    await expect(db.hostMapping.create({ data: { organizationId: orgA, hostname: hostFor("guard-2"), area: "COMPANY_PUBLIC", kind: "CUSTOM" } })).rejects.toThrow();
    await expect(db.hostMapping.create({ data: { organizationId: orgA, hostname: hostFor("guard-admin"), area: "COMPANY_ADMIN", kind: "CUSTOM" } })).rejects.toThrow();
    await expect(db.hostMapping.create({ data: { organizationId: orgA, hostname: hostFor("guard-kind"), area: "COMPANY_PUBLIC", kind: "OTHER" } })).rejects.toThrow();
    await expect(db.hostMapping.update({ where: { id: a.id }, data: { canonicalTarget: "evil.example.net" } })).rejects.toThrow();
    await expect(db.hostMapping.update({ where: { hostname: panel.a }, data: { canonicalTarget: "evil.example.net" } })).rejects.toThrow();
    await expect(db.hostMapping.update({ where: { hostname: alias.a }, data: { canonicalTarget: alias.a } })).rejects.toThrow();
    await db.customDomain.create({ data: { organizationId: orgA, hostMappingId: a.id, verificationToken: "t" } });
    await expect(db.customDomain.update({ where: { organizationId: orgA }, data: { status: "ACTIVE" } })).rejects.toThrow();
    await expect(db.customDomain.update({ where: { organizationId: orgA }, data: { status: "READY" } })).rejects.toThrow();
    await expect(db.customDomain.update({ where: { organizationId: orgA }, data: { status: "BOGUS" } })).rejects.toThrow();
    await db.customDomain.deleteMany({ where: { organizationId: orgA } });
    await db.hostMapping.delete({ where: { id: a.id } });
  });
});

describe("platform HTTP transport", () => {
  const { checker, script } = scripted();
  const handlers = createPlatformDomainHandlers(() => ({ checker, config }));
  const call = (method: "get" | "put" | "remove" | "verify" | "activate", organizationId: string, options: {
    host?: string; origin?: string | null; cookie?: string; body?: unknown } = {}) => {
    const host = options.host ?? platformHost;
    const headers: Record<string, string> = { host, cookie: options.cookie ?? superCookie.cookie, "content-type": "application/json" };
    if (options.origin !== null) headers.origin = options.origin ?? `http://${host}`;
    const path = `/api/platform/companies/${organizationId}/domains/`;
    const verb = method === "get" ? "GET" : method === "remove" ? "DELETE" : method === "put" ? "PUT" : "POST";
    return handlers[method](new Request(`http://127.0.0.1:3339${path}`, { method: verb, headers,
      ...(method === "get" ? {} : { body: JSON.stringify(options.body ?? {}) }) }), organizationId);
  };

  test("the platform superadmin runs the whole cycle; instruction and failure codes stay private and uncached", async () => {
    const hostname = hostFor("http");
    expect((await call("get", orgA)).status).toBe(200);
    expect(await (await call("get", orgA)).json()).toEqual({ aliasHostname: alias.a, domain: null });
    const created = await call("put", orgA, { body: { hostname, expectedVersion: null, eventKey: randomUUID() } });
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(created.headers.get("x-request-id")).toBeTruthy();
    const body = await created.json();
    expect(body.domain.instruction.ownership.value).toMatch(/^auterva-verification=/);
    script.routing = { ok: true };
    const verified = await (await call("verify", orgA, { body: { eventKey: randomUUID() } })).json();
    expect(verified.domain).toMatchObject({ status: "READY", version: 1 });
    const stale = await call("activate", orgA, { body: { expectedVersion: 0, eventKey: randomUUID() } });
    expect([stale.status, (await stale.json()).code]).toEqual([409, "DOMAIN_VERSION_CONFLICT"]);
    const active = await call("activate", orgA, { body: { expectedVersion: 1, eventKey: randomUUID() } });
    expect(active.status).toBe(200);
    expect((await active.json()).domain.status).toBe("ACTIVE");
    const taken = await call("put", orgB, { body: { hostname, expectedVersion: null, eventKey: randomUUID() } });
    expect([taken.status, (await taken.json()).code]).toEqual([409, "DOMAIN_TAKEN"]);
    const gone = await call("remove", orgA, { body: { expectedVersion: 2, eventKey: randomUUID() } });
    expect(gone.status).toBe(200);
  });

  test("hosts, origin, role, company and input are enforced on every verb", async () => {
    const eventKey = randomUUID();
    const body = { hostname: hostFor("deny"), expectedVersion: null, eventKey };
    for (const host of [alias.a, panel.a, marketingHost, `unknown-${suffix}.example.test`]) {
      expect((await call("put", orgA, { host, body })).status).toBe(404);
      expect((await call("get", orgA, { host })).status).toBe(404);
    }
    expect((await call("put", orgA, { origin: "http://sibling.example.test", body })).status).toBe(403);
    expect((await call("put", orgA, { origin: null, body })).status).toBe(403);
    expect((await call("put", orgA, { cookie: "bad", body })).status).toBe(403);
    expect((await call("get", orgA, { cookie: "bad" })).status).toBe(403);
    // The admin of company A is not a platform actor, for A or for B.
    for (const organizationId of [orgA, orgB]) {
      expect((await call("put", organizationId, { cookie: adminCookie.cookie, body })).status).toBe(403);
      expect((await call("get", organizationId, { cookie: adminCookie.cookie })).status).toBe(403);
      expect((await call("verify", organizationId, { cookie: adminCookie.cookie, body: { eventKey } })).status).toBe(403);
    }
    expect((await call("put", "not-a-uuid", { body })).status).toBe(400);
    expect((await call("put", orgA, { body: { ...body, organizationId: orgB } })).status).toBe(400);
    expect((await call("put", orgA, { body: { ...body, eventKey: "x" } })).status).toBe(400);
    expect((await call("put", orgA, { body: { ...body, hostname: "localhost" } })).status).toBe(400);
    // An unknown company is indistinguishable from a forbidden one.
    expect((await call("put", randomUUID(), { body })).status).toBe(403);
    expect((await call("verify", orgA, { body: { eventKey } })).status).toBe(404);
    expect(await db.hostMapping.count({ where: { hostname: hostFor("deny") } })).toBe(0);
  });
});

describe("real DNS and real TLS through the application", () => {
  test("controlled DNS and HTTPS prove the cycle end to end; a wrong certificate steps the domain back", async () => {
    const hostname = hostFor("real");
    const pki = createTestPki();
    const state = await registerDomain(db, { ...op(orgA), hostname, expectedVersion: null, config });
    const instruction = state.domain!.instruction;
    const dns = await startDnsServer({ txt: { [instruction.ownership.name]: [instruction.ownership.value] },
      cname: { [hostname]: config.cnameTarget! }, a: { [hostname]: "127.0.0.1" } });
    // The HTTPS listener runs the application's own proxy and probe handler for whatever host the client asked.
    const app = async (host: string, path: string) => {
      const guarded = await proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
      if (guarded.status === 404) return { status: 404, body: "" };
      const answer = await probeRoute(new Request(`https://${host}${path}`, { headers: { host } }));
      return { status: answer.status, body: await answer.text() };
    };
    const good = await startHttpsServer(pki.issue(hostname), app);
    const wrong = await startHttpsServer(pki.issue(`other.${hostname}`), app);
    const checkerFor = (port: number) => createNetworkDomainChecker({ dns: dns.resolver,
      isAddressAllowed: (address) => address === "127.0.0.1", tls: { port, timeoutMs: 3_000, ca: pki.ca } });
    try {
      const ready = await verifyDomain(db, checkerFor(good.port), { ...op(orgA), config });
      expect(ready.domain).toMatchObject({ status: "READY", lastFailureCode: null });
      const active = await activateDomain(db, checkerFor(good.port), { ...op(orgA), expectedVersion: ready.domain!.version, config });
      expect(active.domain!.status).toBe("ACTIVE");
      expect((await proxy(request(alias.a, publicPathFor()))).headers.get("location")).toBe(`https://${hostname}${publicPathFor()}`);
      const broken = await verifyDomain(db, checkerFor(wrong.port), { ...op(orgA), config });
      expect(broken.domain).toMatchObject({ status: "PENDING_ROUTING", lastFailureCode: "TLS_INVALID" });
      expect((await proxy(request(alias.a, publicPathFor()))).status).toBe(200);
      // Another company's DNS cannot be borrowed: ownership of B's name is not proven by A's records.
      await removeDomain(db, { ...op(orgA), expectedVersion: broken.domain!.version, config });
      await registerDomain(db, { ...op(orgB), hostname, expectedVersion: null, config });
      expect((await verifyDomain(db, checkerFor(good.port), { ...op(orgB), config })).domain)
        .toMatchObject({ status: "PENDING_OWNERSHIP", lastFailureCode: "OWNERSHIP_TXT_MISMATCH" });
      await removeDomain(db, { ...op(orgB), expectedVersion: 0, config });
    } finally { await good.close(); await wrong.close(); dns.close(); pki.dispose(); }
  });
});

function publicPathFor() { return "/pojazdy/?od=2099-02-01&do=2099-02-02"; }
