"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { PasswordInput } from "../ui/password-input";
import { TextInput } from "../ui/text-input";
import { safeReturnTo, type AuthArea } from "./auth-destination";
import { MfaQr } from "./mfa-qr";
import styles from "./auth.module.css";

type AuthProps = {
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

async function postAuth(
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

function errorMessage(
  result: ApiResult,
  kind: "login" | "mfa" | "rotate",
): string {
  const { response, data } = result;
  if (response.status === 429)
    return "Zbyt wiele prób. Odczekaj i spróbuj ponownie.";
  if (response.status === 409 || data.code === "MFA_BUSY")
    return "Trwa inna operacja MFA. Spróbuj ponownie za chwilę.";
  if (response.status === 503 || data.code === "MFA_RETRY")
    return "Usługa chwilowo niedostępna. Spróbuj ponownie.";
  if (response.status >= 500)
    return "Usługa chwilowo niedostępna. Spróbuj ponownie.";
  if (kind === "login") return "Adres e-mail lub hasło są nieprawidłowe.";
  if (kind === "rotate")
    return "Nie udało się wydać kodów. Ponów potwierdzenie czynnika i hasła.";
  return "Nie udało się potwierdzić kodu. Sprawdź go lub zaloguj się ponownie.";
}

function useAuthRequest() {
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [cooldown, setCooldown] = useState(0);
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
    kind: "login" | "mfa" | "rotate",
    onSuccess: (data: JsonResult) => boolean | void,
    onUncertain?: () => void,
    onDenied?: (response: Response) => void,
  ) {
    if (pending.current || cooldown > 0) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await postAuth(path, body);
      if (!result.response.ok) {
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
    }
  }
  return {
    run,
    loading,
    error,
    cooldown,
    setError,
    clearError: () => setError(""),
  };
}

function AuthFrame({
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
  view: "login" | "mfa";
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
        {(area === "platform" || (view === "mfa" && step !== "challenge")) && footer && <p className={styles.footer}>{footer}</p>}
      </section>
      {area === "company" && (view === "login" || step === "challenge") && footer && <p className={styles.footer}>{footer}</p>}
    </main>
  );
}

function ErrorNotice({
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

export function LoginForm({
  area,
  returnTo,
  recoverCodes,
}: AuthProps) {
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
      <form
        className={`${styles.form} ${styles.loginForm}`}
        noValidate
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
            aria-label="Adres e-mail"
            {...form.register("email")}
          />
        </FormField>
        <PasswordInput
          id="auth-password"
          label="Hasło"
          autoComplete="current-password"
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
          Zaloguj się
        </Button>
      </form>
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
        window.location.replace(
          `${mfaUrl}${recoveryIntent ? "&recoverCodes=1" : ""}`,
        );
      else
        setCheckError(
          "Nie można teraz sprawdzić sesji. Spróbuj ponownie po przywróceniu połączenia.",
        );
    } catch {
      setCheckError(
        "Nie można teraz sprawdzić sesji. Spróbuj ponownie po przywróceniu połączenia.",
      );
    } finally {
      clearTimeout(timeout);
      setChecking(false);
    }
  };
  const codeLabel =
    step === "recovery"
      ? "Kod odzyskania"
      : step === "restoreFactor"
        ? "Nowy kod z aplikacji"
        : "Kod z aplikacji";
  const title =
    step === "password" || step === "setup"
      ? "Włącz dodatkową ochronę"
      : step === "codes"
        ? "Zapisz kody odzyskania"
        : step === "restoreFactor" || step === "restorePassword"
          ? "Wydaj nowe kody odzyskania"
          : step === "uncertain"
            ? "Sprawdź stan MFA"
            : step === "manual"
              ? "Nie masz dostępu do kodów?"
              : step === "recovery"
                ? "Użyj kodu odzyskania"
            : "Potwierdź logowanie";
  const loginPath = area === "company" ? "/admin/login" : "/login";
  return (
    <AuthFrame
      area={area}
      companyName={companyName}
      view="mfa"
      step={step}
      title={title}
      context={step === "challenge" ? "Weryfikacja MFA" : undefined}
      footer={["challenge", "setup", "manual"].includes(step)
        ? "MFA wymagane dla kont administratorów • kod jednorazowy"
        : undefined}
    >
      {step === "challenge" && <p className={styles.intro}>Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej.</p>}
      {step === "manual" && (
        <>
          <p className={styles.intro}>Skontaktuj się z pomocą Autervy. Odzyskanie dostępu wymaga ręcznego potwierdzenia tożsamości przez właściciela. Sam reset hasła nie wyłącza MFA.</p>
          <Button variant="secondary" width="fill" className={styles.manualAction} onClick={() => setStep("recovery")}>Wróć do kodu odzyskania</Button>
        </>
      )}
      {step === "password" && (
        <form
          className={styles.form}
          noValidate
          onSubmit={passwordForm.handleSubmit(({ password }) =>
            request.run(
              "two-factor/enable",
              { password, method: "totp" },
              "mfa",
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
          <p>
            Połącz aplikację uwierzytelniającą z kontem. Potwierdź hasło, aby
            rozpocząć.
          </p>
          <PasswordInput
            id="mfa-password"
            label="Potwierdź hasło"
            autoComplete="current-password"
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
            Rozpocznij konfigurację
          </Button>
        </form>
      )}
      {(step === "setup" || step === "challenge" || step === "recovery") && (
        <form
          className={styles.form}
          noValidate
          onSubmit={codeForm.handleSubmit(({ code }) => {
            if (step !== "recovery" && !/^\d{6}$/.test(code)) {
              request.setError("Kod z aplikacji musi mieć 6 cyfr.");
              return;
            }
            void request.run(
              step === "recovery"
                ? "two-factor/verify-backup-code"
                : "two-factor/verify-totp",
              { code, trustDevice: false },
              "mfa",
              (data) => {
                if (step === "recovery" && data.enrollmentRequired === true) {
                  codeForm.reset();
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
            <div>
              <p>Zeskanuj kod w aplikacji uwierzytelniającej, a następnie wpisz otrzymany kod.</p>
              {totpUri && <MfaQr uri={totpUri} />}
              <p>Nie możesz zeskanować kodu? Wpisz klucz ręcznie:
                <code className={styles.secret}>{secret}</code>
              </p>
            </div>
          )}
          {step === "recovery" && (
            <p>
              Wpisz jeden z zapisanych kodów odzyskania. Po użyciu
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
              aria-label={codeLabel}
              placeholder={step === "recovery" ? "Wpisz kod odzyskania" : "000 000"}
              {...codeForm.register("code")}
            />
          </FormField>
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            loading={request.loading}
            loadingLabel="Sprawdzanie…"
            disabled={request.cooldown > 0}
          >
            {step === "setup" ? "Włącz MFA i pokaż kody" : "Potwierdź kod"}
          </Button>
          {step !== "setup" && (
            <Button
              variant="secondary"
              width="fill"
              onClick={() => {
                request.clearError();
                codeForm.reset();
                setStep(step === "recovery" ? "challenge" : "recovery");
              }}
            >
              {step === "recovery" ? "Użyj aplikacji" : "Nie mam dostępu do aplikacji"}
            </Button>
          )}
        </form>
      )}
      {step === "uncertain" && (
        <div className={styles.form}>
          <Alert tone="warning" title="Nie wiadomo, czy operacja została zakończona">
            Nie ponawiaj teraz tej próby. Sprawdź stan sesji, aby bezpiecznie
            kontynuować.
          </Alert>
          {checkError && <ErrorNotice message={checkError} cooldown={0} />}
          <Button
            onClick={() => void checkSession()}
            loading={checking}
            loadingLabel="Sprawdzanie…"
          >
            Sprawdź stan
          </Button>
        </div>
      )}
      {step === "restoreFactor" && (
        <form
          className={styles.form}
          noValidate
          onSubmit={codeForm.handleSubmit(({ code }) => {
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
          <p>
            Kody mogły zostać wydane, ale odpowiedź nie dotarła. Aby otrzymać
            nową listę, potwierdź świeży kod z aplikacji i hasło. Poprzednie
            kody stracą ważność.
          </p>
          <FormField
            id="mfa-restore-code"
            label="Nowy kod z aplikacji"
            required
            error={codeForm.formState.errors.code?.message}
          >
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              {...codeForm.register("code")}
            />
          </FormField>
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            loading={request.loading}
            loadingLabel="Sprawdzanie…"
            disabled={request.cooldown > 0}
          >
            Potwierdź czynnik
          </Button>
        </form>
      )}
      {step === "restorePassword" && (
        <form
          className={styles.form}
          noValidate
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
                if (response.status === 401) {
                  setProof("");
                  passwordForm.reset();
                  setStep("restoreFactor");
                }
              },
            );
          })}
        >
          <p>Potwierdź hasło, aby wydać nowe jednorazowe kody odzyskania.</p>
          <PasswordInput
            id="mfa-restore-password"
            label="Potwierdź hasło"
            autoComplete="current-password"
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
            Wydaj nowe kody
          </Button>
        </form>
      )}
      {step === "codes" && (
        <div className={styles.form}>
          <p>
            Zapisz kody w bezpiecznym miejscu. Każdy można użyć tylko raz; po
            zamknięciu nie będą ponownie pokazane.
          </p>
          <ul className={styles.codes}>
            {backupCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <Button onClick={finish}>Zapisałem kody</Button>
        </div>
      )}
      {["challenge", "recovery", "setup", "manual"].includes(step) ? (
        <Link
          className={styles.loginLink}
          href={`${loginPath}?returnTo=${encodeURIComponent(safeReturnTo(area, returnTo))}${recoveryIntent ? "&recoverCodes=1" : ""}`}
        >
          Wróć do logowania
        </Link>
      ) : null}
      {step === "recovery" && (
        <Button
          variant="tertiary"
          width="fill"
          className={styles.manualAction}
          onClick={() => {
            request.clearError();
            codeForm.reset();
            setStep("manual");
          }}
        >
          Nie mam aplikacji ani kodów
        </Button>
      )}
    </AuthFrame>
  );
}
