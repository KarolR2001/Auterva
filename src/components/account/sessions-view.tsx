"use client";

import { MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthArea } from "../auth/auth-destination";
import { postAuth } from "../auth/auth-flow";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import { sessionAlive } from "./account-view";
import {
  classifyEnd, deviceLabel, endBody, endConfirmedByList, formatWhen, orderSessions, otherSessions, reauthBody,
  targetDescription, type EndTarget, type ProofMethod, type SessionDto,
} from "./sessions-model";
import styles from "./account.module.css";

type Phase = "loading" | "error" | "ready";
type Notice = { tone: "success" | "error" | "warning" | "info"; title: string; text?: string } | null;

export function SessionsView({ area }: { area: AuthArea }) {
  const home = area === "company" ? "/admin" : "/";
  const account = area === "company" ? "/admin/konto/" : "/konto/";
  const login = area === "company" ? "/admin/login" : "/login";
  const [phase, setPhase] = useState<Phase>("loading");
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [target, setTarget] = useState<EndTarget | null>(null);
  const [method, setMethod] = useState<ProofMethod>("totp");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const proof = useRef<string | null>(null);
  const [hasProof, setHasProof] = useState(false);
  const confirmation = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const noticeRegion = useRef<HTMLDivElement>(null);

  const toLogin = useCallback(() => {
    window.location.replace(`${login}?returnTo=${encodeURIComponent(account)}&session=expired`);
  }, [account, login]);

  const load = useCallback(async (): Promise<SessionDto[] | null> => {
    try {
      const response = await fetch("/api/auth/sessions/", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        toLogin();
        return null;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as { sessions?: SessionDto[] };
      return Array.isArray(body.sessions) ? orderSessions(body.sessions) : null;
    } catch { return null; }
  }, [toLogin]);

  const refresh = useCallback(async () => {
    setPhase((current) => (current === "ready" ? current : "loading"));
    const next = await load();
    if (next) { setSessions(next); setPhase("ready"); } else setPhase((current) => (current === "ready" ? current : "error"));
    return next;
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void refresh();
  }, [refresh]);

  function open(next: EndTarget, trigger: HTMLElement) {
    opener.current = trigger;
    proof.current = null; setHasProof(false);
    setTarget(next);
    setCode("");
    setCodeError("");
    setNotice(null);
    requestAnimationFrame(() => confirmation.current?.querySelector<HTMLInputElement>("#end-code")?.focus());
  }
  function close() {
    setTarget(null);
    proof.current = null; setHasProof(false);
    setCode("");
    requestAnimationFrame(() => opener.current?.focus());
  }

  /** The opener and the confirmation vanish after a finished action: keep the keyboard user in the notice. */
  function focusNotice() {
    requestAnimationFrame(() => noticeRegion.current?.focus());
  }

  /** 401 also answers a revoked or archived session: ask the session before blaming the code. */
  async function sessionLost(): Promise<boolean> {
    if ((await sessionAlive()) !== false) return false;
    toLogin();
    return true;
  }

  async function confirmEnd() {
    if (!target || busy) return;
    setBusy(true);
    setNotice(null);
    setCodeError("");
    try {
      if (!proof.current) {
        const body = reauthBody(method, code);
        if (!body) { setCodeError(method === "totp" ? "Kod z aplikacji ma 6 cyfr." : "Wpisz kod odzyskania."); return; }
        let reauth: Awaited<ReturnType<typeof postAuth>> | null = null;
        try { reauth = await postAuth("mfa/reauth", body); } catch { reauth = null; }
        const issued = reauth?.data.proof;
        if (!reauth || !reauth.response.ok || typeof issued !== "string" || !/^[a-f0-9]{64}$/.test(issued)) {
          if (reauth?.response.status === 401 && (await sessionLost())) return;
          setCodeError(!reauth ? "Nie udało się połączyć. Nic nie zostało zakończone."
            : reauth.response.status === 429 ? "Za dużo prób. Poczekaj chwilę i spróbuj ponownie."
            : reauth.response.status >= 500 ? "Usługa chwilowo niedostępna. Nic nie zostało zakończone."
            : method === "totp" ? "Kod jest nieprawidłowy lub wygasł. Wpisz aktualny kod z aplikacji." : "Kod jest nieprawidłowy lub został użyty.");
          return;
        }
        proof.current = issued;
        setHasProof(true);
      }
      let status: number | null = null;
      let data: unknown = null;
      let retryAfter: string | null = null;
      try {
        const result = await postAuth("sessions/end", endBody(proof.current, target));
        status = result.response.status; data = result.data; retryAfter = result.response.headers.get("Retry-After");
      } catch { status = null; }
      const outcome = classifyEnd(status, data, retryAfter);
      if (outcome.kind === "proof-rejected" && (await sessionLost())) return;
      const before = sessions;
      if (outcome.kind === "ended" || outcome.kind === "already-gone") {
        const after = await refresh();
        proof.current = null; setHasProof(false);
        setTarget(null);
        setCode("");
        setNotice(outcome.kind === "ended"
          ? { tone: "success", title: outcome.ended === 1 ? "Zakończono 1 sesję." : `Zakończono sesje: ${outcome.ended}.`,
              text: after ? "Lista pokazuje stan potwierdzony przez serwer." : "Nie udało się odświeżyć listy — odśwież ją przyciskiem." }
          : { tone: "info", title: "Ta sesja była już zakończona.", text: "Lista została odświeżona." });
        focusNotice();
      } else if (outcome.kind === "uncertain") {
        const after = await load();
        if (after && endConfirmedByList(target, before, after)) {
          setSessions(after); proof.current = null; setHasProof(false); setTarget(null);
          setNotice({ tone: "success", title: "Sesja została zakończona.", text: "Potwierdzone odczytem listy z serwera." });
          focusNotice();
        } else {
          if (after) setSessions(after);
          setNotice({ tone: "error", title: "Nie wiemy, czy sesja została zakończona.",
            text: after ? "Lista nadal ją pokazuje. Ponów — potwierdzenie kodem jest nadal ważne przez kilka minut." : "Nie udało się odczytać listy. Odśwież ją i sprawdź." });
        }
      } else if (outcome.kind === "retry-same-proof") {
        setNotice({ tone: "warning", title: "Usługa chwilowo zajęta.", text: "Nic nie zostało zakończone. Ponów za chwilę — kod nie został zużyty." });
      } else if (outcome.kind === "rate-limited") {
        setNotice({ tone: "warning", title: "Za dużo żądań.", text: outcome.retryAfter ? `Spróbuj ponownie za ${outcome.retryAfter} s.` : "Spróbuj ponownie za chwilę." });
      } else if (outcome.kind === "proof-rejected") {
        proof.current = null; setHasProof(false);
        setCode("");
        setNotice({ tone: "error", title: "Potwierdzenie wygasło lub nie jest już ważne.", text: "Nic nie zostało zakończone. Wpisz nowy kod." });
      } else {
        setNotice({ tone: "error", title: "Nie wykonano operacji.", text: "Odśwież listę i spróbuj ponownie." });
      }
    } finally { setBusy(false); }
  }

  const others = otherSessions(sessions);
  const description = target ? targetDescription(target) : null;

  return (
    <main className={styles.page} data-area={area}>
      <header className={styles.header}>
        <p className={styles.brand}>{area === "platform" ? "A AUTERVA" : "AUTERVA"}</p>
        <nav aria-label="Konto" className={styles.nav}>
          <Link href={account} prefetch={false}>Konto</Link>
          <Link href={home} prefetch={false}>{area === "platform" ? "Platforma" : "Panel"}</Link>
        </nav>
      </header>
      <h1 className={styles.title}>Aktywne sesje</h1>
      <p>Widzisz wyłącznie sesje własnego konta. Adres IP i dane przeglądarki poza nazwą urządzenia nie są pokazywane.</p>

      <div ref={noticeRegion} tabIndex={-1} role="status" aria-live="polite">
        {notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
      </div>

      {phase === "loading" && <p role="status">Wczytywanie sesji…</p>}
      {phase === "error" && (
        <Alert tone="error" title="Nie udało się wczytać sesji." action={{ label: "Spróbuj ponownie", onClick: () => void refresh() }}>
          Nic nie zostało zakończone.
        </Alert>
      )}

      {phase === "ready" && (
        <section className={styles.card} aria-labelledby="sessions-list">
          <h2 id="sessions-list">Sesje konta ({sessions.length})</h2>
          <ul className={styles.sessionList}>
            {sessions.map((session) => (
              <li key={session.id} className={styles.sessionItem} data-current={session.current || undefined}>
                <p className={styles.sessionTitle}>
                  <MonitorSmartphone aria-hidden="true" size={20} />
                  <span>{deviceLabel(session)}</span>
                  {session.current && <span className={styles.pill}>Ta sesja</span>}
                </p>
                <p className={styles.sessionMeta}>Rozpoczęta: {formatWhen(session.createdAt)} • Ostatnia aktywność: {formatWhen(session.lastActiveAt)}</p>
                {session.current ? (
                  <p className={styles.sessionMeta}>Bieżącą sesję kończy „Wyloguj”, nie ta lista.</p>
                ) : (
                  <Button variant="secondary" size="sm" onClick={(event) => open({ kind: "one", session }, event.currentTarget)}
                    aria-label={`Zakończ sesję: ${deviceLabel(session)}, ostatnia aktywność ${formatWhen(session.lastActiveAt)}`}>
                    Zakończ sesję
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {others.length === 0 ? (
            <p>Brak innych aktywnych sesji.</p>
          ) : (
            <Button variant="destructive" onClick={(event) => open({ kind: "others", count: others.length }, event.currentTarget)}>
              Zakończ pozostałe sesje ({others.length})
            </Button>
          )}
          <Button variant="tertiary" onClick={() => void refresh()}>Odśwież listę</Button>
        </section>
      )}

      {target && description && (
        <section ref={confirmation} className={styles.card} aria-labelledby="end-title" role="group"
          onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); close(); } }}>
          <h2 id="end-title">{description.title}</h2>
          <p>{description.effect}</p>
          <p>Potwierdź to świeżym kodem MFA. Dowód jest jednorazowy, ważny 5 minut i dotyczy tylko kończenia sesji.</p>
          <fieldset className={styles.methods}>
            <legend>Rodzaj kodu</legend>
            <label><input type="radio" name="method" checked={method === "totp"} onChange={() => setMethod("totp")} /> Aplikacja uwierzytelniająca</label>
            <label><input type="radio" name="method" checked={method === "recovery"} onChange={() => setMethod("recovery")} /> Kod zapasowy z listy odzyskiwania</label>
          </fieldset>
          <FormField id="end-code" label={method === "totp" ? "Kod z aplikacji" : "Kod odzyskania"} required error={codeError}
            hint={method === "totp" ? "6 cyfr" : "Jednorazowy kod z listy"}>
            <TextInput autoComplete="one-time-code" inputMode={method === "totp" ? "numeric" : "text"} value={code}
              disabled={busy || hasProof} onChange={(event) => setCode(event.target.value)} />
          </FormField>
          <div className={styles.actions}>
            <Button variant="destructive" loading={busy} loadingLabel="Kończenie sesji…" onClick={() => void confirmEnd()}>
              {target.kind === "one" ? "Zakończ tę sesję" : "Zakończ pozostałe sesje"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={close}>Anuluj</Button>
          </div>
        </section>
      )}
    </main>
  );
}
