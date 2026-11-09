"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  postAuth,
  useAuthRequest,
  ErrorNotice,
} from "../auth/auth-flow";
import type { AuthArea } from "../auth/auth-destination";
import { evaluatePassword } from "../auth/password-policy";
import { PasswordStrength } from "../auth/password-strength";
import { useRefocus } from "../auth/use-refocus";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { PasswordInput } from "../ui/password-input";
import { TextInput } from "../ui/text-input";
import styles from "./account.module.css";

export type AccountData = { name: string; email: string; role: string };

const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Podaj nazwę")
    .max(100, "Nazwa może mieć najwyżej 100 znaków"),
});
const passwordSchema = z
  .object({
    current: z.string().min(1, "Podaj aktualne hasło").max(256),
    next: z.string(),
    confirmation: z.string(),
  })
  .superRefine((value, context) => {
    if (!evaluatePassword(value.next).valid)
      context.addIssue({
        code: "custom",
        path: ["next"],
        message: "Hasło musi mieć od 12 do 256 znaków",
      });
    if (value.confirmation !== value.next)
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "Hasła muszą być identyczne",
      });
  });

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN_AUTERVA: "Superadmin",
  ADMIN_FIRMY: "Administrator firmy",
};

function paths(area: AuthArea) {
  return area === "company"
    ? { login: "/admin/login", mfa: "/admin/mfa", account: "/admin/konto", home: "/admin" }
    : { login: "/login", mfa: "/mfa", account: "/konto", home: "/" };
}

/** The server decides: wrong password and a revoked session both answer 401, so ask the session. */
export async function sessionAlive(): Promise<boolean | "unknown"> {
  try {
    const response = await fetch("/api/auth/get-session/", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401) return false;
    if (!response.ok) return "unknown";
    const body = await response.json().catch(() => null);
    return body !== null && typeof body === "object";
  } catch {
    return "unknown";
  }
}

export function AccountView({
  area,
  account,
}: {
  area: AuthArea;
  account: AccountData;
}) {
  const where = paths(area);
  const [savedName, setSavedName] = useState(account.name);
  const [nameSaved, setNameSaved] = useState(false);
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const [manualOpen, setManualOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const profile = useAuthRequest();
  const change = useAuthRequest();
  const nameForm = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: account.name },
  });
  const passwordForm = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", next: "", confirmation: "" },
  });
  const next = useWatch({ control: passwordForm.control, name: "next" });
  const strength = evaluatePassword(next ?? "");

  useRefocus(profile.settled, () => "account-name");
  useRefocus(change.settled, () => "account-current");

  const toLogin = (query: string) => {
    setSignedOut(true);
    window.location.replace(query ? `${where.login}?${query}` : where.login);
  };
  useEffect(() => {
    // Back after logout must not restore a private page from the back/forward cache.
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // The outcome is unknown; a revoked session proves the change was committed.
  const uncertain = async () => {
    const alive = await sessionAlive();
    if (alive === false) toLogin("password=changed");
    else
      change.setError(
        alive === true
          ? "Nie udało się potwierdzić zmiany. Sesja nadal działa, więc hasło prawdopodobnie nie zostało zmienione. Spróbuj ponownie."
          : "Nie wiemy, czy hasło zostało zmienione. Odśwież stronę, aby to sprawdzić.",
      );
  };

  if (signedOut)
    return (
      <main className={styles.page}>
        <p role="status">Przekierowanie do logowania…</p>
      </main>
    );

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      const result = await postAuth("sign-out", {});
      // Only the server's confirmation ends the session on this screen.
      if (result.response.ok && result.data.success !== false) toLogin("");
      else
        setLogoutError(
          "Nie udało się wylogować. Sesja nadal jest aktywna. Spróbuj ponownie.",
        );
    } catch {
      setLogoutError(
        "Nie udało się połączyć. Sesja nadal może być aktywna. Spróbuj ponownie.",
      );
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <main className={styles.page} data-area={area}>
      <header className={styles.header}>
        <p className={styles.brand}>{area === "platform" ? "A AUTERVA" : "AUTERVA"}</p>
        <nav aria-label="Konto" className={styles.nav}>
          <Link href={where.home}>
            {area === "platform" ? "Platforma" : "Panel"}
          </Link>
          <Button
            variant="secondary"
            size="sm"
            loading={loggingOut}
            loadingLabel="Wylogowywanie…"
            onClick={logout}
          >
            Wyloguj
          </Button>
        </nav>
      </header>
      <h1 id="account-title" className={styles.title}>
        Konto
      </h1>
      {logoutError && (
        <div className={styles.notice}>
          <Alert tone="error" title={logoutError} />
        </div>
      )}

      <section className={styles.card} aria-labelledby="account-data">
        <h2 id="account-data">Dane konta</h2>
        <form
          className={styles.form}
          noValidate
          aria-busy={profile.loading || undefined}
          onSubmit={nameForm.handleSubmit(({ name }) => {
            setNameSaved(false);
            return profile.run(
              "profile",
              { name },
              "profile",
              (data) => {
                if (typeof data.name !== "string") return false;
                setSavedName(data.name);
                nameForm.reset({ name: data.name });
                setNameSaved(true);
                return true;
              },
              undefined,
              async (response) => {
                if (response.status === 401 && (await sessionAlive()) === false)
                  toLogin("session=expired");
              },
            );
          })}
        >
          <FormField
            id="account-name"
            label="Nazwa"
            required
            hint="1–100 znaków"
            error={nameForm.formState.errors.name?.message}
          >
            <TextInput
              autoComplete="name"
              disabled={profile.loading}
              {...nameForm.register("name", {
                onChange: () => setNameSaved(false),
              })}
            />
          </FormField>
          <dl className={styles.readOnly}>
            <div>
              <dt>Adres e-mail</dt>
              <dd>{account.email}</dd>
            </div>
            <div>
              <dt>Rola</dt>
              <dd>{ROLE_LABEL[account.role] ?? account.role}</dd>
            </div>
          </dl>
          <ErrorNotice message={profile.error} cooldown={profile.cooldown} />
          {nameSaved && (
            <Alert tone="success" title={`Zapisano nazwę: ${savedName}`} />
          )}
          <Button
            type="submit"
            loading={profile.loading}
            loadingLabel="Zapisywanie…"
            disabled={profile.cooldown > 0}
          >
            Zapisz nazwę
          </Button>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="account-password">
        <h2 id="account-password">Zmień hasło</h2>
        <form
          className={styles.form}
          noValidate
          aria-busy={change.loading || undefined}
          onSubmit={passwordForm.handleSubmit(({ current, next: value }) =>
            change.run(
              "password/change",
              { currentPassword: current, newPassword: value },
              "changePassword",
              (data) => {
                if (data.status !== true) return false;
                passwordForm.reset();
                toLogin("password=changed");
                return true;
              },
              uncertain,
              async (response) => {
                // 5xx never gets here: request.run sends it to `uncertain`, which asks get-session.
                if (response.status !== 401) return;
                if ((await sessionAlive()) === false) toLogin("session=expired");
                else {
                  // A live session with a 401 means the current password was refused: a field error, not a banner.
                  change.setError("");
                  passwordForm.setError("current", {
                    type: "server",
                    message: "Aktualne hasło jest nieprawidłowe.",
                  });
                }
              },
            ),
          )}
        >
          <p className={styles.warning}>
            Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń. Zalogujesz
            się nowym hasłem i kodem MFA.
          </p>
          <PasswordInput
            id="account-current"
            label="Aktualne hasło"
            autoComplete="current-password"
            visibility={visibility}
            onVisibilityChange={setVisibility}
            disabled={change.loading}
            error={passwordForm.formState.errors.current?.message}
            {...passwordForm.register("current")}
          />
          <PasswordInput
            id="account-new"
            label="Nowe hasło"
            autoComplete="new-password"
            hint="12–256 znaków"
            visibility={visibility}
            onVisibilityChange={setVisibility}
            disabled={change.loading}
            aria-describedby="account-strength"
            error={passwordForm.formState.errors.next?.message}
            {...passwordForm.register("next")}
          />
          <PasswordStrength
            id="account-strength"
            level={strength.level}
            criteria={strength.criteria}
          />
          <PasswordInput
            id="account-confirmation"
            label="Potwierdź nowe hasło"
            autoComplete="new-password"
            visibility={visibility}
            onVisibilityChange={setVisibility}
            disabled={change.loading}
            error={passwordForm.formState.errors.confirmation?.message}
            {...passwordForm.register("confirmation")}
          />
          <ErrorNotice message={change.error} cooldown={change.cooldown} />
          <Button
            type="submit"
            loading={change.loading}
            loadingLabel="Zmienianie hasła…"
            disabled={change.cooldown > 0}
          >
            Zmień hasło
          </Button>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="account-sessions">
        <h2 id="account-sessions">Sesje</h2>
        <p>Zobacz, gdzie konto jest zalogowane, i zakończ wybraną sesję albo wszystkie pozostałe.</p>
        <Link className={styles.linkButton} href={`${where.account}/sesje/`} prefetch={false}>
          Aktywne sesje
        </Link>
      </section>

      <section className={styles.card} aria-labelledby="account-mfa">
        <h2 id="account-mfa">MFA</h2>
        <p className={styles.pill}>
          <CircleCheck aria-hidden="true" size={16} />
          <span>Włączone</span>
        </p>
        <p>
          MFA jest obowiązkowe i nie można go wyłączyć. Kody odzyskania są
          jednorazowe, a poprzedniej listy nie da się odczytać ponownie. Nowa
          lista wymaga świeżego kodu z aplikacji lub kodu odzyskania oraz
          hasła.
        </p>
        <div className={styles.actions}>
          <Link
            className={styles.linkButton}
            href={`${where.mfa}?returnTo=${encodeURIComponent(where.account)}&recoverCodes=1`}
          >
            Wydaj nowe kody
          </Link>
          <Button
            variant="secondary"
            aria-expanded={manualOpen}
            aria-controls="account-manual"
            onClick={() => setManualOpen((open) => !open)}
          >
            Nie mam obu czynników
          </Button>
        </div>
        {manualOpen && (
          <div id="account-manual" className={styles.notice}>
            <Alert tone="info" title="Odzyskanie wymaga ręcznej procedury właściciela.">
              Bez aplikacji i kodów odzyskania nie ma samodzielnego obejścia.
              Właściciel potwierdza tożsamość poza aplikacją, a dostęp
              przywraca po zapisaniu osoby i podstawy w audycie.
            </Alert>
          </div>
        )}
      </section>
    </main>
  );
}
