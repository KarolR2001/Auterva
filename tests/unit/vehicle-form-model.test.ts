import { describe, expect, it } from "vitest";
import type { VehicleDetail } from "../../src/components/admin/fleet-api";
import {
  changedPayload, emptyValues, isDirty, MAX_SORT_ORDER, mergeAfterConflict, normalizeServerField, publicationErrors, sectionOf,
  statusOutcome, toPayload, toValues, validateValues, type FormValues,
} from "../../src/components/admin/vehicle-form-model";

const detail = (patch: Partial<VehicleDetail> = {}): VehicleDetail => ({ id: "v", status: "DRAFT", version: 2, updatedAt: "2026-11-01T10:00:00.000Z",
  slug: "bus-9", name: "Bus 9", brand: null, model: null, variant: null, year: null, categoryId: null, category: null,
  shortDescription: null, description: null, seats: null, doors: null, transmission: null, drive: null, fuel: null, color: null,
  luggage: null, price: null, priceUnit: null, featured: false, sortOrder: 0, availableFrom: null, availableTo: null, features: [], images: [], ...patch });
const values = (patch: Partial<FormValues> = {}): FormValues => ({ ...emptyValues, ...patch });

describe("#35 vehicle form model", () => {
  it("lets an incomplete draft through: only technical validity is checked", () => {
    expect(validateValues(values())).toEqual({});
    expect(validateValues(values({ name: "Tylko nazwa" }))).toEqual({});
  });

  it("reports technical errors per field, including dates, price, counts and sortOrder bounds", () => {
    const errors = validateValues(values({ year: "1800", seats: "0", doors: "x", price: "12,345", availableFrom: "2026-02-31",
      availableTo: "2026-01-01", sortOrder: String(MAX_SORT_ORDER + 1), slug: "Zły slug!" }));
    expect(Object.keys(errors).sort()).toEqual(["availableFrom", "doors", "price", "seats", "slug", "sortOrder", "year"]);
    expect(validateValues(values({ sortOrder: String(MAX_SORT_ORDER) })).sortOrder).toBeUndefined();
    expect(validateValues(values({ sortOrder: "-1" })).sortOrder).toBeDefined();
    expect(validateValues(values({ availableFrom: "2026-10-23", availableTo: "2026-10-23" }))).toEqual({});
    expect(validateValues(values({ availableFrom: "2026-10-24", availableTo: "2026-10-23" })).availableTo).toBeDefined();
    expect(validateValues(values({ availableTo: "2026-10-23" })).availableFrom).toBeDefined();
  });

  it("accepts a decimal comma and never turns an empty price into zero", () => {
    expect(toPayload(values({ price: "350,5" })).price).toBe("350.5");
    expect(toPayload(values({ price: "" })).price).toBeNull();
    expect(validateValues(values({ price: "350,50" })).price).toBeUndefined();
  });

  it("flags duplicate and empty feature names on the row", () => {
    const features = [{ key: "a", code: "klima", value: "" }, { key: "b", code: "klima", value: "x" }, { key: "c", code: " ", value: "" }];
    const errors = validateValues(values({ features }));
    expect(errors["feature-a"]).toBeUndefined();
    expect(errors["feature-b"]).toBeDefined();
    expect(errors["feature-c"]).toBeDefined();
  });

  it("sends only changed fields and sees no change for an untouched form", () => {
    const base = toValues(detail({ brand: "Fiat", features: [{ code: "klima", value: null }] }));
    expect(isDirty(base, base)).toBe(false);
    expect(changedPayload(base, { ...base, name: "Bus 10", price: "100" })).toEqual({ name: "Bus 10", price: "100" });
    expect(changedPayload(base, { ...base, brand: "" })).toEqual({ brand: null });
    const withFeature = { ...base, features: [...base.features, { key: "n", code: "gps", value: "" }] };
    expect(Object.keys(changedPayload(base, withFeature))).toEqual(["features"]);
  });

  it("evaluates D-02 on the current values with the stored images", () => {
    const ready = [{ id: "i", status: "READY", isCover: true, alt: "a" }];
    const full = values({ name: "Bus", slug: "bus", categoryId: "c", shortDescription: "k", description: "d", seats: "9", availableFrom: "2026-10-23" });
    expect(publicationErrors(full, ready, true, true)).toEqual({});
    expect(Object.keys(publicationErrors(values({ name: "Bus" }), [], false, false)).sort())
      .toEqual(["availableFrom", "category", "description", "images", "shortDescription", "slug"]);
    expect(publicationErrors({ ...full, seats: "" }, ready, true, true).seats).toBeDefined();
    expect(publicationErrors({ ...full, seats: "" }, ready, false, true).seats).toBeUndefined();
  });

  it("maps server field names to the row or section where they are shown", () => {
    const v = values({ features: [{ key: "k1", code: "a", value: "" }, { key: "k2", code: "b", value: "" }] });
    expect(normalizeServerField("features.1.value", v)).toBe("feature-k2");
    expect(normalizeServerField("features.9.value", v)).toBe("features");
    expect(normalizeServerField("categoryId", v)).toBe("category");
    expect(sectionOf("shortDescription")).toBe("text");
    expect(sectionOf("feature-k1")).toBe("text");
    expect(sectionOf("availableTo")).toBe("availability");
    expect(sectionOf("images")).toBe("photos");
    expect(sectionOf("sortOrder")).toBe("publication");
  });

  it("keeps what the user typed after a version conflict and takes the rest from the server", () => {
    const base = toValues(detail({ brand: "Fiat", color: "biały" }));
    const mine = { ...base, name: "Moja nazwa", color: "czarny" };
    const theirs = { ...base, brand: "Ford", color: "zielony", price: "200" };
    const merged = mergeAfterConflict(base, mine, theirs);
    expect(merged.name).toBe("Moja nazwa");
    expect(merged.color).toBe("czarny");
    expect(merged.brand).toBe("Ford");
    expect(merged.price).toBe("200");
  });

  it("decides after a lost answer from the status the server reports", () => {
    expect(statusOutcome("publish", "PUBLISHED")).toBe("applied");
    expect(statusOutcome("publish", "DRAFT")).toBe("not-applied");
    expect(statusOutcome("unpublish", "UNPUBLISHED")).toBe("applied");
    expect(statusOutcome("unpublish", "PUBLISHED")).toBe("not-applied");
    expect(statusOutcome("archive", "ARCHIVED")).toBe("applied");
    expect(statusOutcome("archive", "UNPUBLISHED")).toBe("not-applied");
  });

  it("compares the slug case-insensitively so a change of letter case alone is no change", () => {
    const base = toValues(detail({ slug: "bus-9" }));
    expect(changedPayload(base, { ...base, slug: "BUS-9" })).toEqual({});
    expect(changedPayload(base, { ...base, slug: "Bus-10" })).toEqual({ slug: "bus-10" });
  });
});
