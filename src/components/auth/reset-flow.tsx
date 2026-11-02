"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { PasswordInput } from "../ui/password-input";
import { TextInput } from "../ui/text-input";
import {
  AuthFrame,
  ErrorNotice,
  useAuthRequest,
  type AuthProps,
} from "./auth-flow";
import { evaluatePassword } from "./password-policy";
import { PasswordStrength } from "./password-strength";
import styles from "./auth.module.css";

const NEUTRAL =
  "Jeśli konto z tym adresem istnieje, wyślemy instrukcję resetu hasła.";
const requestSchema = z.object({
  email: z.email("Podaj poprawny adres e-mail"),
});
type RequestValues = z.infer<typeof requestSchema>;

function paths(area: AuthProps["area"]) {
  return area === "company"
    ? { login: "/admin/login", reset: "/admin/reset-hasla" }
    : { login: "/login", reset: "/reset-hasla" };
}

// ADM-02: the answer never depends on whether the address belongs to an account.
export function ResetRequestForm({ area }: AuthProps) {
  const [sent, setSent] = useState(false);
  // A retry of the same request reuses its key; a different address needs a new one, otherwise the
  // server would treat it as a duplicate of the first and send nothing.
  const [attempt, setAttempt] = useState({ email: "", key: "" });
  const request = useAuthRequest();
  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: "" },
  });
  const where = paths(area);
  return (
    <AuthFrame
      area={area}
      view="reset"
      title="Zresetuj hasło"
      context={area === "company" ? "Panel administratora" : "Panel Auterva"}
    >
      {sent ? (
        <div className={styles.notices}>
          <Alert tone="success" title={NEUTRAL}>
            Link jest ważny 30 minut i działa jednorazowo. Nowe żądanie
            unieważnia poprzedni link.
          </Alert>
          <p className={styles.linkRow}>
            <Link href={where.login}>Wróć do logowania</Link>
          </p>
        </div>
      ) : (
        <form
          className={styles.form}
          noValidate
          aria-busy={request.loading || undefined}
          onSubmit={form.handleSubmit(({ email }) => {
            const normalized = email.trim().toLowerCase();
            const key =
              attempt.email === normalized ? attempt.key : crypto.randomUUID();
            setAttempt({ email: normalized, key });
            void request.run(
              "password/request-reset",
              { email: normalized, idempotencyKey: key },
              "resetRequest",
              (data) => {
                if (data.accepted === true) {
                  setSent(true);
                  return true;
                }
                return false;
              },
              () =>
                request.setError(
                  "Nie udało się połączyć. Nie wiemy, czy żądanie dotarło. Spróbuj ponownie.",
                ),
              (response) => {
                if (response.status >= 500)
                  request.setError(
                    "Nie wiemy, czy żądanie dotarło. Spróbuj ponownie.",
                  );
              },
            );
          })}
        >
          <p className={styles.intro}>
            Podaj adres e-mail konta. {NEUTRAL}
          </p>
          <FormField
            id="reset-email"
            label="Adres e-mail"
            required
            error={form.formState.errors.email?.message}
          >
            <TextInput
              type="email"
              autoComplete="username"
              inputMode="email"
              disabled={request.loading}
              {...form.register("email")}
            />
          </FormField>
          <ErrorNotice message={request.error} cooldown={request.cooldown} />
          <Button
            type="submit"
            width="fill"
            loading={request.loading}
            loadingLabel="Wysyłanie…"
            disabled={request.cooldown > 0}
          >
            {request.cooldown > 0 ? "Ponów po limicie" : "Wyślij instrukcję"}
          </Button>
          <p className={styles.linkRow}>
            <Link href={where.login}>Wróć do logowania</Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}

const passwordSchema = z
  .object({ password: z.string(), confirmation: z.string() })
  .superRefine((value, context) => {
    if (!evaluatePassword(value.password).valid)
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "Hasło musi mieć od 12 do 256 znaków",
      });
    if (value.confirmation !== value.password)
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "Hasła muszą być identyczne",
      });
  });
type PasswordValues = z.infer<typeof passwordSchema>;

// ADM-03: the token is single-use; the server answers 401 for unknown, expired and used links alike.
export function SetNewPasswordForm({
  area,
  token,
}: AuthProps & { token: string }) {
  const [state, setState] = useState<"form" | "success" | "expired">(
    /^[A-Za-z0-9_-]{43}$/.test(token) ? "form" : "expired",
  );
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const request = useAuthRequest();
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmation: "" },
  });
  const password = useWatch({ control: form.control, name: "password" });
  const strength = evaluatePassword(password ?? "");
  const where = paths(area);
  const previous = useRef(state);
  useEffect(() => {
    if (previous.current !== state) {
      document.getElementById("auth-title")?.focus();
      previous.current = state;
    }
  }, [state]);
  return (
    <AuthFrame
      area={area}
      view="reset"
      title={
        state === "success"
          ? "Hasło zostało zmienione"
          : state === "expired"
            ? "Link nie działa"
            : "Ustaw nowe hasło"
      }
      context={area === "company" ? "Panel administratora" : "Panel Auterva"}
    >
      {state === "success" && (
        <div className={styles.notices}>
          <Alert tone="success" title="Zalogujesz się ponownie.">
            Wszystkie sesje tego konta zostały zakończone. Po haśle potwierdzisz
            logowanie kodem MFA.
          </Alert>
          <Link className={styles.loginLink} href={where.login}>
            Przejdź do logowania
          </Link>
        </div>
      )}
      {state === "expired" && (
        <div className={styles.notices}>
          <Alert tone="error" title="Link jest nieprawidłowy, wygasł lub został już użyty." />
          <Link className={styles.loginLink} href={where.reset}>
            Poproś o nowy link
          </Link>
          <p className={styles.linkRow}>
            <Link href={where.login}>Wróć do logowania</Link>
          </p>
        </div>
      )}
      {state === "form" && (
        <form
          className={styles.form}
          noValidate
          aria-busy={request.loading || undefined}
          onSubmit={form.handleSubmit(({ password: next }) =>
            request.run(
              "password/reset",
              { token, newPassword: next },
              "resetPassword",
              (data) => {
                if (data.status === true) {
                  form.reset();
                  setState("success");
                  return true;
                }
                return false;
              },
              () =>
                request.setError(
                  "Nie udało się połączyć. Nie wiemy, czy hasło zostało zmienione. Spróbuj ponownie albo zaloguj się nowym hasłem.",
                ),
              (response) => {
                if (response.status === 401) {
                  form.reset();
                  setState("expired");
                } else if (response.status >= 500) {
                  request.setError(
                    "Nie wiemy, czy hasło zostało zmienione. Spróbuj ponownie albo zaloguj się nowym hasłem.",
                  );
                }
              },
            ),
          )}
        >
          <p className={styles.intro}>
            Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń. Potem
            zalogujesz się nowym hasłem i kodem MFA.
          </p>
          <PasswordInput
            id="reset-password"
            label="Nowe hasło"
            autoComplete="new-password"
            hint="12–256 znaków"
            visibility={visibility}
            onVisibilityChange={setVisibility}
            disabled={request.loading}
            aria-describedby="reset-strength"
            error={form.formState.errors.password?.message}
            {...form.register("password")}
          />
          <PasswordStrength
            id="reset-strength"
            level={strength.level}
            criteria={strength.criteria}
          />
          <PasswordInput
            id="reset-confirmation"
            label="Potwierdź nowe hasło"
            autoComplete="new-password"
            visibility={visibility}
            onVisibilityChange={setVisibility}
            disabled={request.loading}
            error={form.formState.errors.confirmation?.message}
            {...form.register("confirmation")}
          />
          <ErrorNotice
            message={state === "form" ? request.error : ""}
            cooldown={request.cooldown}
          />
          <Button
            type="submit"
            width="fill"
            loading={request.loading}
            loadingLabel="Zapisywanie…"
            disabled={request.cooldown > 0}
          >
            {request.cooldown > 0 ? "Ponów po limicie" : "Zapisz nowe hasło"}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
