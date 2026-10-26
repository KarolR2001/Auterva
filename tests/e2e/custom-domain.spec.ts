import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { routingProof } from "../../src/modules/domains/proof";

function get(port: number, host: string, path: string, method = "GET") {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("built app redirects the alias to the active custom domain only while the offer is visible", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const id = randomUUID();
  const suffix = id.slice(0, 8);
  const alias = `alias-${suffix}.public.example.test`;
  const panel = `panel-${suffix}.sites.example.test`;
  const custom = `www.firma-${suffix}.klient.example.test`;
  const path = "/pojazdy/bus-1/?od=2099-01-01&do=2099-01-02";
  const token = `e2e-token-${suffix}`;
  await db.organization.create({ data: { id, slug: `e2e-domain-${id}`, firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) } });
  await db.serviceAccess.create({ data: { organizationId: id, paidThrough: new Date("2099-12-31T00:00:00.000Z") } });
  try {
    await db.hostMapping.create({ data: { organizationId: id, hostname: custom, area: "COMPANY_PUBLIC", kind: "CUSTOM", status: "PENDING" } });
    const mapping = await db.hostMapping.findUniqueOrThrow({ where: { hostname: custom } });
    await db.customDomain.create({ data: { organizationId: id, hostMappingId: mapping.id, verificationToken: token } });
    await db.hostMapping.createMany({ data: [
      { organizationId: id, hostname: alias, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { organizationId: id, hostname: panel, area: "COMPANY_ADMIN", status: "ACTIVE" },
    ] });
    // Before activation: the alias serves, the pending custom host answers only the routing probe.
    expect((await get(port, alias, "/")).status).toBe(200);
    expect((await get(port, custom, "/")).status).toBe(404);
    const probe = await get(port, custom, "/.well-known/auterva-domain-check/");
    expect(probe.status).toBe(200);
    expect(JSON.parse(probe.body)).toEqual({ proof: routingProof(custom, token) });
    expect((await get(port, alias, "/.well-known/auterva-domain-check/")).status).toBe(404);
    expect((await get(port, `unknown-${suffix}.example.test`, "/.well-known/auterva-domain-check/")).status).toBe(404);
    // A panel host is never a public fallback.
    for (const route of ["/", "/pojazdy/", "/kontakt/"]) expect((await get(port, panel, route)).status).toBe(404);

    await db.customDomain.update({ where: { organizationId: id }, data: { status: "ACTIVE", activatedAt: new Date(),
      ownershipVerifiedAt: new Date(), routingVerifiedAt: new Date(), tlsVerifiedAt: new Date() } });
    await db.hostMapping.update({ where: { id: mapping.id }, data: { status: "ACTIVE" } });
    await db.hostMapping.update({ where: { hostname: alias }, data: { canonicalTarget: custom } });
    // Warm both addresses, then shorten the period and ask again.
    const redirect = await get(port, alias, path);
    expect(redirect.status).toBe(307);
    expect(redirect.headers.location).toBe(`https://${custom}${path}`);
    expect(redirect.headers["cache-control"]).toContain("no-store");
    expect((await get(port, custom, "/")).status).toBe(200);
    await db.serviceAccess.update({ where: { organizationId: id }, data: { paidThrough: new Date("2020-01-01T00:00:00.000Z") } });
    const closed = await get(port, alias, path);
    expect(closed.status).toBe(404);
    expect(closed.headers.location).toBeUndefined();
    expect((await get(port, custom, "/")).status).toBe(404);
    expect((await get(port, custom, "/pojazdy/")).body).not.toMatch(/Oferta firmy/);
  } finally {
    await db.customDomain.deleteMany({ where: { organizationId: id } });
    await db.hostMapping.deleteMany({ where: { organizationId: id } });
    await db.serviceAccess.deleteMany({ where: { organizationId: id } });
    await db.organization.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
