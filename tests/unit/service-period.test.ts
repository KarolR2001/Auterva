import { expect, test } from "vitest";
import { paidEndExclusive, resolveServicePeriod } from "../../src/modules/service-period/state";

const registered = new Date("2026-10-23T10:00:00.000Z");
const trialEnd = new Date(registered.getTime() + 336 * 60 * 60_000);
const baseline = {
  registeredAt: registered, archivedAt: null, publicUnlockRequired: false, publicRequiresPaid: false,
  domainReady: true, paidThrough: null, trialGranted: true, trialStartedAt: registered, trialEndsAt: trialEnd,
};

test.each([
  ["2026-03-28", "2026-03-28T23:00:00.000Z"],
  ["2026-03-29", "2026-03-29T22:00:00.000Z"],
  ["2026-10-24", "2026-10-24T22:00:00.000Z"],
  ["2026-10-25", "2026-10-25T23:00:00.000Z"],
  ["2026-12-31", "2026-12-31T23:00:00.000Z"],
  ["9999-12-31", "9999-12-31T23:00:00.000Z"],
])("paid-through %s ends at the next Warsaw midnight %s", (date, expected) => {
  expect(paidEndExclusive(date).toISOString()).toBe(expected);
});

test.each(["0000-01-01", "2026-02-30", "2026-13-01", "2026-01-00", "26-01-01", "2026-01-01T00:00Z"])(
  "invalid paid-through LocalDate %s is rejected", (date) => {
    expect(() => paidEndExclusive(date)).toThrow();
  },
);

test("paid period survives trial expiry and paid label wins even when trial ends later", () => {
  const at = new Date("2026-11-06T11:00:00.000Z");
  const paid = resolveServicePeriod({ ...baseline, paidThrough: "2026-11-20" }, at);
  expect(paid).toMatchObject({ paidValid: true, trialValid: false, headline: "PAID",
    kpi: "PAID", publicVisible: true, panelEnabled: true });
  expect(paid.effectiveEndsAt?.toISOString()).toBe("2026-11-20T23:00:00.000Z");
  const overlap = resolveServicePeriod({ ...baseline, paidThrough: "2026-10-25" }, new Date("2026-10-24T10:00:00.000Z"));
  expect(overlap).toMatchObject({ paidValid: true, trialValid: true, headline: "PAID", kpi: "PAID" });
  expect(overlap.effectiveEndsAt).toEqual(trialEnd);
});

test("exclusive instant, registration, archive, domain and restore gates are distinct", () => {
  const before = new Date(trialEnd.getTime() - 1);
  expect(resolveServicePeriod(baseline, before)).toMatchObject({ trialValid: true, publicVisible: true,
    headline: "TRIAL", panelEnabled: true });
  expect(resolveServicePeriod(baseline, trialEnd)).toMatchObject({ trialValid: false,
    publicVisible: false, headline: "EXPIRED", panelEnabled: true });
  expect(resolveServicePeriod({ ...baseline, registeredAt: null }, before)).toMatchObject({
    publicVisible: false, kpi: "NONE",
  });
  expect(resolveServicePeriod({ ...baseline, archivedAt: before }, before)).toMatchObject({
    publicVisible: false, panelEnabled: false, kpi: "NONE",
  });
  expect(resolveServicePeriod({ ...baseline, domainReady: false }, before).publicVisible).toBe(false);
  expect(resolveServicePeriod({ ...baseline, publicUnlockRequired: true }, before).publicVisible).toBe(false);
});

test("restore remains paid-only after explicit unlock even if trial is still valid", () => {
  const at = new Date("2026-10-24T10:00:00.000Z");
  expect(resolveServicePeriod({ ...baseline, publicRequiresPaid: true, publicUnlockRequired: false }, at))
    .toMatchObject({ trialValid: true, paidValid: false, publicVisible: false, panelEnabled: true });
  expect(resolveServicePeriod({ ...baseline, publicRequiresPaid: true, paidThrough: "2026-10-24" }, at))
    .toMatchObject({ publicVisible: true, headline: "PAID" });
});
