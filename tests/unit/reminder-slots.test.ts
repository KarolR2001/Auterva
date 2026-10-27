import { expect, test } from "vitest";
import { reminderBoundary, reminderMessage, reminderSlots, shiftLocalDate, warsawLocalDate, warsawNineAm,
  type ReminderPeriodInput } from "../../src/modules/reminders/slots";

const TRIAL_MS = 336 * 60 * 60_000;
const none: ReminderPeriodInput = { paidThrough: null, trialGranted: false, trialStartedAt: null,
  trialEndsAt: null, registeredAt: null, archivedAt: null };
const iso = (list: ReturnType<typeof reminderSlots>) => list.map((slot) => slot.slotAt.toISOString());
function trial(startIso: string, extra: Partial<ReminderPeriodInput> = {}): ReminderPeriodInput {
  const start = new Date(startIso);
  return { ...none, trialGranted: true, trialStartedAt: start, trialEndsAt: new Date(start.getTime() + TRIAL_MS),
    registeredAt: start, ...extra };
}
const at = (value: string) => new Date(value);
const registered = at("2026-01-01T00:00:00.000Z");

test("paid slots use calendar dates around both DST changes (contract table)", () => {
  const spring = reminderBoundary({ ...none, paidThrough: "2026-03-29", registeredAt: registered }, registered)!;
  expect(spring.endsAt.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  expect(iso(reminderSlots(spring))).toEqual(["2026-03-22T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z"]);
  const autumn = reminderBoundary({ ...none, paidThrough: "2026-10-25", registeredAt: registered }, registered)!;
  expect(autumn.endsAt.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  expect(iso(reminderSlots(autumn))).toEqual(["2026-10-18T07:00:00.000Z", "2026-10-24T07:00:00.000Z", "2026-10-25T08:00:00.000Z"]);
  expect(spring.source).toBe("PAID");
});

test("trial slots: DST starts, midnight end and end before 09:00", () => {
  const march = reminderBoundary(trial("2026-03-22T11:00:00.000Z"), registered)!;
  expect(march.endsAt.toISOString()).toBe("2026-04-05T11:00:00.000Z");
  expect(iso(reminderSlots(march))).toEqual(["2026-03-29T07:00:00.000Z", "2026-04-04T07:00:00.000Z", "2026-04-05T07:00:00.000Z"]);
  const october = reminderBoundary(trial("2026-10-18T10:00:00.000Z"), registered)!;
  expect(iso(reminderSlots(october))).toEqual(["2026-10-25T08:00:00.000Z", "2026-10-31T08:00:00.000Z", "2026-11-01T08:00:00.000Z"]);
  // Exactly 00:00 on 29.03 Warsaw: the expiry day is the local date of that instant.
  const midnight = reminderBoundary(trial("2026-03-14T23:00:00.000Z"), registered)!;
  expect(midnight.endsAt.toISOString()).toBe("2026-03-28T23:00:00.000Z");
  expect(midnight.endDate).toBe("2026-03-29");
  expect(iso(reminderSlots(midnight))).toEqual(["2026-03-22T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z"]);
  // Ends 08:00 CEST, an hour before the 09:00 slot 0.
  const early = reminderBoundary(trial("2026-03-22T06:00:00.000Z"), registered)!;
  expect(early.endsAt.toISOString()).toBe("2026-04-05T06:00:00.000Z");
  expect(iso(reminderSlots(early))[2]).toBe("2026-04-05T07:00:00.000Z");
});

test("paid and trial at once: one series for the later boundary, tie goes to payment", () => {
  const march = trial("2026-03-22T11:00:00.000Z", { paidThrough: "2026-03-29" });
  const effective = reminderBoundary(march, at("2026-03-23T00:00:00.000Z"))!;
  expect(effective).toMatchObject({ source: "TRIAL", endDate: "2026-04-05" });
  expect(iso(reminderSlots(effective))[0]).toBe("2026-03-29T07:00:00.000Z");
  // Trial 24.10 -> ends 25.10 08:00Z, paid to 25.10 -> ends 25.10 23:00Z: payment is later.
  const overlap = trial("2026-10-11T08:00:00.000Z", { paidThrough: "2026-10-25" });
  expect(overlap.trialEndsAt!.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  expect(reminderBoundary(overlap, at("2026-10-24T00:00:00.000Z"))).toMatchObject({ source: "PAID", endDate: "2026-10-25" });
  // Equal instant (paid to 29.03 ends 29.03 22:00Z; trial constructed to end then): payment owns the series.
  const tie = trial("2026-03-15T22:00:00.000Z", { paidThrough: "2026-03-29" });
  expect(tie.trialEndsAt!.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  expect(reminderBoundary(tie, registered)).toMatchObject({ source: "PAID", endDate: "2026-03-29" });
});

test("no schedule before registration, for archived companies or without a boundary", () => {
  expect(reminderBoundary({ ...none, paidThrough: "2026-12-31" }, registered)).toBeNull();
  expect(reminderBoundary({ ...none, paidThrough: "2026-12-31", registeredAt: registered, archivedAt: registered }, registered)).toBeNull();
  expect(reminderBoundary({ ...none, registeredAt: registered }, registered)).toBeNull();
  expect(reminderBoundary({ ...trial("2026-03-22T11:00:00.000Z"), trialGranted: false }, registered)).toBeNull();
});

test("local date helpers subtract calendar days and read Warsaw time", () => {
  expect(shiftLocalDate("2026-03-29", -7)).toBe("2026-03-22");
  expect(shiftLocalDate("2026-03-01", -1)).toBe("2026-02-28");
  expect(() => shiftLocalDate("2026-02-30", 0)).toThrow();
  expect(warsawNineAm("2026-07-01").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  expect(warsawNineAm("2026-12-01").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  expect(warsawLocalDate(at("2026-03-28T23:00:00.000Z"))).toBe("2026-03-29");
  expect(warsawLocalDate(at("2026-03-28T22:59:59.999Z"))).toBe("2026-03-28");
});

test("message describes the state now, not the state at scheduling", () => {
  const base = { source: "TRIAL" as const, endsAt: at("2026-04-05T06:00:00.000Z"), endDate: "2026-04-05",
    publicUnlockRequired: false, domainReady: true };
  const early = reminderMessage({ ...base, offset: 0, now: at("2026-04-05T07:00:00.000Z") });
  expect(early.subject).toContain("już wygasł");
  expect(early.body).toContain("Trial już wygasł");
  expect(early.body).toContain("Konto aktywne. Publiczna oferta jest obecnie wyłączona.");
  const active = reminderMessage({ ...base, endsAt: at("2026-04-05T11:00:00.000Z"), offset: 7, now: at("2026-03-29T07:00:00.000Z") });
  expect(active.body).toContain("05.04.2026 o 13:00");
  expect(active.body).not.toContain("Opłac");
  const paid = reminderMessage({ source: "PAID", endsAt: at("2026-03-29T22:00:00.000Z"), endDate: "2026-03-29",
    offset: 1, now: at("2026-03-28T08:00:00.000Z"), publicUnlockRequired: true, domainReady: false });
  expect(paid.body).toContain("Ostatni opłacony dzień: 29.03.2026");
  expect(paid.body).toContain("do odblokowania");
  expect(paid.body).toContain("Konfiguracja strony w toku");
});
