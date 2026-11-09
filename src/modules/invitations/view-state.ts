// Presentation state of the company-admin invitation (#25). Mirrors the #20 delivery contract:
// SENT means accepted by the mail provider, never delivered; UNCERTAIN needs an operator decision.

export type InvitationDto = {
  id: string; recipientEmail: string; issuedHost: string | null; issuedAt: string; expiresAt: string;
  usedAt: string | null; revokedAt: string | null; deliveryStatus: string;
};

export type InvitationView =
  | { kind: "none" }
  | { kind: "revoked" }
  | { kind: "used" }
  | { kind: "expired" }
  | { kind: "pending" }
  | { kind: "sent" }
  | { kind: "failed" }
  | { kind: "uncertain" };

export function invitationView(invitation: InvitationDto | null, now: Date): InvitationView {
  if (!invitation) return { kind: "none" };
  if (invitation.usedAt) return { kind: "used" };
  if (invitation.revokedAt) return { kind: "revoked" };
  if (invitation.deliveryStatus === "UNCERTAIN") return { kind: "uncertain" };
  if (new Date(invitation.expiresAt) <= now) return { kind: "expired" };
  if (invitation.deliveryStatus === "FAILED") return { kind: "failed" };
  if (invitation.deliveryStatus === "SENT") return { kind: "sent" };
  return { kind: "pending" };
}

/** A new link may be issued unless a decision, a live link or a finished registration blocks it. */
export function canIssueInvitation(view: InvitationView, registered: boolean, archived: boolean): boolean {
  if (registered || archived) return false;
  return view.kind !== "uncertain" && view.kind !== "used" && view.kind !== "pending";
}

export function canRevokeInvitation(view: InvitationView, registered: boolean): boolean {
  return !registered && (view.kind === "sent" || view.kind === "pending" || view.kind === "uncertain"
    || view.kind === "failed");
}

export type InvitationFailure = { message: string; refresh: boolean };

export function classifyInvitationError(status: number, code: string | null, retryAfter: string | null): InvitationFailure {
  if (status === 409) {
    if (code === "INVITATION_DELIVERY_UNCERTAIN") return { refresh: true,
      message: "Wynik poprzedniej wysyłki jest niepewny. Najpierw cofnij to zaproszenie, potem wydaj nowe." };
    if (code === "INVITATION_HOST_NOT_READY") return { refresh: true,
      message: "Adres panelu firmy nie jest jeszcze gotowy. Sprawdź hosty i spróbuj ponownie." };
    if (code === "INVITATION_ADMIN_NOT_PENDING" || code === "INVITATION_COMPANY_INACTIVE") return { refresh: true,
      message: "Tej firmie nie można już wystawić zaproszenia: konto jest zarejestrowane albo firma zarchiwizowana." };
    return { refresh: true, message: "Stan zaproszenia się zmienił. Odświeżyliśmy dane — sprawdź je i spróbuj ponownie." };
  }
  if (status === 429) {
    const seconds = Number(retryAfter);
    return { refresh: false, message: Number.isFinite(seconds) && seconds > 0
      ? `Limit wysyłek został osiągnięty. Spróbuj ponownie za ${Math.ceil(seconds / 60)} min.`
      : "Limit wysyłek został osiągnięty. Spróbuj ponownie później." };
  }
  if (status === 503) return { refresh: false,
    message: "Poczta lub domeny nie są skonfigurowane. Skontaktuj się z operatorem." };
  if (status === 403) return { refresh: false,
    message: "Brak uprawnień albo sesja wygasła. Zaloguj się ponownie." };
  if (status === 404) return { refresh: true, message: "Nie znaleziono firmy lub zaproszenia. Odświeżyliśmy dane." };
  return { refresh: false, message: "Nie udało się wykonać operacji. Zaproszenie mogło zostać wydane — sprawdź status po odświeżeniu." };
}
