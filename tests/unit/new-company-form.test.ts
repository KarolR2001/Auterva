import { describe, expect, it } from "vitest";

import {
  classifyCreateResponse, emptyCompanyForm, newIdempotencyKey, formFingerprint, slugFromName, toCreateBody, validateCompanyForm,
} from "../../src/modules/organizations/new-company-form";
import { canIssueInvitation, canRevokeInvitation, invitationView } from "../../src/modules/invitations/view-state";

const now = new Date("2026-11-08T12:00:00Z");
const inv = (over: object) => ({ id: "i", recipientEmail: "a@b.pl", issuedHost: "h", issuedAt: "2026-11-08T10:00:00Z",
  expiresAt: "2026-11-15T10:00:00Z", usedAt: null, revokedAt: null, deliveryStatus: "SENT", ...over });

describe("formularz nowej firmy (#25)", () => {
  it("slug z nazwy usuwa polskie znaki i nie zaczyna ani nie kończy się myślnikiem", () => {
    expect(slugFromName("  Wypożyczalnia Łódź & Spółka! ")).toBe("wypozyczalnia-lodz-spolka");
  });
  it("waliduje pola i zarezerwowane slugi", () => {
    expect(Object.keys(validateCompanyForm(emptyCompanyForm)).sort()).toEqual(["adminEmail", "name", "periodKind", "slug"]);
    const ok = { ...emptyCompanyForm, name: "A", adminEmail: "A@B.PL", slug: "alfa", periodKind: "trial" as const };
    expect(validateCompanyForm(ok)).toEqual({});
    expect(validateCompanyForm({ ...ok, slug: "admin" }).slug).toMatch(/zarezerwowany/);
    expect(validateCompanyForm({ ...ok, periodKind: "paid", paidThrough: "2026-02-30" }).paidThrough).toBeDefined();
    expect(toCreateBody(ok, "k")).toMatchObject({ adminEmail: "a@b.pl", trialGranted: true, paidThrough: null });
  });
  it("odcisk zmienia się tylko przy zmianie danych (ten sam klucz idempotencji przy ponowieniu)", () => {
    const a = { ...emptyCompanyForm, name: "A", slug: "alfa", adminEmail: "a@b.pl", periodKind: "trial" as const };
    expect(formFingerprint(a)).toBe(formFingerprint({ ...a, name: " A " }));
    expect(formFingerprint(a)).not.toBe(formFingerprint({ ...a, slug: "beta" }));
  });
  it("klasyfikuje odpowiedzi: tylko 5xx jest niepewne", () => {
    expect(classifyCreateResponse(200, { organizationId: "o" }, null)).toEqual({ kind: "saved", organizationId: "o" });
    expect(classifyCreateResponse(409, { code: "COMPANY_CONFLICT" }, null).kind).toBe("conflict");
    expect(classifyCreateResponse(429, {}, "30")).toEqual({ kind: "rate-limited", retryAfter: 30 });
    expect(classifyCreateResponse(500, null, null).kind).toBe("uncertain");
    expect(classifyCreateResponse(502, null, null).kind).toBe("uncertain");
    expect(classifyCreateResponse(503, { code: "HOST_DOMAINS_NOT_CONFIGURED" }, null).kind).toBe("rejected");
    expect(classifyCreateResponse(503, { code: "INGRESS_NOT_CONFIGURED" }, null).kind).toBe("rejected");
    expect(classifyCreateResponse(503, {}, null).kind).toBe("uncertain");
    expect(classifyCreateResponse(503, null, null).kind).toBe("uncertain");
    expect(classifyCreateResponse(503, { code: "OTHER" }, null).kind).toBe("uncertain");
  });
  it("widok zaproszenia: UNCERTAIN blokuje nowe wydanie do cofnięcia", () => {
    const uncertain = invitationView(inv({ deliveryStatus: "UNCERTAIN" }), now);
    expect(uncertain.kind).toBe("uncertain");
    expect(canIssueInvitation(uncertain, false, false)).toBe(false);
    expect(canRevokeInvitation(uncertain, false)).toBe(true);
    expect(invitationView(inv({ revokedAt: "2026-11-08T11:00:00Z" }), now).kind).toBe("revoked");
    expect(invitationView(inv({ deliveryStatus: "FAILED" }), now).kind).toBe("failed");
    expect(canIssueInvitation({ kind: "failed" }, false, false)).toBe(true);
    expect(canIssueInvitation({ kind: "sent" }, true, false)).toBe(false);
    expect(invitationView(null, now).kind).toBe("none");
  });
  it("klucz idempotencji działa także bez crypto.randomUUID (kontekst niezabezpieczony)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
