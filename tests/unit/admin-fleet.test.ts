import { describe, expect, it } from "vitest";
import { addDays, blocksWithin, nearestBlocks, warsawToday } from "../../src/components/admin/dashboard";
import { emptyQuery, errorMessage, isUncertain, queryFromSearch, readErrorMessage, rowActions, searchFromQuery, statusSummary } from "../../src/components/admin/fleet-api";
import type { FleetItem } from "../../src/components/admin/fleet-api";
import { filtersActive, REORDER_LIMIT, reorderPayload } from "../../src/components/admin/vehicle-list";

const item = (id: string, sortOrder: number, version = 0): FleetItem => ({ id, name: id, slug: id, status: "PUBLISHED", category: null,
  sortOrder, version, updatedAt: "2026-10-29T10:00:00.000Z", price: null, cover: null, activeToday: true, availableToday: true });

describe("#34 fleet list", () => {
  it("offers only the status actions the SPEC allows", () => {
    expect(rowActions("PUBLISHED")).toEqual(["unpublish", "archive"]);
    expect(rowActions("DRAFT")).toEqual(["archive"]);
    expect(rowActions("UNPUBLISHED")).toEqual(["archive"]);
    expect(rowActions("ARCHIVED")).toEqual([]);
  });

  it("moves a vehicle by swapping sort values and sends only changed rows with their versions", () => {
    const plan = reorderPayload([item("a", 1, 3), item("b", 2, 5), item("c", 3, 7)], 0, 1) as Exclude<ReturnType<typeof reorderPayload>, null | { error: string }>;
    expect(plan.items.map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(plan.changes).toEqual([{ id: "b", expectedVersion: 5, sortOrder: 1 }, { id: "a", expectedVersion: 3, sortOrder: 2 }]);
  });

  it("renumbers the whole fleet when sort values tie, and refuses moves past the ends", () => {
    const plan = reorderPayload([item("a", 4), item("b", 4), item("c", 4)], 2, -1) as Exclude<ReturnType<typeof reorderPayload>, null | { error: string }>;
    expect(plan.items.map((row) => row.id)).toEqual(["a", "c", "b"]);
    expect(plan.changes.map((change) => [change.id, change.sortOrder])).toEqual([["a", 0], ["c", 1], ["b", 2]]);
    expect(reorderPayload([item("a", 1), item("b", 2)], 0, -1)).toBeNull();
    expect(reorderPayload([item("a", 1), item("b", 2)], 1, 1)).toBeNull();
  });

  it("keeps vehicles of other pages in place when many new vehicles share sortOrder 0", () => {
    // 22 vehicles, all 0, public order by id: moving V03 down must renumber all 22 so nothing jumps between pages.
    const fleet = Array.from({ length: 22 }, (_, n) => item(`V${String(n).padStart(2, "0")}`, 0));
    const plan = reorderPayload(fleet, 3, 1) as Exclude<ReturnType<typeof reorderPayload>, null | { error: string }>;
    expect(plan.items.map((row) => row.id).slice(0, 6)).toEqual(["V00", "V01", "V02", "V04", "V03", "V05"]);
    const byId = new Map(plan.changes.map((change) => [change.id, change.sortOrder]));
    const finalOrder = plan.items.map((row, position) => byId.get(row.id) ?? fleet.find((f) => f.id === row.id)!.sortOrder ?? position);
    // Every vehicle ends up with a distinct, strictly increasing value that matches the intended order.
    expect(new Set(finalOrder).size).toBe(22);
    expect([...finalOrder].sort((x, y) => x - y)).toEqual(finalOrder);
    expect(plan.changes.length).toBeGreaterThanOrEqual(21);
  });

  it("refuses a tied fleet that one atomic call cannot renumber, but still moves a distinct one", () => {
    const tied = Array.from({ length: REORDER_LIMIT + 1 }, (_, n) => item(`T${n}`, 0));
    expect(reorderPayload(tied, 0, 1)).toEqual({ error: "TOO_MANY" });
    const distinct = Array.from({ length: REORDER_LIMIT + 5 }, (_, n) => item(`D${n}`, n + 1));
    const plan = reorderPayload(distinct, 0, 1) as Exclude<ReturnType<typeof reorderPayload>, null | { error: string }>;
    expect(plan.changes.map((change) => change.id)).toEqual(["D1", "D0"]);
  });

  it("treats 5xx and a lost connection as an unknown outcome, never a plain failure", () => {
    expect(isUncertain({ status: 0 })).toBe(true);
    expect(isUncertain({ status: 502 })).toBe(true);
    expect(isUncertain({ status: 409 })).toBe(false);
    expect(isUncertain({ status: 404 })).toBe(false);
  });

  it("never speaks of an unsaved change when a read fails", () => {
    for (const code of ["NETWORK", "UNKNOWN", "INTERNAL_ERROR", "FORBIDDEN", "RATE_LIMITED"]) expect(readErrorMessage(code)).not.toMatch(/nie została zapisana/i);
    expect(readErrorMessage("UNKNOWN")).toMatch(/pobrać danych/);
  });

  it("counts blocks that overlap the next 7 days", () => {
    const block = (from: string, to: string) => ({ id: from, from, to, type: "MAINTENANCE", typeLabel: "Serwis", version: 0 });
    const items = [{ blocks: [block("2026-11-01", "2026-11-02"), block("2026-11-09", "2026-11-12"), block("2026-11-14", "2026-11-18")] }];
    expect(blocksWithin(items, "2026-11-08")).toBe(2);
  });

  it("tells active filters from an unfiltered list, so an empty fleet is not a no-results state", () => {
    const empty = emptyQuery;
    expect(filtersActive(empty)).toBe(false);
    expect(filtersActive({ ...empty, search: "  " })).toBe(false);
    expect(filtersActive({ ...empty, availableToday: "false" })).toBe(true);
    expect(filtersActive({ ...empty, categoryId: "c" })).toBe(true);
    expect(filtersActive({ ...empty, sort: "updatedDesc" })).toBe(false);
  });

  it("shows stable error codes as safe Polish messages, never raw codes", () => {
    expect(errorMessage("FLEET_VERSION_CONFLICT")).toMatch(/zmieniony/);
    expect(errorMessage("SOMETHING_NEW")).not.toContain("SOMETHING_NEW");
  });
});

describe("#34 dashboard", () => {
  it("uses the Warsaw calendar day, also right after local midnight", () => {
    expect(warsawToday(new Date("2026-10-29T22:30:00.000Z"))).toBe("2026-10-29");
    expect(warsawToday(new Date("2026-10-29T23:30:00.000Z"))).toBe("2026-10-30");
    expect(addDays("2026-10-25", 7)).toBe("2026-11-01");
  });

  it("lists running and upcoming blocks first, drops finished ones and caps the list", () => {
    const block = (id: string, from: string, to: string) => ({ id, from, to, type: "MAINTENANCE", typeLabel: "Serwis", version: 0 });
    const blocks = nearestBlocks([
      { vehicleId: "v1", name: "Alfa", blocks: [block("b1", "2026-11-05", "2026-11-06"), block("old", "2026-10-01", "2026-10-02")] },
      { vehicleId: "v2", name: null, blocks: [block("b2", "2026-10-28", "2026-10-30"), block("b3", "2026-11-01", "2026-11-01")] },
    ], "2026-10-29", 2);
    expect(blocks.map((row) => row.id)).toEqual(["b2", "b3"]);
    expect(blocks[0].vehicleName).toBe("Pojazd bez nazwy");
  });

  it("keeps list filters in the address and falls back to defaults for malformed values (D-42)", () => {
    const category = "3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b";
    const query = { ...emptyQuery, search: "van", status: "PUBLISHED" as const, categoryId: category,
      sort: "updatedDesc" as const, page: 3 };
    expect(queryFromSearch(searchFromQuery(query))).toEqual(query);
    expect(searchFromQuery(emptyQuery)).toBe("");
    expect(queryFromSearch("?status=HIDDEN&categoryId=x&updatedFrom=2026-11-01&sort=price&page=-2&activeToday=maybe")).toEqual(emptyQuery);
  });

  it("summarises statuses like the mockup, with Polish plurals and no zero parts", () => {
    expect(statusSummary({ all: 6, published: 5, draft: 0, unpublished: 1, archived: 0 })).toBe("6 pojazdów • 5 opublikowanych • 1 ukryty");
    expect(statusSummary({ all: 1, published: 0, draft: 1, unpublished: 0, archived: 0 })).toBe("1 pojazd • 1 szkic");
    expect(statusSummary({ all: 12, published: 2, draft: 3, unpublished: 2, archived: 5 })).toBe("12 pojazdów • 2 opublikowane • 3 szkice • 2 ukryte • 5 zarchiwizowanych");
    expect(statusSummary({ all: 0, published: 0, draft: 0, unpublished: 0, archived: 0 })).toBe("0 pojazdów");
    // Compact (mobile) line like the mockup "6 pojazdów • 1 ukryty": published are implied, all-published fleet names them.
    expect(statusSummary({ all: 6, published: 5, draft: 0, unpublished: 1, archived: 0 }, true)).toBe("6 pojazdów • 1 ukryty");
    expect(statusSummary({ all: 3, published: 3, draft: 0, unpublished: 0, archived: 0 }, true)).toBe("3 pojazdy • 3 opublikowane");
  });
});
