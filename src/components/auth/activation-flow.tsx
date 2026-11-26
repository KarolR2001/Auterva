"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { PasswordInput } from "../ui/password-input";
import { SecretForm } from "../ui/secret-form";
import { AuthBrand } from "./auth-brand";
import { evaluatePassword } from "./password-policy";
import { PasswordStrength } from "./password-strength";
import styles from "./auth.module.css";

const schema = z
  .object({
    password: z.string().min(12, "Hasło musi mieć co najmniej 12 znaków").max(256, "Hasło może mieć najwyżej 256 znaków"),
    confirm: z.string().min(1, "Powtórz hasło"),
  })
  .refine((values) => values.password === values.confirm, { path: ["confirm"], message: "Hasła muszą być identyczne" });
type Values = z.infer<typeof schema>;

type Invitation = { name: string; recipientEmail: string; expiresAt: string | null };
type SiteState = "READY" | "DOMAIN_PENDING" | "PERIOD_EXPIRED" | "RESTORE_LOCKED";
type Phase =
  | { kind: "loading" }
  | { kind: "ready"; invitation: Invitation }
  | { kind: "invalid" }
  | { kind: "limited"; seconds: number }
  | { kind: "unavailable" }
  | { kind: "done"; name: string; siteState: string | null };

/** Public-site outcome copy comes from the server `siteState`; nothing here promises a page the server did not report. */
export function siteMessage(state: string | null): { title: string; text: string } {
  switch (state as SiteState | null) {
    case "READY":
      return { title: "Strona firmy jest uruchomiona", text: "Publiczny adres firmy jest aktywny. Jeśli nie ma jeszcze pojazdów, odwiedzający zobaczą zapowiedź oferty." };
    case "DOMAIN_PENDING":
      return { title: "Strona firmy jeszcze nie działa", text: "Konto jest aktywne, ale adres publiczny czeka na konfigurację. Panel działa już teraz." };
    case "PERIOD_EXPIRED":
      return { title: "Strona firmy nie jest publiczna", text: "Okres usługi nie obejmuje publikacji strony. Panel działa, a termin ustala Auterva." };
    case "RESTORE_LOCKED":
      return { title: "Publikacja strony czeka na odblokowanie", text: "Strona wymaga odblokowania przez Auterva. Panel działa już teraz." };
    default:
      return { title: "Stan strony sprawdzisz w panelu", text: "Nie otrzymaliśmy potwierdzenia stanu publicznej strony." };
  }
}

/** "23.10.2026, 16:30" in Polish time; the server keeps the instant in UTC. */
export function expiryText(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
}

const LOADING_TITLE = "Sprawdzamy zaproszenie";
const UNCERTAIN_TEXT = "Aktywacja mogła się zakończyć. Ponów ją tym samym hasłem: serwer zwróci zapisany wynik i nie utworzy drugiego konta. Hasła są zablokowane do czasu potwierdzenia.";

function Frame({ title, context = "Zaproszenie do firmy", children }: { title: string; context?: string | null; children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(title);
  useEffect(() => {
    if (previous.current !== title) {
      // Loading -> first real screen is not a step change: keep focus where it is.
      if (previous.current !== LOADING_TITLE) heading.current?.focus();
      previous.current = title;
    }
  }, [title]);
  return (
    <main className={styles.page} data-area="company" data-view="activation">
      <AuthBrand />
      <section className={styles.card} aria-labelledby="auth-title">
        {context && <p className={styles.context}>{context}</p>}
        <h1 id="auth-title" tabIndex={-1} ref={heading}>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function LoginLink({ label = "Wróć do logowania" }: { label?: string }) {
  return <p className={styles.footer}><Link href="/admin/login" className={styles.loginLink}>{label}</Link></p>;
}

async function loadInvitation(path: string): Promise<Phase> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok && typeof data.name === "string" && typeof data.recipientEmail === "string")
      return { kind: "ready", invitation: { name: data.name, recipientEmail: data.recipientEmail,
        expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null } };
    if (response.status === 404) return { kind: "invalid" };
    if (response.status === 429) return { kind: "limited", seconds: Math.max(1, Number(response.headers.get("Retry-After")) || 60) };
    return { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
  finally { clearTimeout(timer); }
}

export function ActivationFlow({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const [error, setError] = useState<{ title: string; text?: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  // After an unconfirmed POST the password is frozen: a retry must carry the same one the server may already have stored.
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" }, mode: "onSubmit" });
  const password = useWatch({ control: form.control, name: "password" });
  const path = `/api/auth/invitation/${encodeURIComponent(token)}/`;

  useEffect(() => {
    let cancelled = false;
    void loadInvitation(path).then((next) => { if (!cancelled) setPhase(next); });
    return () => { cancelled = true; };
  }, [path]);
  const retryInspect = () => { setPhase({ kind: "loading" }); void loadInvitation(path).then(setPhase); };

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function activate(values: Values) {
    if (pending.current || cooldown > 0 || phase.kind !== "ready") return;
    pending.current = true;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: values.password }) });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) {
        setUncertain(false);
        // Drop the one-time token from the address bar and history; a reload lands on the login page, not a bare 404.
        try { window.history.replaceState(null, "", "/admin/login/"); } catch { /* ignore */ }
        form.reset({ password: "", confirm: "" });
        setPhase({ kind: "done", name: phase.invitation.name, siteState: typeof data.siteState === "string" ? data.siteState : null });
      } else if (response.status === 404) setPhase({ kind: "invalid" });
      else if (response.status === 429) {
        const seconds = Math.max(1, Math.ceil(Number(response.headers.get("Retry-After")) || 60));
        setCooldown(seconds);
        setError({ title: "Zbyt wiele prób.", text: "Odczekaj i spróbuj ponownie." });
      } else if (response.status === 403) setError({ title: "Otwórz link z zaproszenia bezpośrednio z wiadomości e-mail.", text: "Aktywacja działa tylko na adresie panelu firmy." });
      else if (response.status === 400) setError({ title: "Hasło nie spełnia wymagań.", text: "Użyj od 12 do 256 znaków." });
      else if (response.status === 503 && data.code === "INGRESS_NOT_CONFIGURED")
        setError({ title: "Usługa chwilowo niedostępna.", text: "Konto nie zostało zmienione. Ponów aktywację za chwilę; to samo zaproszenie nie utworzy drugiego konta." });
      else {
        // Any other 5xx (gateway 502/504, 500) may arrive after the commit: treat it like a lost response.
        setUncertain(true);
        setError({ title: "Nie udało się potwierdzić aktywacji.", text: UNCERTAIN_TEXT });
      }
    } catch {
      setUncertain(true);
      setError({ title: "Nie udało się połączyć.", text: UNCERTAIN_TEXT });
    } finally {
      clearTimeout(timer);
      pending.current = false;
      setLoading(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) { void form.handleSubmit(activate)(event); }

  if (phase.kind === "loading")
    return <Frame title={LOADING_TITLE}><p className={styles.intro} role="status">Chwila, weryfikujemy link.</p></Frame>;
  if (phase.kind === "invalid")
    return (
      <Frame title="Link jest nieaktualny">
        <Alert tone="warning" title="Ten link nie może aktywować konta.">
          Jest błędny, wygasł, został użyty albo anulowany. Jeśli konto jest już aktywne, zaloguj się. W pozostałych przypadkach poproś Auterva o nowe zaproszenie.
        </Alert>
        <LoginLink />
      </Frame>
    );
  if (phase.kind === "limited")
    return (
      <Frame title="Zbyt wiele prób">
        <Alert tone="warning" title="Odczekaj chwilę i otwórz link ponownie.">{`Możesz spróbować za około ${phase.seconds} s.`}</Alert>
        <div className={styles.form}><Button width="fill" variant="secondary" onClick={retryInspect}>Spróbuj ponownie</Button></div>
      </Frame>
    );
  if (phase.kind === "unavailable")
    return (
      <Frame title="Nie możemy sprawdzić zaproszenia">
        <Alert tone="error" title="Usługa chwilowo niedostępna.">Sprawdź połączenie i spróbuj ponownie. Link nie został zużyty.</Alert>
        <div className={styles.form}><Button width="fill" onClick={retryInspect}>Spróbuj ponownie</Button></div>
      </Frame>
    );
  if (phase.kind === "done") {
    const site = siteMessage(phase.siteState);
    return (
      <Frame title="Konto jest aktywne" context="Aktywacja zakończona">
        <p className={styles.intro}>{phase.name}. Zaloguj się hasłem ustawionym przy aktywacji. Po haśle skonfigurujesz MFA.</p>
        <div className={styles.notices}><Alert tone={phase.siteState === "READY" ? "success" : "info"} title={site.title}>{site.text}</Alert></div>
        <div className={styles.form}>
          <Link href="/admin/login" className={styles.loginLink}>Przejdź do logowania</Link>
        </div>
      </Frame>
    );
  }
  const strength = evaluatePassword(password ?? "");
  const expiry = phase.invitation.expiresAt ? expiryText(phase.invitation.expiresAt) : null;
  return (
    // F02-04: no eyebrow; company and recipient on their own lines, then what the button does.
    <Frame title="Aktywuj konto" context={null}>
      <p className={styles.invitee}><span>{phase.invitation.name}</span><span>{phase.invitation.recipientEmail}</span></p>
      <p className={styles.intro}>Ustaw hasło do panelu swojej firmy. Otwarcie linku nie aktywuje konta; zrobi to dopiero przycisk poniżej.</p>
      <SecretForm className={styles.form} onSubmit={onSubmit}>
        <PasswordInput id="activation-password" label="Nowe hasło" autoComplete="new-password" placeholder="Wpisz nowe hasło"
          hint="12–256 znaków" aria-describedby="activation-strength" visibility={visibility} onVisibilityChange={setVisibility}
          error={form.formState.errors.password?.message} readOnly={uncertain} {...form.register("password")} />
        <PasswordStrength id="activation-strength" level={strength.level} tooShort={strength.tooShort} criteria={strength.criteria} />
        <PasswordInput id="activation-confirm" label="Powtórz hasło" autoComplete="new-password" placeholder="Wpisz hasło ponownie"
          hint="Oba hasła muszą być identyczne." visibility={visibility} onVisibilityChange={setVisibility}
          error={form.formState.errors.confirm?.message} readOnly={uncertain} {...form.register("confirm")} />
        {expiry && <p className={styles.validity}>Link ważny do {expiry}. Użyjesz go tylko raz.</p>}
        {error && <Alert tone="error" title={error.title}>{[error.text, cooldown > 0 ? `Ponów za ${cooldown} s.` : null].filter(Boolean).join(" ")}</Alert>}
        <Button type="submit" width="fill" loading={loading} loadingLabel="Aktywowanie…" disabled={cooldown > 0}>
          {cooldown > 0 ? "Ponów po limicie" : uncertain ? "Ponów aktywację" : "Aktywuj konto"}
        </Button>
      </SecretForm>
      <LoginLink />
    </Frame>
  );
}
