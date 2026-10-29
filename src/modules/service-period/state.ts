const WARSAW = "Europe/Warsaw";
const TRIAL_MS = 336 * 60 * 60_000;
const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: WARSAW, timeZoneName: "shortOffset" });

function validInstant(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** paidThrough is a SQL DATE / LocalDate, inclusive in Europe/Warsaw. */
export function paidEndExclusive(paidThrough: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidThrough)) throw new Error("Invalid paidThrough LocalDate");
  const day = new Date(`${paidThrough}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.getUTCFullYear() < 1
    || day.toISOString().slice(0, 10) !== paidThrough) {
    throw new Error("Invalid paidThrough LocalDate");
  }
  day.setUTCDate(day.getUTCDate() + 1);
  // Warsaw changes offset at 02:00/03:00 local time, never at midnight.
  // UTC midnight of the target date is still before that day's offset change.
  const zone = offsetFormat.formatToParts(day).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone ?? "");
  if (!match) throw new Error("Cannot resolve Warsaw offset");
  const minutes = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1);
  return new Date(day.getTime() - minutes * 60_000);
}

export type ServicePeriodInput = {
  paidThrough: string | null;
  trialGranted: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  registeredAt: Date | null;
  archivedAt: Date | null;
  publicUnlockRequired: boolean;
  publicRequiresPaid: boolean;
  domainReady: boolean;
};

export function resolveServicePeriod(input: ServicePeriodInput, now: Date) {
  if (!validInstant(now)) throw new Error("Invalid current instant");
  const paidEndsAt = input.paidThrough === null ? null : paidEndExclusive(input.paidThrough);
  const validTrial = input.trialGranted && validInstant(input.registeredAt)
    && validInstant(input.trialStartedAt) && validInstant(input.trialEndsAt)
    && input.trialStartedAt.getTime() === input.registeredAt.getTime()
    && input.trialEndsAt.getTime() - input.trialStartedAt.getTime() === TRIAL_MS;
  const trialEndsAt = validTrial ? input.trialEndsAt : null;
  const paidValid = !!paidEndsAt && now < paidEndsAt;
  const trialValid = !!trialEndsAt && now < trialEndsAt;
  const effectiveEndsAt = !paidEndsAt ? trialEndsAt : !trialEndsAt ? paidEndsAt
    : paidEndsAt >= trialEndsAt ? paidEndsAt : trialEndsAt;
  const effectiveSource = !effectiveEndsAt ? "NONE" : paidEndsAt && effectiveEndsAt === paidEndsAt
    ? "PAID" : "TRIAL";
  const headline = paidValid ? "PAID" : trialValid ? "TRIAL" : "EXPIRED";
  const kpi = input.archivedAt ? "NONE" : paidValid ? "PAID" : trialValid ? "TRIAL" : "NONE";
  const panelEnabled = !input.archivedAt;
  const publicVisible = panelEnabled && !!input.registeredAt && input.domainReady
    && !input.publicUnlockRequired && (paidValid || trialValid)
    && (!input.publicRequiresPaid || paidValid);
  return { paidEndsAt, trialEndsAt, effectiveEndsAt, effectiveSource, paidValid, trialValid,
    headline, kpi, panelEnabled, publicVisible };
}
