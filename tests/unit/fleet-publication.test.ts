import { expect, test } from "vitest";
import { validateVehiclePublication } from "../../src/modules/fleet/publication";

const valid = {
  name: "Bus 9", slug: "bus-9", category: { requiresSeats: true },
  shortDescription: "Bus na wyjazdy", description: "<p>Dziewięciomiejscowy bus.</p>", seats: 9,
  availableFrom: "2026-10-23", availableTo: "2026-10-23",
  images: [{ status: "READY", isCover: true }],
};

test("D-02 accepts one-day activity, a full description and one ready cover", () => {
  expect(validateVehiclePublication(valid)).toEqual({});
});

test("D-02 rejects blank markup, missing cover and category-required seats together", () => {
  expect(validateVehiclePublication({ ...valid, description: " <p><br>&nbsp;</p> ", seats: null,
    images: [{ status: "PENDING", isCover: true }] })).toMatchObject({
    description: expect.any(String), seats: expect.any(String), images: expect.any(String),
  });
});

test("a draft cannot publish without name, slug, category, summary and valid activity", () => {
  expect(validateVehiclePublication({ ...valid, name: "   ", slug: null, category: null,
    shortDescription: "", availableFrom: "2026-02-30", availableTo: "2026-02-28" }))
    .toMatchObject({ name: expect.any(String), slug: expect.any(String),
      category: expect.any(String), shortDescription: expect.any(String),
      availableFrom: expect.any(String) });
});

test("multiple ready covers are rejected without silently picking one", () => {
  expect(validateVehiclePublication({ ...valid, images: [
    { status: "READY", isCover: true }, { status: "READY", isCover: true },
  ] })).toMatchObject({ images: expect.any(String) });
});
