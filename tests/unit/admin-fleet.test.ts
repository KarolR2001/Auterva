import { describe, expect, it } from "vitest";
import { addDays, nearestBlocks, warsawToday } from "../../src/components/admin/dashboard";
import { errorMessage, rowActions } from "../../src/components/admin/fleet-api";
import type { FleetItem } from "../../src/components/admin/fleet-api";
import { filtersActive, reorderPayload } from "../../src/components/admin/vehicle-list";

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
    const plan = reorderPayload([item("a", 1, 3), item("b", 2, 5), item("c", 3, 7)], 0, 1)!;
    expect(plan.items.map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(plan.changes).toEqual([{ id: "b", expectedVersion: 5, sortOrder: 1 }, { id: "a", expectedVersion: 3, sortOrder: 2 }]);
  });

  it("renumbers the page when sort values tie, and refuses moves past the ends", () => {
    const plan = reorderPayload([item("a", 4), item("b", 4), item("c", 4)], 2, -1)!;
    expect(plan.items.map((row) => row.id)).toEqual(["a", "c", "b"]);
    expect(plan.changes.map((change) => [change.id, change.sortOrder])).toEqual([["c", 5], ["b", 6]]);
    expect(reorderPayload([item("a", 1), item("b", 2)], 0, -1)).toBeNull();
    expect(reorderPayload([item("a", 1), item("b", 2)], 1, 1)).toBeNull();
  });

  it("tells active filters from an unfiltered list, so an empty fleet is not a no-results state", () => {
    const empty = { search: "", status: "" as const, activeToday: "" as const, availableToday: "" as const, page: 1, pageSize: 20 };
    expect(filtersActive(empty)).toBe(false);
    expect(filtersActive({ ...empty, search: "  " })).toBe(false);
    expect(filtersActive({ ...empty, availableToday: "false" })).toBe(true);
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
});
