import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createPrismaClient, prisma } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { POST as check } from "../../src/app/api/public/availability/check/route";
import { POST as next } from "../../src/app/api/public/availability/next/route";
import { POST as batch } from "../../src/app/api/public/availability/batch/route";
import { GET as calendar } from "../../src/app/api/public/vehicles/[slug]/calendar/route";

const reported = vi.hoisted(() => vi.fn());
vi.mock("../../src/modules/observability/http-observe", async (original) => {
  const actual = await original<typeof import("../../src/modules/observability/http-observe")>();
  return { ...actual, reportInternalError: (error: unknown, requestId: string, operation: string) => {
    reported(operation); return actual.reportInternalError(error, requestId, operation);
  } };
});

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const vehicleId = randomUUID();
const host = `avail-err-${organizationId}.example.test`;
const slug = `avail-err-${vehicleId}`;
const sourceIp = `10.${randomBytes(3).join(".")}`;
const today = availabilityToday(new Date());

beforeAll(async () => {
  const now = new Date();
  await db.organization.create({ data: { id: organizationId, slug: `avail-err-${organizationId}`, firstAdminRegisteredAt: now } });
  await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" } });
  await db.serviceAccess.create({ data: { organizationId, trialGranted: true, trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 336 * 60 * 60_000) } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId, slug, status: "PUBLISHED", availableFrom: sqlDate(today) } });
});

afterEach(() => { vi.restoreAllMocks(); reported.mockClear(); });

afterAll(async () => {
  const keyHash = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`api:public:availability:ip:${sourceIp}`).digest("hex");
  await db.rateLimitEvent.deleteMany({ where: { keyHash } });
  await db.vehicle.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { hostname: host } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
  await prisma.$disconnect();
});

const post = (handler: typeof check, path: string, body: object) => runWithTrustedClientAddress(sourceIp, () =>
  handler(new Request(`http://${host}/api/public/availability/${path}`, { method: "POST",
    headers: { host, "content-type": "application/json" }, body: JSON.stringify(body) })));
const getCalendar = (from: string, to: string) => runWithTrustedClientAddress(sourceIp, () => calendar(new Request(
  `http://${host}/api/public/vehicles/${slug}/calendar?from=${from}&to=${to}`, { headers: { host } }),
{ params: Promise.resolve({ slug }) }));

test.each([["9999-12-31", "9999-12-31"], ["9999-07-01", "9999-07-05"], ["9999-01-01", "9999-01-01"]])(
  "end-of-calendar dates %s..%s give a controlled 400, never 500, on every public read", async (from, to) => {
    for (const [handler, path, body] of [[check, "check", { slug, from, to }], [next, "next", { slug, from, to }],
      [batch, "batch", { slugs: [slug], from, to }]] as const) {
      const response = await post(handler, path, body);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ code: "INVALID_DATE_RANGE" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
    }
    expect((await getCalendar(from, to)).status).toBe(400);
  });

test("the last accepted day 9998-12-31 and a 365-day window answer without overflow", async () => {
  const response = await post(next, "next", { slug, from: "9998-12-31", to: "9998-12-31" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ found: true, from: "9998-12-31", to: "9998-12-31" });
  expect((await post(check, "check", { slug, from: "9998-01-01", to: "9998-12-31" })).status).toBe(200);
});

test.each(["check", "next", "batch", "calendar"])("database failure in public %s is a reported no-store 500 without details", async (path) => {
  vi.spyOn(prisma.vehicle, "findFirst").mockRejectedValue(new Error("secret connection detail"));
  vi.spyOn(prisma.vehicle, "findMany").mockRejectedValue(new Error("secret connection detail"));
  vi.spyOn(prisma.hostMapping, "findUnique").mockRejectedValue(new Error("secret connection detail"));
  vi.spyOn(prisma.hostMapping, "findFirst").mockRejectedValue(new Error("secret connection detail"));
  const response = path === "calendar" ? await getCalendar(today, today)
    : await post(path === "check" ? check : path === "next" ? next : batch, path,
      path === "batch" ? { slugs: [slug], from: today, to: today } : { slug, from: today, to: today });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: "INTERNAL_ERROR" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(reported).toHaveBeenCalledWith("availability.public");
});

test("a transient database error is a 503 with Retry-After and no-store", async () => {
  const transient = Object.assign(new Error("deadlock"), { code: "P2034" });
  vi.spyOn(prisma.hostMapping, "findUnique").mockRejectedValue(transient);
  vi.spyOn(prisma.hostMapping, "findFirst").mockRejectedValue(transient);
  vi.spyOn(prisma.vehicle, "findFirst").mockRejectedValue(transient);
  const response = await post(check, "check", { slug, from: today, to: today });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
});
