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
import styles from "./auth.module.css";

type AuthProps = { area: AuthArea; companyName?: string; returnTo?: string };
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
    const data = await response.json().catch(() => ({}));
    return {
      response,
      data: data && typeof data === "object" ? (data as JsonResult) : {},
    };
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(result: ApiResult, kind: "login" | "mfa"): string {
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
    kind: "login" | "mfa",
    onSuccess: (data: JsonResult) => void,
  ) {
    if (pending.current || cooldown > 0) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await postAuth(path, body);
      if (!result.response.ok) {
        setError(errorMessage(result, kind));
        if ([409, 429, 503].includes(result.response.status)) {
          const seconds = Number(result.response.headers.get("Retry-After"));
          if (Number.isFinite(seconds) && seconds > 0) {
            const delay = Math.min(seconds, 60);
            setCooldown(delay);
            setRetryUntil(Date.now() + delay * 1000);
          }
        }
      } else onSuccess(result.data);
    } catch {
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
  companyName,
  title,
  children,
}: AuthProps & { title: string; children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <p className={styles.brand}>Auterva</p>
        <p className={styles.context}>
          {area === "company"
            ? (companyName ?? "Panel firmy")
            : "Panel platformy"}
        </p>
        <h1 id="auth-title">{title}</h1>
        {children}
      </section>
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

export function LoginForm({ area, companyName, returnTo }: AuthProps) {
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
      companyName={companyName}
      title="Zaloguj się do panelu"
    >
      <p>Podaj adres e-mail i hasło administratora.</p>
      <form
        className={styles.form}
        noValidate
        onSubmit={form.handleSubmit((values) =>
          request.run("sign-in/email", values, "login", (data) => {
            if (
              data.enrollmentRequired === true ||
              data.twoFactorRedirect === true
            ) {
              const path = area === "company" ? "/admin/mfa" : "/mfa";
              window.location.replace(
                `${path}?returnTo=${encodeURIComponent(destination)}`,
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
          label="Adres e-mail"
          required
          error={form.formState.errors.email?.message}
        >
          <TextInput
            type="email"
            autoComplete="username"
            inputMode="email"
            {...form.register("email")}
          />
        </FormField>
        <PasswordInput
          id="auth-password"
          label="Hasło"
          autoComplete="current-password"
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
          Zaloguj
        </Button>
      </form>
    </AuthFrame>
  );
}

type MfaStep = "password" | "setup" | "codes" | "challenge" | "recovery";
export function MfaFlow({
  area,
  companyName,
  initialMode,
  returnTo,
}: AuthProps & { initialMode: "enroll" | "challenge" }) {
  const [step, setStep] = useState<MfaStep>(
    initialMode === "enroll" ? "password" : "challenge",
  );
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const request = useAuthRequest();
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "" },
  });
  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });
  const finish = () => window.location.replace(safeReturnTo(area, returnTo));
  const codeLabel = step === "recovery" ? "Kod odzyskania" : "Kod z aplikacji";
  const title =
    step === "password" || step === "setup"
      ? "Skonfiguruj MFA"
      : step === "codes"
        ? "Zapisz kody odzyskania"
        : "Potwierdź logowanie";
  const loginPath = area === "company" ? "/admin/login" : "/login";
  return (
    <AuthFrame area={area} companyName={companyName} title={title}>
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
                      passwordForm.reset();
                      setStep("setup");
                      return;
                    }
                  } catch {
                    /* an invalid response cannot start enrollment */
                  }
                }
                request.setError(
                  "Nie udało się przygotować MFA. Spróbuj ponownie.",
                );
              },
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
                  return;
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
                    codeForm.reset();
                    setStep("codes");
                  } else
                    request.setError(
                      "Nie udało się pobrać kodów odzyskania. Spróbuj ponownie.",
                    );
                  return;
                }
                if (data.status === true) finish();
                else
                  request.setError(
                    "Nie udało się potwierdzić MFA. Spróbuj ponownie.",
                  );
              },
            );
          })}
        >
          {step === "setup" && (
            <p>
              Wpisz ten klucz w aplikacji uwierzytelniającej, a następnie
              potwierdź kod: <code className={styles.secret}>{secret}</code>
            </p>
          )}
          {step === "challenge" && (
            <p>Wpisz kod z aplikacji uwierzytelniającej.</p>
          )}
          {step === "recovery" && (
            <p>
              Wpisz jeden z zapisanych kodów odzyskania. Po użyciu
              skonfigurujesz MFA ponownie.
            </p>
          )}
          <FormField
            id="mfa-code"
            label={codeLabel}
            required
            error={codeForm.formState.errors.code?.message}
          >
            <TextInput
              autoComplete="one-time-code"
              inputMode={step === "recovery" ? "text" : "numeric"}
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
            {step === "setup" ? "Potwierdź MFA" : "Potwierdź kod"}
          </Button>
          {step !== "setup" && (
            <Button
              variant="tertiary"
              onClick={() => {
                request.clearError();
                codeForm.reset();
                setStep(step === "recovery" ? "challenge" : "recovery");
              }}
            >
              {step === "recovery" ? "Użyj aplikacji" : "Użyj kodu odzyskania"}
            </Button>
          )}
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
      {step === "challenge" || step === "recovery" ? (
        <Link
          className={styles.loginLink}
          href={`${loginPath}?returnTo=${encodeURIComponent(safeReturnTo(area, returnTo))}`}
        >
          Wróć do logowania
        </Link>
      ) : null}
      <p className={styles.help}>
        Nie masz dostępu do aplikacji ani kodów? Skorzystaj z ręcznej procedury
        odzyskania prowadzonej przez właściciela Autervy.
      </p>
    </AuthFrame>
  );
}
