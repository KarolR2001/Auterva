"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { SecretForm } from "../ui/secret-form";
import { PasswordInput } from "../ui/password-input";
import { TextInput } from "../ui/text-input";
import { safeReturnTo, type AuthArea } from "./auth-destination";
import { MfaQr } from "./mfa-qr";
import styles from "./auth.module.css";

export type AuthProps = {
  area: AuthArea;
  companyName?: string;
  returnTo?: string;
  recoverCodes?: boolean;
};
type JsonResult = Record<string, unknown>;
type ApiResult = { response: Response; data: JsonResult };
const loginSchema = z.object({
  email: z.email("Podaj poprawny adres e-mail"),
  password: z.string().min(1, "Podaj hasło"),
});
const passwordSchema = z.object({ password: z.string().min(1, "Podaj hasło") });
const codeSchema = z.object({ code: z.string().min(1, "Podaj kod") });
type LoginValues = z.infer<typeof loginSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;
type CodeValues = z.infer<typeof codeSchema>;

export async function postAuth(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api/auth/${path}/`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => {
      if (response.ok) throw new Error("Unreadable success response");
      return {};
    });
    return {
      response,
      data: data && typeof data === "object" ? (data as JsonResult) : {},
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type RequestKind =
  | "login"
  | "password"
  | "mfa"
  | "recovery"
  | "rotate"
  | "resetRequest"
  | "resetPassword"
  | "changePassword"
  | "profile";

export function errorMessage(result: ApiResult, kind: RequestKind): string {
  const { response, data } = result;
  if (response.status === 429)
    return "Limit prób. Odczekaj czas podany przez usługę przed kolejną próbą.";
  if (response.status === 409 || data.code === "MFA_BUSY")
    return "Trwa inna operacja MFA. Spróbuj ponownie za chwilę.";
  if (response.status === 503 || data.code === "MFA_RETRY")
    return "Usługa chwilowo niedostępna. Spróbuj ponownie.";
  if (response.status >= 500)
    return "Usługa chwilowo niedostępna. Spróbuj ponownie.";
  if (response.status === 400 || response.status === 413) {
    if (kind === "resetRequest") return "Podaj poprawny adres e-mail.";
    if (kind === "resetPassword" || kind === "changePassword")
      return "Hasło musi mieć od 12 do 256 znaków.";
    if (kind === "profile")
      return "Nazwa musi mieć od 1 do 100 znaków i nie może zawierać znaków sterujących.";
  }
  // Archived companies and blocked accounts receive the same neutral 401 as bad credentials.
  if (kind === "changePassword")
    return "Nie udało się zmienić hasła. Sprawdź aktualne hasło i spróbuj ponownie.";
  if (kind === "profile")
    return "Nie udało się zapisać nazwy. Odśwież stronę i spróbuj ponownie.";
  if (kind === "login")
    return "Nie udało się zalogować. Sprawdź dane i spróbuj ponownie.";
  if (kind === "password")
    return "Nie udało się potwierdzić hasła. Sprawdź je i spróbuj ponownie.";
  if (kind === "rotate")
    return "Nie udało się wydać kodów. Ponów potwierdzenie czynnika i hasła.";
  if (kind === "recovery")
    return "Kod jest nieprawidłowy lub został użyty. Wpisz inny kod.";
  return "Kod jest nieprawidłowy lub wygasł. Wpisz aktualny kod z aplikacji.";
}

export function useAuthRequest() {
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  // Counts finished requests, so a caller can react to the end of one even when its loading state was batched away.
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    if (!retryUntil || retryUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((retryUntil - Date.now()) / 1000),
      );
      setCooldown(remaining);
      if (!remaining) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [retryUntil]);
  async function run(
    path: string,
    body: Record<string, unknown>,
    kind: RequestKind,
    onSuccess: (data: JsonResult) => boolean | void,
    onUncertain?: () => void,
    onDenied?: (response: Response) => void,
    /** Runs before any message: resolving to true means the caller settled the refusal itself (no banner at all). */
    resolveDenied?: (response: Response) => Promise<boolean>,
  ) {
    if (pending.current || cooldown > 0) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await postAuth(path, body);
      const { response, data } = result;
      // An MFA mutation may be committed before a 5xx (gateway 502/504, failure after commit),
      // so only the explicit technical retry answers (409 MFA_BUSY, 503 MFA_RETRY) are safe to resend.
      const safeRetry =
        response.status === 409 ||
        (response.status === 503 && data.code === "MFA_RETRY");
      if (
        !response.ok &&
        kind !== "login" &&
        response.status >= 500 &&
        !safeRetry &&
        onUncertain
      )
        onUncertain();
      else if (!response.ok) {
        // A refusal that needs an answer from the server first (is the session alive?) shows nothing until it is known,
        // so a screen reader never reads a banner and then a different error.
        if (resolveDenied && (await resolveDenied(result.response))) return;
        setError(errorMessage(result, kind));
        onDenied?.(result.response);
        if ([409, 429, 503].includes(result.response.status)) {
          const seconds = Number(result.response.headers.get("Retry-After"));
          if (Number.isFinite(seconds) && seconds > 0) {
            const delay = Math.ceil(seconds);
            setCooldown(delay);
            setRetryUntil(Date.now() + delay * 1000);
          }
        }
      } else if (onSuccess(result.data) === false) onUncertain?.();
    } catch {
      if (onUncertain) onUncertain();
      else
        setError(
          "Nie udało się połączyć. Sprawdź połączenie i spróbuj ponownie.",
        );
    } finally {
      pending.current = false;
      setLoading(false);
      setSettled((count) => count + 1);
    }
  }
  return {
    run,
    loading,
    settled,
    error,
    cooldown,
    setError,
    clearError: () => setError(""),
  };
}

export function AuthFrame({
  area,
  title,
  context,
  view,
  step,
  footer,
  children,
}: AuthProps & {
  title: string;
  context?: string;
  view: "login" | "mfa" | "reset";
  step?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.page} data-area={area} data-view={view} data-step={step}>
      <p className={styles.brand}>{area === "platform" ? "A AUTERVA" : "AUTERVA"}</p>
      <section className={styles.card} aria-labelledby="auth-title">
        {context && <p className={styles.context}>{context}</p>}
        <h1 id="auth-title" tabIndex={-1}>
          {title}
        </h1>
        {children}
        {(area === "platform" || view === "reset" || (view === "mfa" && step !== "challenge")) && footer && <p className={styles.footer}>{footer}</p>}
      </section>
      {area === "company" && (view === "login" || step === "challenge") && footer && <p className={styles.footer}>{footer}</p>}
    </main>
  );
}

export function ErrorNotice({
  message,
  cooldown,
}: {
  message: string;
  cooldown: number;
}) {
  if (!message) return null;
  return (
    <Alert tone="error" title={message}>
      {cooldown > 0 ? `Ponów za ${cooldown} s.` : undefined}
    </Alert>
  );
}

function PendingNotice({ active }: { active: boolean }) {
  return (
    <p className={styles.pending} role="status">
      {active ? "Trwa weryfikacja kodu. Nie wysyłaj go ponownie." : ""}
    </p>
  );
}

export function LoginForm({
  area,
  returnTo,
  recoverCodes,
  sessionExpired,
  passwordChanged,
}: AuthProps & { sessionExpired?: boolean; passwordChanged?: boolean }) {
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const request = useAuthRequest();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const destination = safeReturnTo(area, returnTo);
  return (
    <AuthFrame
      area={area}
      view="login"
      title={area === "company" ? "Zaloguj się do panelu" : "Zaloguj się"}
      context={area === "company" ? "Panel administratora" : "Panel Auterva"}
      footer={area === "company"
        ? "MFA wymagane • brak publicznej rejestracji"
        : "Chroniony panel Autervy"}
    >
      <p className={styles.intro}>{area === "company"
        ? "Zarządzaj flotą i dostępnością. Po haśle potwierdzisz logowanie kodem MFA."
        : "Dostęp dla operatorów Autervy • po haśle wymagany drugi składnik MFA."}</p>
      {(sessionExpired || recoverCodes || passwordChanged) && (
        <div className={styles.notices}>
          {passwordChanged && (
            <Alert tone="success" title="Hasło zostało zmienione.">
              Wszystkie sesje zostały zakończone. Zaloguj się nowym hasłem i
              potwierdź logowanie kodem MFA.
            </Alert>
          )}
          {sessionExpired && (
            <Alert tone="info" title="Twoja sesja wygasła. Zaloguj się ponownie." />
          )}
          {recoverCodes && (
            <Alert tone="info" title="Po zalogowaniu wydasz nowe kody odzyskania.">
              Potwierdzisz świeży kod z aplikacji i hasło. Poprzedniej listy nie
              można odczytać ponownie.
            </Alert>
          )}
        </div>
      )}
      <SecretForm
        className={`${styles.form} ${styles.loginForm}`}
        onSubmit={form.handleSubmit((values) =>
          request.run("sign-in/email", values, "login", (data) => {
            if (
              data.enrollmentRequired === true ||
              data.twoFactorRedirect === true
            ) {
              const path = area === "company" ? "/admin/mfa" : "/mfa";
              window.location.replace(
                `${path}?returnTo=${encodeURIComponent(destination)}${recoverCodes ? "&recoverCodes=1" : ""}`,
              );
            } else
              request.setError(
                "Nie udało się dokończyć logowania. Spróbuj ponownie.",
              );
          }),
        )}
      >
        <FormField
          id="auth-email"
          label={area === "company" ? "E-mail" : "Adres e-mail"}
          required
          hint={area === "company" ? "Adres przypisany do konta" : "Użyj adresu administratora."}
          error={form.formState.errors.email?.message}
        >
          <TextInput
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder={area === "company" ? "admin@firma.pl" : undefined}
            {...form.register("email")}
          />
        </FormField>
        <PasswordInput
          id="auth-password"
          label="Hasło"
          autoComplete="current-password"
          required
          placeholder={area === "platform" ? "Wpisz hasło" : undefined}
          hint={area === "platform" ? "Wielkość liter ma znaczenie." : undefined}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />
        <ErrorNotice message={request.error} cooldown={request.cooldown} />
        <Button
          type="submit"
          width="fill"
          loading={request.loading}
          loadingLabel="Logowanie…"
          disabled={request.cooldown > 0}
        >
          {request.cooldown > 0 ? "Ponów po limicie" : "Zaloguj się"}
        </Button>
        <p className={styles.linkRow}>
          <Link href={area === "company" ? "/admin/reset-hasla" : "/reset-hasla"}>
            Nie pamiętasz hasła?
            {/* ADM-01: "Nie pamiętasz hasła?  Zresetuj je →" is one link; the arrow stays out of its name. */}
            {area === "company" && (
              <>
                {" "}
                <span className={styles.resetCta}>
                  Zresetuj je <span aria-hidden="true">→</span>
                </span>
              </>
            )}
          </Link>
        </p>
      </SecretForm>
    </AuthFrame>
  );
}

type MfaStep =
  | "password"
  | "setup"
  | "codes"
  | "challenge"
  | "recovery"
  | "uncertain"
  | "restoreFactor"
  | "restorePassword"
  | "proofExpired"
  | "manual";
export function MfaFlow({
  area,
  companyName,
  initialMode,
  returnTo,
  recoverCodes,
}: AuthProps & { initialMode: "enroll" | "challenge" | "restore" }) {
  const [step, setStep] = useState<MfaStep>(
    initialMode === "enroll"
      ? "password"
      : initialMode === "restore"
        ? "restoreFactor"
        : "challenge",
  );
  const [uncertainFrom, setUncertainFrom] = useState<MfaStep>("challenge");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [proof, setProof] = useState("");
  const [afterRecovery, setAfterRecovery] = useState(false);
  const [recoveryIntent, setRecoveryIntent] = useState(Boolean(recoverCodes));
  const [secret, setSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const request = useAuthRequest();
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) {
      document.getElementById("auth-title")?.focus();
      previousStep.current = step;
    }
  }, [step]);
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "" },
  });
  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });
  const finish = () => window.location.replace(safeReturnTo(area, returnTo));
  const mfaPath = area === "company" ? "/admin/mfa" : "/mfa";
  const mfaUrl = `${mfaPath}?returnTo=${encodeURIComponent(safeReturnTo(area, returnTo))}`;
  const changeStep = (next: MfaStep) => {
    request.clearError();
    codeForm.reset();
    passwordForm.reset();
    setStep(next);
  };
  const markUncertain = (from: MfaStep) => {
    if (["setup", "restoreFactor", "restorePassword"].includes(from)) {
      setRecoveryIntent(true);
      window.history.replaceState(null, "", `${mfaUrl}&recoverCodes=1`);
    }
    setUncertainFrom(from);
    setCheckError("");
    setStep("uncertain");
  };
  const enterRestore = () => {
    setSecret("");
    setTotpUri("");
    setProof("");
    codeForm.reset();
    passwordForm.reset();
    window.history.replaceState(null, "", `${mfaUrl}&recoverCodes=1`);
    setRecoveryIntent(true);
    setStep("restoreFactor");
  };
  const checkSession = async () => {
    if (checking) return;
    setChecking(true);
    setCheckError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/auth/get-session/", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) {
        if (
          recoveryIntent ||
          ["setup", "restoreFactor", "restorePassword"].includes(uncertainFrom)
        )
          enterRestore();
        else finish();
      } else if (response.status === 401)
        // The server page decides: limited session → enrollment, pending challenge → challenge, none → login.
        window.location.replace(
          `${mfaUrl}${recoveryIntent ? "&recoverCodes=1" : ""}`,
        );
      else setCheckError("unavailable");
    } catch {
      setCheckError("unavailable");
    } finally {
      clearTimeout(timeout);
      setChecking(false);
    }
  };
  const submitLabel = (label: string) =>
    request.cooldown > 0 ? "Ponów po limicie" : label;
  const title =
    step === "password"
      ? afterRecovery
        ? "Potwierdź hasło"
        : "Włącz dodatkową ochronę"
      : step === "setup"
        ? "Włącz dodatkową ochronę"
        : step === "codes"
          ? "Zapisz kody odzyskania"
          : step === "restoreFactor"
            ? "Wydaj nowe kody"
            : step === "restorePassword"
              ? "Potwierdź hasło"
              : step === "proofExpired"
                ? "Weryfikacja wygasła"
                : step === "uncertain"
                  ? "Sprawdź stan MFA"
                  : step === "manual"
                    ? "Nie masz dostępu do kodów?"
                    : step === "recovery"
                      ? "Użyj kodu odzyskania"
                      : "Potwierdź logowanie";
  const loginPath = area === "company" ? "/admin/login" : "/login";
  const loginHref = `${loginPath}?returnTo=${encodeURIComponent(safeReturnTo(area, returnTo))}${recoveryIntent ? "&recoverCodes=1" : ""}`;
  const showContext = !(
    step === "setup" ||
    step === "manual" ||
    (step === "password" && !afterRecovery)
  );
  return (
    <AuthFrame
      area={area}
      companyName={companyName}
      view="mfa"
      step={step}
      title={title}
      context={showContext ? "Weryfikacja MFA" : undefined}
      footer={["challenge", "setup", "manual"].includes(step)
        ? "MFA wymagane dla kont administratorów • kod jednorazowy"
        : undefined}
    >
      {step === "challenge" && <p className={styles.intro}>Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej.</p>}
      {step === "manual" && (
        <>
          <p className={styles.intro}>Skontaktuj się z pomocą Autervy. Odzyskanie dostępu wymaga ręcznego potwierdzenia tożsamości przez właściciela. Sam reset hasła nie wyłącza MFA.</p>
          <Button variant="secondary" width="fill" className={styles.manualAction} onClick={() => changeStep("recovery")}>Wróć do kodu odzyskania</Button>
        </>
      )}
      {step === "password" && (
        <SecretForm
          className={styles.form}
          onSubmit={passwordForm.handleSubmit(({ password }) =>
            request.run(
              "two-factor/enable",
              { password, method: "totp" },
              "password",
              (data) => {
                if (
                  typeof data.totpURI === "string" &&
                  data.totpURI.startsWith("otpauth://totp/")
                ) {
                  try {
                    const value = new URL(data.totpURI).searchParams.get(
                      "secret",
                    );
                    if (value) {
                      setSecret(value);
                      setTotpUri(data.totpURI);
                      passwordForm.reset();
                      setStep("setup");
                      return true;
                    }
                  } catch {
                    /* an invalid response cannot start enrollment */
                  }
                }
                return false;
              },
              () => markUncertain("password"),
            ),
          )}
        >
          <p className={styles.intro}>
            {afterRecovery
              ? "Kod odzyskania został przyjęty. Aby ponownie skonfigurować MFA, potwierdź hasło. Dostęp do panelu nadal jest ograniczony."
              : "Połącz aplikację uwierzytelniającą z kontem. Potwierdź hasło, aby rozpocząć."}
          </p>
          <PasswordInput
            id="mfa-password"
            label={afterRecovery ? "Hasło" : "Potwierdź hasło"}
            autoComplete="current-password"
            placeholder="Wpisz hasło"
            hint={afterRecovery ? "Hasło nie zastępuje drugiego składnika." : undefined}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            error={passwordForm.formState.errors.password?.message}
            {...passwordForm.register("password")}
          />
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            loading={request.loading}
            loadingLabel="Przygotowywanie…"
            disabled={request.cooldown > 0}
          >
            {submitLabel(afterRecovery ? "Potwierdź hasło" : "Rozpocznij konfigurację")}
          </Button>
        </SecretForm>
      )}
      {(step === "setup" || step === "challenge" || step === "recovery") && (
        <SecretForm
          className={styles.form}
          onSubmit={codeForm.handleSubmit(({ code: rawCode }) => {
            const code = step === "recovery" ? rawCode : rawCode.replace(/\s+/g, "");
            if (step !== "recovery" && !/^\d{6}$/.test(code)) {
              request.setError("Kod z aplikacji musi mieć 6 cyfr.");
              return;
            }
            void request.run(
              step === "recovery"
                ? "two-factor/verify-backup-code"
                : "two-factor/verify-totp",
              { code, trustDevice: false },
              step === "recovery" ? "recovery" : "mfa",
              (data) => {
                if (step === "recovery" && data.enrollmentRequired === true) {
                  codeForm.reset();
                  setAfterRecovery(true);
                  setStep("password");
                  return true;
                }
                if (step === "setup") {
                  const codes = Array.isArray(data.backupCodes)
                    ? data.backupCodes.filter(
                        (v): v is string => typeof v === "string",
                      )
                    : [];
                  if (codes.length) {
                    setBackupCodes(codes);
                    setSecret("");
                    setTotpUri("");
                    codeForm.reset();
                    setStep("codes");
                    return true;
                  }
                  return false;
                }
                if (data.status === true) {
                  window.location.replace(
                    recoveryIntent
                      ? `${mfaUrl}&recoverCodes=1`
                      : safeReturnTo(area, returnTo),
                  );
                  return true;
                }
                return false;
              },
              () => markUncertain(step),
            );
          })}
        >
          {step === "setup" && (
            <div className={styles.setup}>
              <p className={styles.intro}>Zeskanuj kod w aplikacji uwierzytelniającej, a następnie wpisz otrzymany kod.</p>
              {totpUri && <MfaQr uri={totpUri} />}
              <p className={styles.intro}>Nie możesz zeskanować kodu? Wpisz klucz ręcznie:
                <code className={styles.secret}>{secret.replace(/(.{4})(?=.)/g, "$1 ")}</code>
              </p>
            </div>
          )}
          {step === "recovery" && (
            <p className={styles.intro}>
              Wpisz jeden z zapisanych kodów. Można go użyć tylko raz. Potem
              skonfigurujesz MFA ponownie.
            </p>
          )}
          <FormField
            id="mfa-code"
            label={step === "recovery" ? "Kod odzyskania" : "Kod MFA"}
            required
            hint={step === "recovery" ? "Kod jest jednorazowy" : "Kod jest ważny tylko przez krótki czas"}
            error={codeForm.formState.errors.code?.message}
          >
            <TextInput
              autoComplete="one-time-code"
              inputMode={step === "recovery" ? "text" : "numeric"}
              placeholder={step === "recovery" ? "Wpisz kod odzyskania" : "000 000"}
              {...codeForm.register("code")}
            />
          </FormField>
          <PendingNotice active={request.loading} />
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            loading={request.loading}
            loadingLabel="Sprawdzanie…"
            disabled={request.cooldown > 0}
          >
            {submitLabel(step === "setup" ? "Włącz MFA i pokaż kody" : "Potwierdź kod")}
          </Button>
          {step !== "setup" && (
            <Button
              variant="secondary"
              width="fill"
              disabled={request.loading}
              onClick={() => changeStep(step === "recovery" ? "challenge" : "recovery")}
            >
              {step === "recovery" ? "Użyj kodu z aplikacji" : "Nie mam dostępu do aplikacji"}
            </Button>
          )}
          {step === "recovery" && (
            <Button
              variant="tertiary"
              width="fill"
              disabled={request.loading}
              onClick={() => changeStep("manual")}
            >
              Nie mam aplikacji ani kodów
            </Button>
          )}
        </SecretForm>
      )}
      {step === "uncertain" && (
        <div className={styles.form}>
          <p className={styles.intro}>
            Nie wiadomo, czy operacja została zakończona. Nie wysyłaj ponownie
            tego samego kodu. Sprawdź stan, aby bezpiecznie kontynuować.
          </p>
          {checkError ? (
            <Alert tone="error" title="Nie udało się sprawdzić sesji.">
              Wynik nadal jest niepotwierdzony. Spróbuj ponownie po
              przywróceniu połączenia.
            </Alert>
          ) : (
            <Alert tone="warning" title="Stan niepotwierdzony.">
              Jeśli sprawdzenie sesji się nie powiedzie, pozostań tutaj i
              spróbuj ponownie po odzyskaniu połączenia.
            </Alert>
          )}
          <Button
            onClick={() => void checkSession()}
            loading={checking}
            loadingLabel="Sprawdzanie…"
          >
            {checkError ? "Ponów odczyt sesji" : "Sprawdź stan"}
          </Button>
        </div>
      )}
      {step === "restoreFactor" && (
        <SecretForm
          className={styles.form}
          onSubmit={codeForm.handleSubmit(({ code: rawCode }) => {
            const code = rawCode.replace(/\s+/g, "");
            if (!/^\d{6}$/.test(code)) {
              request.setError("Kod z aplikacji musi mieć 6 cyfr.");
              return;
            }
            void request.run(
              "mfa/reauth",
              { method: "totp", code },
              "mfa",
              (data) => {
                if (
                  typeof data.proof !== "string" ||
                  !/^[a-f0-9]{64}$/.test(data.proof)
                )
                  return false;
                setProof(data.proof);
                codeForm.reset();
                setStep("restorePassword");
                return true;
              },
              () => markUncertain("restoreFactor"),
            );
          })}
        >
          <p className={styles.intro}>
            Poprzednia lista nie jest dostępna. Potwierdź świeży kod z
            aplikacji, a następnie hasło. Nowa lista unieważni stare kody.
          </p>
          <FormField
            id="mfa-restore-code"
            label="Nowy kod z aplikacji"
            required
            hint="Użyj aktualnego kodu."
            error={codeForm.formState.errors.code?.message}
          >
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="000 000"
              {...codeForm.register("code")}
            />
          </FormField>
          <PendingNotice active={request.loading} />
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            loading={request.loading}
            loadingLabel="Sprawdzanie…"
            disabled={request.cooldown > 0}
          >
            {submitLabel("Potwierdź kod")}
          </Button>
        </SecretForm>
      )}
      {step === "restorePassword" && (
        <SecretForm
          className={styles.form}
          onSubmit={passwordForm.handleSubmit(({ password }) => {
            void request.run(
              "mfa/rotate-backup-codes",
              { password, proof },
              "rotate",
              (data) => {
                const codes = Array.isArray(data.backupCodes)
                  ? data.backupCodes.filter(
                      (v): v is string => typeof v === "string",
                    )
                  : [];
                if (data.status !== true || !codes.length) return false;
                setBackupCodes(codes);
                setProof("");
                passwordForm.reset();
                setStep("codes");
                return true;
              },
              () => markUncertain("restorePassword"),
              (response) => {
                // A refused or expired one-time proof is never retried; a fresh factor is required.
                if (response.status === 401) {
                  setProof("");
                  passwordForm.reset();
                  setStep("proofExpired");
                }
              },
            );
          })}
        >
          <p className={styles.intro}>
            Świeży czynnik został potwierdzony. Potwierdź hasło, aby wydać nową
            jednorazową listę kodów odzyskania.
          </p>
          <PasswordInput
            id="mfa-restore-password"
            label="Hasło"
            autoComplete="current-password"
            placeholder="Wpisz hasło"
            hint="Po wydaniu nowej listy stare kody wygasną."
            visibility={visibility}
            onVisibilityChange={setVisibility}
            error={passwordForm.formState.errors.password?.message}
            {...passwordForm.register("password")}
          />
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            loading={request.loading}
            loadingLabel="Wydawanie…"
            disabled={request.cooldown > 0}
          >
            {submitLabel("Wydaj nowe kody")}
          </Button>
          <Button
            variant="secondary"
            width="fill"
            disabled={request.loading}
            onClick={() => {
              setProof("");
              changeStep("restoreFactor");
            }}
          >
            Wróć do weryfikacji
          </Button>
        </SecretForm>
      )}
      {step === "proofExpired" && (
        <div className={styles.form}>
          <p className={styles.intro}>
            Nie wydano nowych kodów. Potwierdź ponownie świeży kod z aplikacji,
            a potem hasło.
          </p>
          <Alert tone="error" title="Potwierdzenie wygasło lub zostało odrzucone.">
            Zacznij od nowego kodu.
          </Alert>
          <Button onClick={() => changeStep("restoreFactor")}>
            Ponów weryfikację
          </Button>
        </div>
      )}
      {step === "codes" && (
        <div className={styles.form}>
          <p className={styles.intro}>
            Zapisz nową listę w bezpiecznym miejscu. Każdy kod działa tylko raz.
            Po opuszczeniu tego widoku nie pokażemy ich ponownie.
          </p>
          <section className={styles.codesBox} aria-labelledby="mfa-codes-title">
            <h2 id="mfa-codes-title" className={styles.codesTitle}>
              Jednorazowe kody odzyskania
            </h2>
            <ul className={styles.codes}>
              {backupCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          </section>
          <Button onClick={finish}>Zapisałem kody</Button>
        </div>
      )}
      {["challenge", "setup", "manual", "uncertain"].includes(step) ? (
        <Link className={styles.loginLink} href={loginHref}>
          Wróć do logowania
        </Link>
      ) : null}
    </AuthFrame>
  );
}
