export function assertLocalFixtureTarget(env: Record<string, string | undefined>): string {
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("A local fixture database is required");
  }
  if (env.NODE_ENV === "production" || env.AUTERVA_FIXTURE !== "1"
    || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/auterva_fixture_9" || !url.port) {
    throw new Error("Refusing to write outside the local fixture database");
  }
  return url.toString();
}

export function warsawDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
