import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { GET as adminVehicles } from "../../src/app/api/admin/vehicles/route";
import { GET as platformVehicles } from "../../src/app/api/platform/companies/[organizationId]/vehicles/route";
import { prisma } from "../../src/lib/prisma";
import { setLogSink } from "../../src/modules/observability/log";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const orgA = randomUUID();
const orgB = randomUUID();
const adminA = randomUUID();
const adminB = randomUUID();
const hostA = `log-a-${orgA}.example.test`;
const hostB = `log-b-${orgB}.example.test`;
const platformHost = `log-p-${orgA}.example.test`;
const sessions: Array<Awaited<ReturnType<typeof verifiedFixtureSession>>> = [];
const superadminId = FIXTURE.users[2];
let cookies: { a: string; b: string; super: string };

beforeAll(async () => {
  for (const [id, host, admin] of [[orgA, hostA, adminA], [orgB, hostB, adminB]] as const) {
    await prisma.organization.create({ data: { id, slug: `log-${id}`, firstAdminRegisteredAt: new Date() } });
    await prisma.hostMapping.create({ data: { hostname: host, area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" } });
    await prisma.user.create({ data: { id: admin, name: "Log ctx admin", email: `log-ctx-${admin}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: id } });
  }
  await prisma.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  await ensureControlledSuperadminMfa(prisma, superadminId);
  for (const user of [adminA, adminB, superadminId]) sessions.push(await verifiedFixtureSession(prisma, user));
  cookies = { a: sessions[0].cookie, b: sessions[1].cookie, super: sessions[2].cookie };
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const session of sessions) await session.dispose();
  await prisma.user.deleteMany({ where: { id: { in: [adminA, adminB] } } });
  await prisma.hostMapping.deleteMany({ where: { hostname: { in: [hostA, hostB, platformHost] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.$disconnect();
});

// R1: the real fleet route exports, a dependency fails after authorization, three different actors run in parallel
// from the same frame. Every `http.internal_error` line carries its own actor and company, and nothing leaks after.
test("real route exports: each 500 line has its own actor and company (two admins and a superadmin in a company context)", async () => {
  // The fleet list reads inside one interactive transaction, so the failing dependency is the transaction itself.
  vi.spyOn(prisma, "$transaction").mockImplementation((() => { throw new Error("DEPENDENCY_DOWN user@example.test"); }) as never);
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const request = (host: string, cookie: string) => new Request(`http://${host}/api/admin/vehicles/`, { headers: { host, cookie } });
    const responses = await Promise.all([
      adminVehicles(request(hostA, cookies.a)),
      adminVehicles(request(hostB, cookies.b)),
      platformVehicles(new Request(`http://${platformHost}/api/platform/companies/${orgA}/vehicles/`, { headers: { host: platformHost, cookie: cookies.super } }),
        { params: Promise.resolve({ organizationId: orgA }) }),
      adminVehicles(request(hostA, cookies.a)),
    ]);
    expect(responses.map((r) => r.status)).toEqual([500, 500, 500, 500]);
    const expected = [
      { actorId: adminA, actorRole: "ADMIN_FIRMY", organizationId: orgA },
      { actorId: adminB, actorRole: "ADMIN_FIRMY", organizationId: orgB },
      { actorId: superadminId, actorRole: "SUPERADMIN_AUTERVA", organizationId: orgA },
      { actorId: adminA, actorRole: "ADMIN_FIRMY", organizationId: orgA },
    ];
    const parsed = lines.map((line) => JSON.parse(line)).filter((l) => l.event === "http.internal_error");
    expect(parsed).toHaveLength(4);
    responses.forEach((response, index) => {
      const line = parsed.find((l) => l.requestId === response.headers.get("x-request-id"));
      expect(line, `line for response ${index}`).toMatchObject({ ...expected[index], operation: "fleet", status: 500 });
    });
    expect(lines.join("\n")).not.toContain("user@example.test");
    // A later line outside any handler has no request context.
    lines.length = 0;
    const { log } = await import("../../src/modules/observability/log");
    log.info("after");
    expect(JSON.parse(lines[0]).actorId).toBeUndefined();
  } finally { restore(); }
});
