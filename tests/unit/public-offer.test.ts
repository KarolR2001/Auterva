import { expect, test } from "vitest";
import { readPublicTrafficLimits } from "../../src/modules/public-offer/config";
import { publicImageAlt } from "../../src/modules/public-offer/images";
import { decodeCursor, encodeCursor, filterFingerprint, parseCatalogQuery } from "../../src/modules/public-offer/query";
import { clip, publicOrigin, robotsTxt, serializeJsonLd, sitemapXml } from "../../src/modules/public-offer/seo";

const now = new Date("2026-11-10T12:00:00Z");
const parse = (query: string) => parseCatalogQuery(new URLSearchParams(query), now);

test("traffic budgets live in one place; media has its own and is configurable", () => {
  expect(readPublicTrafficLimits({})).toEqual({ offerRead: { limit: 120, windowMs: 60_000 }, media: { limit: 600, windowMs: 60_000 } });
  expect(readPublicTrafficLimits({ AUTERVA_PUBLIC_MEDIA_RATE_LIMIT: "900" }).media.limit).toBe(900);
  for (const bad of ["0", "-1", "1.5", "abc", "10001"]) {
    expect(() => readPublicTrafficLimits({ AUTERVA_PUBLIC_MEDIA_RATE_LIMIT: bad })).toThrow();
  }
});

test("catalog query: LocalDate bounds are inclusive, one day is valid, today is Warsaw", () => {
  expect(parse("from=2026-11-10&to=2026-11-10")).toMatchObject({ ok: true, query: { filters: { range: { days: 1 } } } });
  expect(parse("from=2026-11-09&to=2026-11-10")).toEqual({ ok: false, error: { code: "PAST_DATE", field: "from" } });
  expect(parse("from=2026-11-10&to=2027-11-09")).toMatchObject({ ok: true }); // 365 days
  expect(parse("from=2026-11-10&to=2027-11-10")).toMatchObject({ ok: false });
  expect(parse("from=2026-02-30&to=2026-03-01")).toMatchObject({ ok: false });
  // 23:30 UTC on 9 Nov is already 10 Nov in Warsaw.
  expect(parseCatalogQuery(new URLSearchParams("from=2026-11-10&to=2026-11-10"), new Date("2026-11-09T23:30:00Z"))).toMatchObject({ ok: true });
  expect(parse("")).toMatchObject({ ok: true, query: { sort: "recommended", limit: 12, cursor: null } });
  expect(parse("sort=nonsense")).toMatchObject({ ok: false });
  expect(parse("category=Bad Code")).toMatchObject({ ok: false });
});

test("cursor round trip is bound to the filters and sort", () => {
  const filters = { category: null, minSeats: 5, transmission: "Manualna", range: null };
  const fingerprint = filterFingerprint(filters, "name");
  const cursor = encodeCursor({ v: 1, f: fingerprint, k: "Alfa", i: "9b2f2f35-8a5b-4d7c-9d3a-5f9d3c5b7a11" });
  expect(decodeCursor(cursor, fingerprint)).toMatchObject({ k: "Alfa" });
  expect(decodeCursor(cursor, filterFingerprint({ ...filters, minSeats: 7 }, "name"))).toBeNull();
  expect(decodeCursor(cursor, filterFingerprint(filters, "recommended"))).toBeNull();
  expect(filterFingerprint({ ...filters, transmission: "MANUALNA" }, "name")).toBe(fingerprint);
});

test("default alt is recomputed from the current name and position; an edited alt survives", () => {
  expect(publicImageAlt("Stara nazwa, zdjęcie 1", "Nowa nazwa", 1)).toBe("Nowa nazwa, zdjęcie 2");
  expect(publicImageAlt(null, null, 0)).toBe("Zdjęcie pojazdu 1");
  expect(publicImageAlt("  ", "Auto", 0)).toBe("Auto, zdjęcie 1");
  expect(publicImageAlt("Przód auta z logo", "Auto", 0)).toBe("Przód auta z logo");
  expect(publicImageAlt(null, "<b>Auto</b>", 0)).not.toMatch(/[<>]/);
});

test("SEO helpers: origin, clipping, escaping and sitemap/robots text", () => {
  expect(publicOrigin("a.example.test", null)).toBe("https://a.example.test");
  expect(publicOrigin("localhost", 3000)).toBe("http://localhost:3000");
  expect(clip("  a  b ", 10)).toBe("a b");
  expect([...clip("x".repeat(500), 160)!]).toHaveLength(160);
  expect(clip(null, 10)).toBeNull();
  const ld = serializeJsonLd({ name: "</script><script>alert(1)</script> & \u2028" });
  expect(ld).not.toMatch(new RegExp("[<>&\\u2028]"));
  expect(JSON.parse(ld).name).toContain("</script>");
  const xml = sitemapXml("https://a.example.test", [{ path: "/pojazdy/a&b/", lastModified: new Date("2026-11-01T10:00:00Z") }, { path: "/" }]);
  expect(xml).toContain("<loc>https://a.example.test/pojazdy/a&amp;b/</loc><lastmod>2026-11-01</lastmod>");
  expect(robotsTxt({ kind: "PRIVATE" })).toBe("User-agent: *\nDisallow: /\n");
  expect(robotsTxt({ kind: "PUBLIC", origin: "https://a.example.test" })).toContain("Sitemap: https://a.example.test/sitemap.xml");
});
