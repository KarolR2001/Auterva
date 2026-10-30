"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, Circle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { PasswordInput } from "../ui/password-input";
import styles from "./auth.module.css";

const schema = z
  .object({
    password: z.string().min(12, "Hasło musi mieć co najmniej 12 znaków").max(256, "Hasło może mieć najwyżej 256 znaków"),
    confirm: z.string().min(1, "Powtórz hasło"),
  })
  .refine((values) => values.password === values.confirm, { path: ["confirm"], message: "Hasła muszą być identyczne" });
type Values = z.infer<typeof schema>;

type Invitation = { name: string; recipientEmail: string };
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

function Frame({ title, context = "Zaproszenie do firmy", children }: { title: string; context?: string; children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [title]);
  return (
    <main className={styles.page} data-area="company" data-view="activation">
      <p className={styles.brand}>AUTERVA</p>
      <section className={styles.card} aria-labelledby="auth-title">
        <p className={styles.context}>{context}</p>
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
      return { kind: "ready", invitation: { name: data.name, recipientEmail: data.recipientEmail } };
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
        form.reset({ password: "", confirm: "" });
        setPhase({ kind: "done", name: phase.invitation.name, siteState: typeof data.siteState === "string" ? data.siteState : null });
      } else if (response.status === 404) setPhase({ kind: "invalid" });
      else if (response.status === 429) {
        const seconds = Math.max(1, Math.ceil(Number(response.headers.get("Retry-After")) || 60));
        setCooldown(seconds);
        setError({ title: "Zbyt wiele prób.", text: "Odczekaj i spróbuj ponownie." });
      } else if (response.status === 403) setError({ title: "Otwórz link z zaproszenia bezpośrednio z wiadomości e-mail.", text: "Aktywacja działa tylko na adresie panelu firmy." });
      else if (response.status === 400) setError({ title: "Hasło nie spełnia wymagań.", text: "Użyj od 12 do 256 znaków." });
      else setError({ title: "Usługa chwilowo niedostępna.", text: "Konto nie zostało zmienione. Ponów aktywację za chwilę; to samo zaproszenie nie utworzy drugiego konta." });
    } catch {
      setError({ title: "Nie udało się połączyć.", text: "Aktywacja mogła się zakończyć. Ponów ją tym samym hasłem: serwer zwróci zapisany wynik i nie utworzy drugiego konta." });
    } finally {
      clearTimeout(timer);
      pending.current = false;
      setLoading(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) { void form.handleSubmit(activate)(event); }

  if (phase.kind === "loading")
    return <Frame title="Sprawdzamy zaproszenie"><p className={styles.intro} role="status">Chwila, weryfikujemy link.</p></Frame>;
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
        <p className={styles.intro}>{phase.name}. Zaloguj się hasłem, które właśnie ustawiono. Po haśle skonfigurujesz MFA.</p>
        <div className={styles.notices}><Alert tone={phase.siteState === "READY" ? "success" : "info"} title={site.title}>{site.text}</Alert></div>
        <div className={styles.form}>
          <Link href="/admin/login" className={styles.loginLink}>Przejdź do logowania</Link>
        </div>
      </Frame>
    );
  }
  const long = password.length >= 12;
  return (
    <Frame title="Aktywuj konto">
      <p className={styles.intro}>{phase.invitation.name} • {phase.invitation.recipientEmail}. Ustaw hasło do panelu. Otwarcie linku nie aktywuje konta; zrobi to dopiero przycisk poniżej.</p>
      <form className={styles.form} noValidate onSubmit={onSubmit}>
        <PasswordInput id="activation-password" label="Nowe hasło" autoComplete="new-password" placeholder="Wpisz nowe hasło"
          hint="Użyj co najmniej 12 znaków." visibility={visibility} onVisibilityChange={setVisibility}
          error={form.formState.errors.password?.message} {...form.register("password")} />
        <p className={styles.pending} data-met={long}>
          {long ? <CircleCheck aria-hidden="true" size={16} /> : <Circle aria-hidden="true" size={16} />}{" "}
          {long ? "Spełnione: co najmniej 12 znaków" : "Wymagane: co najmniej 12 znaków"}
        </p>
        <PasswordInput id="activation-confirm" label="Powtórz hasło" autoComplete="new-password" placeholder="Wpisz hasło ponownie"
          hint="Oba hasła muszą być identyczne." visibility={visibility} onVisibilityChange={setVisibility}
          error={form.formState.errors.confirm?.message} {...form.register("confirm")} />
        {error && <Alert tone="error" title={error.title}>{[error.text, cooldown > 0 ? `Ponów za ${cooldown} s.` : null].filter(Boolean).join(" ")}</Alert>}
        <Button type="submit" width="fill" loading={loading} loadingLabel="Aktywowanie…" disabled={cooldown > 0}>
          {cooldown > 0 ? "Ponów po limicie" : "Aktywuj konto"}
        </Button>
      </form>
      <LoginLink />
    </Frame>
  );
}
