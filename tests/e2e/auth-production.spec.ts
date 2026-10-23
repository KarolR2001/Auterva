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
