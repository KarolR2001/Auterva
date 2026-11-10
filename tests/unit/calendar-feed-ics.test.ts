import { describe, expect, test } from "vitest";
import { escapeIcsText, eventUid, foldIcsLine, renderFeed, unavailableRanges } from "../../src/modules/calendar-feed/ics";
import { scrubString } from "../../src/modules/observability/redact";

const base = { windowFrom: "2028-02-20", windowTo: "2028-03-10" };

describe("unavailableRanges", () => {
  test("one day is a valid range and adjacent days merge, a gap does not", () => {
    expect(unavailableRanges({ ...base, availableFrom: "2028-01-01", availableTo: null,
      blocks: [{ from: "2028-02-25", to: "2028-02-25" }] })).toEqual([{ from: "2028-02-25", to: "2028-02-25" }]);
    expect(unavailableRanges({ ...base, availableFrom: "2028-01-01", availableTo: null,
      blocks: [{ from: "2028-02-25", to: "2028-02-26" }, { from: "2028-02-27", to: "2028-02-27" },
        { from: "2028-03-01", to: "2028-03-02" }] }))
      .toEqual([{ from: "2028-02-25", to: "2028-02-27" }, { from: "2028-03-01", to: "2028-03-02" }]);
  });
  test("activity bounds are inclusive: the day before the start and after the end are unavailable", () => {
    expect(unavailableRanges({ ...base, availableFrom: "2028-02-22", availableTo: "2028-03-05", blocks: [] }))
      .toEqual([{ from: "2028-02-20", to: "2028-02-21" }, { from: "2028-03-06", to: "2028-03-10" }]);
    expect(unavailableRanges({ ...base, availableFrom: "2028-02-20", availableTo: "2028-03-10", blocks: [] })).toEqual([]);
  });
  test("blocks outside the window are clipped, an open activity end adds nothing", () => {
    expect(unavailableRanges({ ...base, availableFrom: "2028-01-01", availableTo: null,
      blocks: [{ from: "2028-02-10", to: "2028-02-21" }, { from: "2028-03-09", to: "2028-04-01" }] }))
      .toEqual([{ from: "2028-02-20", to: "2028-02-21" }, { from: "2028-03-09", to: "2028-03-10" }]);
  });
});

describe("renderFeed", () => {
  const now = new Date("2028-02-20T10:00:00Z");
  const render = (name: string | null, ranges: { from: string; to: string }[]) => renderFeed({ organizationId: "o", now, secret: "s".repeat(32),
    vehicles: [{ id: "v", name, ranges }] });
  test("DTEND is the day after the inclusive end, across a leap day and a month end", () => {
    const { body } = render("Auto", [{ from: "2028-02-28", to: "2028-02-28" }, { from: "2028-02-29", to: "2028-02-29" },
      { from: "2028-12-31", to: "2028-12-31" }]);
    expect(body).toContain("DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280229\r\n");
    expect(body).toContain("DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301\r\n");
    expect(body).toContain("DTSTART;VALUE=DATE:20281231\r\nDTEND;VALUE=DATE:20290101\r\n");
    expect(body).toContain("DTSTAMP:20280220T100000Z");
  });
  test("a vehicle name cannot inject lines or properties", () => {
    const { body } = render("A\r\nBEGIN:VEVENT\nX:y;z,\\", [{ from: "2028-02-28", to: "2028-02-28" }]);
    expect(body.match(/^BEGIN:VEVENT\r$/gm)).toHaveLength(1);
    expect(body).toContain("SUMMARY:Niedostępny: A\\nBEGIN:VEVENT\\nX:y\\;z\\,\\\\");
  });
  test("lines fold at 75 octets without splitting a multibyte character and unfold to the original", () => {
    const text = `SUMMARY:${"zażółć gęślą jaźń ".repeat(12)}`;
    const lines = foldIcsLine(text);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join("")).toBe(text);
    expect(escapeIcsText("a\u0000b\u0007c")).toBe("abc");
  });
  test("UID is an HMAC that carries neither id, is stable and differs per key", () => {
    const uid = eventUid("k".repeat(32), "org-id", "vehicle-id", "2028-02-28");
    expect(uid).toMatch(/^[0-9a-f]{40}@auterva$/);
    expect(uid).toBe(eventUid("k".repeat(32), "org-id", "vehicle-id", "2028-02-28"));
    expect(uid).not.toBe(eventUid("j".repeat(32), "org-id", "vehicle-id", "2028-02-28"));
  });
  test("the event cap is reported, not applied silently", () => {
    const result = renderFeed({ organizationId: "o", now, secret: "s".repeat(32), maxEvents: 1, vehicles: [
      { id: "v", name: "A", ranges: [{ from: "2028-02-28", to: "2028-02-28" }, { from: "2028-03-02", to: "2028-03-02" }] }] });
    expect(result).toMatchObject({ events: 1, truncated: true });
  });
});

test("log redaction masks the feed secret in the path", () => {
  const secret = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
  expect(scrubString(`GET /api/calendar/feed/${secret}.ics 404`)).toBe("GET /api/calendar/feed/[token] 404");
  expect(scrubString(`/api/calendar/feed/short.ics?x=1`)).toBe("/api/calendar/feed/[token]?x=1");
});
