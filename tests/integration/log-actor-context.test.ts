import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { setLogSink } from "../../src/modules/observability/log";
import { reportInternalError } from "../../src/modules/observability/http-observe";
import { requireRequestContext } from "../../src/modules/tenancy/request-context";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const adminId = randomUUID();
const host = `log-ctx-${organizationId}.example.test`;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `log-ctx-${organizationId}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, name: "Log ctx admin", email: `log-ctx-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  session = await verifiedFixtureSession(db, adminId);
});
afterAll(async () => {
  await session?.dispose();
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { hostname: host } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

// Same shape as an /api/admin handler: authorize with the shared helper, fail afterwards, answer 500 with the request ID.
async function handler(headers: Headers, requestId: string) {
  try {
    const context = await requireRequestContext(db, auth, headers, organizationId);
    if (!context) return { status: 403 };
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw new Error("FLEET_SOMETHING_UNEXPECTED user@example.test");
  } catch (error) {
    reportInternalError(error, requestId, "fleet");
    return { status: 500, requestId };
  }
}

test("a 500 reported after authorization carries the actor, role and company, and no message text (B2)", async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.all(ids.map((id) => handler(new Headers({ cookie: session.cookie, host }), id)));
    expect(results.every((r) => r.status === 500)).toBe(true);
    const parsed = lines.map((line) => JSON.parse(line)).filter((l) => l.event === "http.internal_error");
    expect(parsed).toHaveLength(2);
    for (const line of parsed) {
      expect(line).toMatchObject({ actorId: adminId, actorRole: "ADMIN_FIRMY", organizationId, operation: "fleet", status: 500 });
      expect(ids).toContain(line.requestId);
    }
    expect(lines.join("\n")).not.toContain("user@example.test");
  } finally { restore(); }
});

test("a request without a resolved actor has none in its log line", async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const result = await handler(new Headers({ host }), randomUUID()); // no session cookie
    expect(result.status).toBe(403);
    reportInternalError(new Error("X"), randomUUID(), "fleet");
    expect(JSON.parse(lines[0]).actorId).toBeUndefined();
  } finally { restore(); }
});
