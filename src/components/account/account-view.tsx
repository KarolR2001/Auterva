"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, UserRound } from "lucide-react";
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
import { SecretForm } from "../ui/secret-form";
import { PasswordInput } from "../ui/password-input";
import { PageHeader } from "../ui/page-header";
import { TextInput } from "../ui/text-input";
import { AccountTabs } from "./account-tabs";
import { formatWhen } from "./sessions-model";
import styles from "./account.module.css";

export type AccountData = { name: string; email: string; role: string };
/** Own sessions as read on the server: the count for the tab and the current device for the profile card. */
export type SessionsSummary = { count: number; current: { device: string | null; createdAt: string } | null };

/** Up to two initials from the account name; none when the name has no letters (the avatar then shows an icon). */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((word) => word.match(/\p{L}/u)?.[0] ?? "").filter(Boolean).slice(0, 2).join("")
    .toLocaleUpperCase("pl-PL");
}

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
  sessions = null,
}: {
  area: AuthArea;
  account: AccountData;
  sessions?: SessionsSummary | null;
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
      <div className={styles.account}>
        <p role="status">Przekierowanie do logowania…</p>
      </div>
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

  const initials = initialsOf(savedName);
  return (
    <div className={styles.account} data-area={area}>
      <PageHeader
        trail="Konto / Profil i bezpieczeństwo"
        title="Konto"
        description={area === "platform"
          ? "Własne dane, hasło i obowiązkowe MFA platformy."
          : "Profil administratora, hasło, MFA i aktywne sesje."}
      />
      {area === "company" && <AccountTabs current="profile" sessionCount={sessions?.count ?? null} />}
      {logoutError && (
        <div className={styles.notice}>
          <Alert tone="error" title={logoutError} />
        </div>
      )}

      <div className={styles.columns}>
      <section className={`${styles.card} ${styles.profileCard}`} aria-labelledby="account-data">
        <div className={styles.profileHead}>
          <span className={styles.avatar} aria-hidden="true">
            {initials || <UserRound size={32} />}
          </span>
          <div className={styles.profileText}>
            <h2 id="account-data" className={styles.profileName}>{savedName}</h2>
            <p className={styles.profileEmail}>{account.email}</p>
          </div>
        </div>
        <p className={styles.profileRole}>
          Rola: <span>{ROLE_LABEL[account.role] ?? account.role}</span>
        </p>
        <SecretForm
          className={styles.form}
          aria-label="Nazwa konta"
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
          <ErrorNotice message={profile.error} cooldown={profile.cooldown} />
          {nameSaved && (
            <Alert tone="success" title={`Zapisano nazwę: ${savedName}`} />
          )}
          <Button
            type="submit"
            variant="secondary"
            loading={profile.loading}
            loadingLabel="Zapisywanie…"
            disabled={profile.cooldown > 0}
          >
            Zapisz nazwę
          </Button>
        </SecretForm>
        {sessions?.current && (
          <div className={styles.currentSession}>
            <p className={styles.eyebrow}>Bieżąca sesja</p>
            <p>{sessions.current.device ?? "Nieznane urządzenie"} • aktywna teraz</p>
            <p className={styles.sessionMeta}>Utworzono {formatWhen(sessions.current.createdAt)}</p>
          </div>
        )}
        <Button
          variant="secondary"
          className={styles.logout}
          loading={loggingOut}
          loadingLabel="Wylogowywanie…"
          onClick={logout}
        >
          Wyloguj się
        </Button>
      </section>

      <section className={`${styles.card} ${styles.securityCard}`} aria-labelledby="account-password">
        <div className={styles.cardHead}>
          <h2 id="account-password" className={styles.cardTitle}>Zmiana hasła</h2>
          <p className={styles.cardDescription}>
            Wymagamy aktualnego hasła. Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń. Zalogujesz się nowym
            hasłem i kodem MFA.
          </p>
        </div>
        <SecretForm
          className={styles.form}
          aria-labelledby="account-password"
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
              undefined,
              async (response) => {
                // 5xx never gets here: request.run sends it to `uncertain`, which asks get-session.
                if (response.status !== 401) return false;
                if ((await sessionAlive()) === false) toLogin("session=expired");
                else {
                  // A live session with a 401 means the current password was refused: one field error, never a banner.
                  passwordForm.setError("current", {
                    type: "server",
                    message: "Aktualne hasło jest nieprawidłowe.",
                  });
                }
                return true;
              },
            ),
          )}
        >
          <div className={styles.passwordGrid}>
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
            <div className={styles.criteria}>
              <PasswordStrength
                id="account-strength"
                level={strength.level} tooShort={strength.tooShort}
                criteria={strength.criteria}
              />
            </div>
          </div>
          <ErrorNotice message={change.error} cooldown={change.cooldown} />
          <Button
            type="submit"
            className={styles.submit}
            loading={change.loading}
            loadingLabel="Zmienianie hasła…"
            disabled={change.cooldown > 0}
          >
            Zmień hasło
          </Button>
        </SecretForm>

        <section className={styles.mfaCard} aria-labelledby="account-mfa">
          <div className={styles.mfaHead}>
            <h3 id="account-mfa" className={styles.mfaTitle}>Uwierzytelnianie dwuskładnikowe</h3>
            <p className={styles.pill}>
              <CircleCheck aria-hidden="true" size={16} />
              <span>Włączone</span>
            </p>
          </div>
          <p className={styles.mfaText}>
            MFA jest obowiązkowe i nie można go wyłączyć. Kody odzyskania są
            jednorazowe, a poprzedniej listy nie da się odczytać ponownie. Nowa
            lista wymaga świeżego kodu z aplikacji lub kodu odzyskania oraz
            hasła.
          </p>
          <div className={styles.actions}>
            <Link
              className={styles.secondaryLink}
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
        {area === "platform" && (
          <Link className={styles.secondaryLink} href={`${where.account}/sesje/`} prefetch={false}>
            Aktywne sesje
          </Link>
        )}
      </section>
      </div>
    </div>
  );
}
