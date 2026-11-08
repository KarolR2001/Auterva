import { expect, test } from "vitest";
import { calendarRange, catalogHref, cleanCatalogSearch, contactHref, monthDays, monthLabel, parseMonth, shiftMonth, formatPrice, formatRangeLong, formatRangeShort, pluralVehicles, withRange }
  from "../../src/modules/public-offer/presentation";

test("a GET form's empty fields and the default sort are dropped, unknown parameters stay", () => {
  expect(cleanCatalogSearch({ category: "", seats: "", from: "2026-11-10", to: "2026-11-12", sort: "recommended", utm: "x" }))
    .toBe("from=2026-11-10&to=2026-11-12&utm=x");
  expect(cleanCatalogSearch({ category: "suv", sort: "name" })).toBeNull();
  expect(cleanCatalogSearch({ category: "", seats: "" })).toBe("");
});

test("catalog and card links keep the filters and the dates", () => {
  expect(catalogHref({})).toBe("/pojazdy/");
  expect(catalogHref({ category: "suv", from: "2026-11-10", to: "2026-11-12", sort: "recommended", cursor: null }))
    .toBe("/pojazdy/?category=suv&from=2026-11-10&to=2026-11-12");
  expect(withRange("/pojazdy/a/", { from: "2026-11-10", to: "2026-11-12" })).toBe("/pojazdy/a/?from=2026-11-10&to=2026-11-12");
  expect(withRange("/pojazdy/a/", { from: null, to: null })).toBe("/pojazdy/a/");
});

test("a missing price is never shown as 0 zł", () => {
  expect(formatPrice(null)).toBe("Cena na zapytanie");
  expect(formatPrice({ amount: "149.00", unit: "doba" })).toBe("od 149 zł / doba");
  expect(formatPrice({ amount: "149.50", unit: null })).toBe("od 149,50 zł / doba");
});

test("date ranges and counts read in Polish", () => {
  expect(formatRangeShort("2026-10-20", "2026-10-22")).toBe("20–22.10.2026");
  expect(formatRangeShort("2026-10-20", "2026-10-20")).toBe("20.10.2026");
  expect(formatRangeLong("2026-10-20", "2026-10-22")).toBe("20–22 października 2026");
  expect(formatRangeLong("2026-10-31", "2026-11-01")).toBe("31 października 2026 – 1 listopada 2026");
  expect([1, 2, 5, 12, 22].map(pluralVehicles)).toEqual(["1 pojazd", "2 pojazdy", "5 pojazdów", "12 pojazdów", "22 pojazdy"]);
});

test("vehicle calendar: month window, Monday-first grid and never a past query", () => {
  expect(parseMonth(undefined, "2026-10-29")).toBe("2026-10");
  expect(parseMonth("2026-09", "2026-10-29")).toBe("2026-10"); // past month
  expect(parseMonth("2027-11", "2026-10-29")).toBe("2026-10"); // beyond a year
  expect(parseMonth("2027-10", "2026-10-29")).toBe("2027-10");
  expect(parseMonth("garbage", "2026-10-29")).toBe("2026-10");
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(monthLabel("2026-10")).toBe("Październik 2026");
  const days = monthDays("2026-10");
  expect(days).toHaveLength(31);
  expect(days[0]).toEqual({ date: "2026-10-01", weekday: 3 }); // Thursday
  expect(calendarRange("2026-10", "2026-10-29")).toEqual({ from: "2026-10-29", to: "2026-10-31" });
  expect(calendarRange("2026-11", "2026-10-29")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  expect(calendarRange("2026-09", "2026-10-29")).toBeNull();
});

test("contact link of a vehicle keeps the vehicle and the dates", () => {
  expect(contactHref("atlas", { from: "2026-11-10", to: "2026-11-12" })).toBe("/kontakt/?vehicle=atlas&from=2026-11-10&to=2026-11-12");
  expect(contactHref("atlas", { from: null, to: null })).toBe("/kontakt/?vehicle=atlas");
  expect(contactHref(null, { from: null, to: null })).toBe("/kontakt/");
});
