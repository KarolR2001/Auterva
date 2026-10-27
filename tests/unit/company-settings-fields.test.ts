import { expect, test } from "vitest";
import { parseGroupFields, parseSafeLink } from "../../src/modules/settings/fields";

test.each([
  ["https://example.test/a", "https://example.test/a"],
  [" https://Example.test/Path?q=1#x ", "https://example.test/Path?q=1#x"],
])("safe link %s", (input, expected) => expect(parseSafeLink(input)).toBe(expected));

test.each(["javascript:alert(1)", "data:text/html,x", "http://example.test", "//example.test", "/x", "https://u:p@example.test",
  "https://exa mple.test", "https://example.test/\\x", "https://localhost", "ftp://example.test", "", "https://example.test/a\nb"])(
  "unsafe link %j is refused", (input) => expect(parseSafeLink(input)).toBeNull());

test("fields are trimmed, normalised and cleared with empty text; markup and control characters fail", () => {
  expect(parseGroupFields("contact", { email: " Biuro@Example.TEST ", phone: " " })).toEqual({ ok: true,
    data: { email: "biuro@example.test", phone: null } });
  expect(parseGroupFields("seo", { seoTitle: "<script>x</script>" })).toMatchObject({ ok: false, status: 400 });
  expect(parseGroupFields("seo", { seoTitle: "a\nb" })).toMatchObject({ ok: false, status: 400 });
  expect(parseGroupFields("legal", { privacyText: "linia 1\nlinia 2" })).toMatchObject({ ok: true });
  expect(parseGroupFields("address", { mapLatitude: 54.3520004 })).toEqual({ ok: true, data: { mapLatitude: 54.352 } });
});

test("read-only and unknown fields are distinguished, and a group never accepts another group's field", () => {
  expect(parseGroupFields("seo", { slug: "x" })).toMatchObject({ ok: false, status: 403 });
  expect(parseGroupFields("seo", { customHtml: "<b>" })).toMatchObject({ ok: false, status: 403 });
  expect(parseGroupFields("seo", { whatever: 1 })).toMatchObject({ ok: false, status: 400 });
  expect(parseGroupFields("seo", { phone: "+48 600 100 200" })).toMatchObject({ ok: false, status: 400 });
  expect(parseGroupFields("display", { featuredVehicleCount: 1.5 })).toMatchObject({ ok: false, status: 400 });
  expect(parseGroupFields("profile", { name: "  " })).toMatchObject({ ok: false, status: 400 });
});
