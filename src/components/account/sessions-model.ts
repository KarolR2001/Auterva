// Pure rules of the account sessions screen (ADM-16, #73). The server (#72) is authoritative: the list is
// whatever it returns, and a session is "ended" only when a later read from the server no longer shows it.

export type SessionDto = { id: string; createdAt: string; lastActiveAt: string; device: string | null; current: boolean };
export type EndTarget = { kind: "one"; session: SessionDto } | { kind: "others"; count: number };
export type ProofMethod = "totp" | "recovery";

const when = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });

export const formatWhen = (iso: string) => when.format(new Date(iso));
export const deviceLabel = (session: SessionDto) => session.device ?? "Nieznane urządzenie";

/** Current session first (the server sends it so), then newest activity. Never reorders away the current one. */
export function orderSessions(sessions: SessionDto[]): SessionDto[] {
  return [...sessions].sort((a, b) => Number(b.current) - Number(a.current)
    || Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt));
}

export const otherSessions = (sessions: SessionDto[]) => sessions.filter((session) => !session.current);

/** What the confirmation says, so the action names the session and its effect (no vague "end sessions"). */
export function targetDescription(target: EndTarget): { title: string; effect: string } {
  if (target.kind === "one") return {
    title: `Zakończyć sesję: ${deviceLabel(target.session)}`,
    effect: `Ta sesja (ostatnia aktywność: ${formatWhen(target.session.lastActiveAt)}) straci dostęp od następnego żądania. Pozostałe sesje, w tym bieżąca, zostaną.`,
  };
  return {
    title: `Zakończyć pozostałe sesje (${target.count})`,
    effect: "Wszystkie inne sesje tego konta stracą dostęp, także te niewidoczne na liście (wygasłe lub niedokończone). Bieżąca sesja zostanie.",
  };
}

export function reauthBody(method: ProofMethod, code: string): { method: ProofMethod; code: string; purpose: "end-sessions" } | null {
  const clean = code.replace(/\s+/g, "");
  if (method === "totp" ? !/^\d{6}$/.test(clean) : clean.length < 4 || clean.length > 32) return null;
  return { method, code: clean, purpose: "end-sessions" };
}

export function endBody(proof: string, target: EndTarget): Record<string, string> {
  return target.kind === "one" ? { proof, sessionId: target.session.id } : { proof };
}

export type EndOutcome =
  | { kind: "ended"; ended: number }
  | { kind: "already-gone" }
  | { kind: "proof-rejected" }
  | { kind: "retry-same-proof"; retryAfter: number | null }
  | { kind: "rate-limited"; retryAfter: number | null }
  | { kind: "uncertain" }
  | { kind: "invalid" };

/** Maps `POST /api/auth/sessions/end`. Only 5xx without MFA_RETRY (or no answer) leaves the outcome unknown. */
export function classifyEnd(status: number | null, body: unknown, retryAfter: string | null): EndOutcome {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const seconds = Number(retryAfter);
  const delay = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
  if (status === 200 && record.status === true) return { kind: "ended", ended: typeof record.ended === "number" ? record.ended : 0 };
  if (status === 404) return { kind: "already-gone" };
  if (status === 401) return { kind: "proof-rejected" };
  if (status === 429) return { kind: "rate-limited", retryAfter: delay };
  if (status === 503 && record.code === "MFA_RETRY") return { kind: "retry-same-proof", retryAfter: delay ?? 1 };
  if (status === 400) return { kind: "invalid" };
  return { kind: "uncertain" };
}

/** After an uncertain answer only the server's list decides: a gone target means the end was committed. */
export function endConfirmedByList(target: EndTarget, before: SessionDto[], after: SessionDto[]): boolean {
  if (target.kind === "one") return !after.some((session) => session.id === target.session.id);
  const beforeOthers = otherSessions(before).length;
  return beforeOthers > 0 && otherSessions(after).length === 0;
}
