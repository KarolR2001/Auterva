import { expect, test } from "vitest";
import { catalogHref, cleanCatalogSearch, formatPrice, formatRangeLong, formatRangeShort, pluralVehicles, withRange }
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
