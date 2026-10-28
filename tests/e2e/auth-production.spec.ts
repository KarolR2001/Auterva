import { test, expect } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";

test("production auth refuses a mapped admin host without trusted ingress, even with the old probe flag", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("Missing E2E base URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const hostname = new URL(baseURL).hostname;
  await db.hostMapping.create({ data: { hostname, area: "PLATFORM", status: "ACTIVE" } });
  try {
    const response = await request.get("/api/auth/get-session/");
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
  } finally {
    await db.hostMapping.delete({ where: { hostname } });
    await db.$disconnect();
  }
});

test("liveness stays green and legacy /api/health is unchanged; readiness is red without storage and never leaks details; metrics are not public (#58)", async ({ request }) => {
  const legacy = await request.get("/api/health/");
  expect(legacy.status()).toBe(200);
  expect(await legacy.json()).toMatchObject({ status: "ok" });
  const live = await request.get("/api/health/live/");
  expect(live.status()).toBe(200);
  expect(live.headers()["cache-control"]).toBe("no-store");
  // This server has no object storage configured: a missing dependency is not green, and the body stays a bare status.
  const ready = await request.get("/api/health/ready/");
  expect(ready.status()).toBe(503);
  expect(await ready.json()).toEqual({ status: "fail" });
  // No OPS_METRICS_TOKEN: the endpoint does not exist, with or without credentials.
  expect((await request.get("/api/health/metrics/")).status()).toBe(404);
  expect((await request.get("/api/health/metrics/", { headers: { Authorization: "Bearer guess" } })).status()).toBe(404);
});
