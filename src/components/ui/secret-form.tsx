import type { FormHTMLAttributes } from "react";

type SecretFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "method" | "action" | "encType" | "target" | "noValidate">;

/**
 * Jedyny dozwolony formularz z sekretem (hasło, kod MFA/odzyskania).
 * Natywna wysyłka (Enter przed hydratacją, brak JS) domyślnie używa GET i
 * umieszczałaby wartości pól w adresie URL, historii, logach i `Referer`.
 * `method="post"` bez `action` wysyła treść w body; React po hydratacji
 * przechwytuje `onSubmit`, więc zachowanie z JS się nie zmienia.
 */
export function SecretForm(props: SecretFormProps) {
  return <form {...props} action={undefined} method="post" noValidate />;
}
