import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

type Reply = { status: number; headers: IncomingHttpHeaders; text: string; json: () => unknown };

function onHost(port: number, host: string, path: string, method = "GET"): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: { Host: host } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: raw,
        json: () => JSON.parse(raw) as unknown }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("built ingress: public offer, SEO routes and panels per host; a shortened period cuts every path cold", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = Number(new URL(baseURL).port);
  const [a, b, vehicleA, vehicleB] = Array.from({ length: 4 }, () => randomUUID());
  const host = { a: `offer-e2e-a-${a}.example.test`, b: `offer-e2e-b-${b}.example.test`, admin: `offer-e2e-admin-${a}.example.test`,
    marketing: `offer-e2e-marketing-${a}.example.test`, alias: `offer-e2e-alias-${a}.example.test`, custom: `offer-e2e-custom-${a}.example.test` };
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const slugA = `e2e-a-${vehicleA}`;
  const slugB = `e2e-b-${vehicleB}`;
  try {
    for (const [id, name] of [[a, "Firma E2E A"], [b, "Firma E2E B"]]) {
      await db.organization.create({ data: { id, slug: `offer-e2e-${id}`, name, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
        trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
      await db.siteSettings.create({ data: { organizationId: id, publicName: name, email: "e2e@example.test",
        operatorNote: "E2E-OPERATOR", seoTitle: `SEO ${name}` } });
    }
    await db.hostMapping.createMany({ data: [
      { hostname: host.a, organizationId: a, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: host.b, organizationId: b, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: host.admin, organizationId: a, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: host.marketing, area: "MARKETING", status: "ACTIVE" },
    ] });
    const vehicle = { status: "PUBLISHED", availableFrom: sqlDate(today), shortDescription: "Opis", description: "Pełny <b>opis</b>" };
    await db.vehicle.createMany({ data: [
      { ...vehicle, id: vehicleA, organizationId: a, slug: slugA, name: "Auto A" },
      { ...vehicle, id: vehicleB, organizationId: b, slug: slugB, name: "Auto B" },
    ] });
    await db.availabilityBlock.create({ data: { organizationId: a, vehicleId: vehicleA, from: sqlDate(day(2)), to: sqlDate(day(2)),
      type: "MAINTENANCE", reference: "E2E-REF", internalNote: "E2E-NOTE" } });

    // Cold contexts for both companies: own data only, no private field, per-host canonical.
    const homeA = await onHost(port, host.a, "/api/public/offer/");
    expect(homeA.status).toBe(200);
    expect(homeA.headers["cache-control"]).toBe("no-store");
    expect(homeA.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(homeA.json()).toMatchObject({ offerState: "HAS_VEHICLES", seo: { title: "SEO Firma E2E A",
      canonical: `https://${host.a}/` } });
    const listA = await onHost(port, host.a, `/api/public/vehicles/?from=${day(2)}&to=${day(2)}`);
    expect(listA.json()).toMatchObject({ state: "NO_RESULTS", total: 0 }); // the blocked day, inclusive
    expect((await onHost(port, host.a, `/api/public/vehicles/?from=${day(3)}&to=${day(3)}`)).json())
      .toMatchObject({ state: "RESULTS", total: 1 });
    expect((await onHost(port, host.a, "/api/public/vehicles/?seats=0")).status).toBe(400);
    expect((await onHost(port, host.b, `/api/public/vehicles/${slugA}/`)).status).toBe(404);
    expect((await onHost(port, host.b, `/api/public/vehicles/${slugB}/`)).status).toBe(200);
    const everything = [homeA.text, listA.text, (await onHost(port, host.a, `/api/public/vehicles/${slugA}/`)).text,
      (await onHost(port, host.a, "/api/public/contact/")).text, (await onHost(port, host.a, "/sitemap.xml")).text];
    for (const secret of ["E2E-REF", "E2E-NOTE", "E2E-OPERATOR", "MAINTENANCE", host.b, slugB]) {
      for (const text of everything) expect(text).not.toContain(secret);
    }
    const sitemap = await onHost(port, host.a, "/sitemap.xml");
    expect(sitemap.headers["content-type"]).toContain("application/xml");
    expect(sitemap.text).toContain(`<loc>https://${host.a}/pojazdy/${slugA}/</loc>`);
    expect((await onHost(port, host.a, "/robots.txt")).text).toContain(`Sitemap: https://${host.a}/sitemap.xml`);
    // Contact is read only.
    expect((await onHost(port, host.a, "/api/public/contact/", "POST")).status).toBe(405);
    // Panels: closed to crawlers; no sitemap on them.
    const adminRobots = await onHost(port, host.admin, "/robots.txt");
    expect(adminRobots.text).toBe("User-agent: *\nDisallow: /\n");
    expect(adminRobots.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await onHost(port, host.admin, "/sitemap.xml")).status).toBe(404);
    expect((await onHost(port, host.admin, "/api/public/offer/")).status).toBe(404);

    // Other public API paths stay noindex; the marketing host is indexable and lists no company (D-25).
    for (const path of ["/api/public/contact/", "/api/public/media/not-a-uuid/large/", "/api/public/settings/"])
      expect((await onHost(port, host.a, path)).headers["x-robots-tag"], path).toBe("noindex, nofollow");
    const marketingRobots = await onHost(port, host.marketing, "/robots.txt");
    expect(marketingRobots.status).toBe(200);
    expect(marketingRobots.text).toBe(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://${host.marketing}/sitemap.xml\n`);
    expect(marketingRobots.headers["x-robots-tag"]).toBeUndefined();
    const marketingSitemap = await onHost(port, host.marketing, "/sitemap.xml");
    expect(marketingSitemap.status).toBe(200);
    expect(marketingSitemap.headers["content-type"]).toContain("application/xml");
    expect(marketingSitemap.text).toContain(`<loc>https://${host.marketing}/</loc>`);
    for (const hidden of [host.a, host.b, host.admin, "Firma E2E"]) expect(marketingSitemap.text).not.toContain(hidden);

    // Alias with an active custom domain redirects (path and query kept) and never serves the offer.
    await db.hostMapping.createMany({ data: [
      { hostname: host.custom, organizationId: a, area: "COMPANY_PUBLIC", status: "ACTIVE", kind: "CUSTOM" },
      { hostname: host.alias, organizationId: a, area: "COMPANY_PUBLIC", status: "ACTIVE", canonicalTarget: host.custom },
    ] });
    const aliased = await onHost(port, host.alias, `/pojazdy/?from=${day(3)}&to=${day(3)}`);
    expect(aliased.status).toBe(307);
    expect(aliased.headers.location).toBe(`https://${host.custom}/pojazdy/?from=${day(3)}&to=${day(3)}`);
    expect((await onHost(port, host.custom, "/sitemap.xml")).text).toContain(`<loc>https://${host.custom}/`);
    await db.hostMapping.deleteMany({ where: { hostname: { in: [host.alias, host.custom] } } });

    // Period shortened to nothing: every path of company A answers 404 at once; B is untouched.
    await db.organization.update({ where: { id: a }, data: { publicRequiresPaid: true } });
    await db.serviceAccess.update({ where: { organizationId: a }, data: { paidThrough: sqlDate(day(-1)) } });
    for (const path of ["/api/public/offer/", "/api/public/vehicles/", `/api/public/vehicles/${slugA}/`, "/api/public/contact/",
      "/api/public/legal/privacy/", "/sitemap.xml", "/robots.txt", "/api/public/settings/"]) {
      const closed = await onHost(port, host.a, path);
      expect(closed.status, path).toBe(404);
      expect(closed.text, path).not.toContain("Firma E2E A");
    }
    expect((await onHost(port, host.b, "/api/public/offer/")).status).toBe(200);
  } finally {
    await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.vehicle.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.siteSettings.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.hostMapping.deleteMany({ where: { hostname: host.marketing } });
    await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
    await db.$disconnect();
  }
});
