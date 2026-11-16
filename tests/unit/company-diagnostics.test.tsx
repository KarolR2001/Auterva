// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";
import { CompanyCard, type CompanyCardDto } from "../../src/components/platform/company-card";
import { CompanyDiagnostics } from "../../src/components/platform/company-diagnostics";
import { domainView, mailView, type DiagnosticsDto } from "../../src/components/platform/launch-diagnostics-model";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const id = "11111111-1111-4111-8111-111111111111";
const api = `/api/platform/companies/${id}/launch-diagnostics/`;
type Custom = NonNullable<DiagnosticsDto["domain"]["customDomain"]>;
type Mail = NonNullable<DiagnosticsDto["lastMail"]>;

// The DTO of docs/contracts/launch-diagnostics.md (#77 + #417), with the fields the card reads.
function dto(patch: { domain?: Partial<DiagnosticsDto["domain"]>; custom?: Partial<Custom> | null; lastMail?: Mail | null;
  invitation?: Partial<DiagnosticsDto["invitation"]>; reminders?: DiagnosticsDto["reminders"]["items"] } = {}): DiagnosticsDto {
  const custom: Custom | null = patch.custom === null ? null : {
    hostname: "wynajem.alfa.example", status: "ACTIVE", state: "ACTIVE", category: null, checkedAt: "2026-11-12T07:15:00.000Z",
    tlsNotAfter: "2027-06-01T00:00:00.000Z", tlsExpiry: "OK", retry: { action: "VERIFY_DOMAIN", allowed: true, reason: null }, ...patch.custom };
  return {
    generatedAt: "2026-11-12T07:15:00.000Z", archived: false,
    domain: { severity: "OK", aliasHost: "ACTIVE", adminHost: "ACTIVE", aliasCheckedAt: null, customDomain: custom, ...patch.domain },
    invitation: { severity: "OK", state: "ISSUED", delivery: null, ...patch.invitation },
    lastMail: patch.lastMail ?? null,
    reminders: { severity: "OK", items: patch.reminders ?? [] },
  };
}
const mail = (state: Mail["state"], extra: Partial<Mail> = {}): Mail =>
  ({ type: "INVITATION", at: "2026-11-11T13:02:00.000Z", state, cause: null, ...extra });

describe("model diagnostyki (#78)", () => {
  it.each([
    ["ok", dto(), "ok", "Aktywna"],
    ["brak domeny", dto({ custom: null }), "info", "Brak domeny własnej"],
    ["w toku", dto({ custom: { state: "WAITING", status: "PENDING_OWNERSHIP", category: "OWNERSHIP" } }), "waiting", "Weryfikacja w toku"],
    ["błąd DNS", dto({ custom: { state: "FAILED", status: "PENDING_ROUTING", category: "DNS" } }), "error", "Błąd: DNS domeny"],
    ["konfiguracja", dto({ custom: { state: "FAILED", status: "PENDING_ROUTING", category: "CONFIG" } }), "error", "Błąd: konfiguracja Autervy"],
    ["nieznany błąd", dto({ custom: { state: "FAILED", status: "PENDING_ROUTING", category: null } }), "error", "Błąd: sprawdzenie domeny"],
    ["nie sprawdzano", dto({ custom: { state: "NOT_CHECKED", status: "PENDING_OWNERSHIP", checkedAt: null } }), "info", "Jeszcze nie sprawdzono"],
    ["adres Autervy", dto({ domain: { aliasHost: "PENDING" } }), "error", "Błąd: adres Autervy"],
    ["certyfikat wygasł", dto({ custom: { tlsExpiry: "EXPIRED", tlsNotAfter: "2026-11-01T00:00:00.000Z" } }), "error", "Błąd: certyfikat wygasł"],
  ])("domena: %s", (_name, input, tone, label) => {
    expect(domainView(input)).toMatchObject({ tone, label });
  });

  it("certyfikat: ostrzeżenie i data pochodzą z API (tlsExpiry, tlsNotAfter), bez własnego progu", () => {
    const soon = domainView(dto({ custom: { tlsExpiry: "EXPIRING_SOON", tlsNotAfter: "2026-11-20T10:00:00.000Z" } }));
    expect(soon).toMatchObject({ tone: "warning", label: "Certyfikat wygasa wkrótce" });
    expect(soon.detail).toContain("ważny do 20.11.2026 i odnawia się automatycznie");
    expect(domainView(dto({ custom: { tlsExpiry: "UNKNOWN", tlsNotAfter: null } })).tone).toBe("ok");
  });

  it("błąd domeny w weryfikacji: adres Autervy działa; gotowa domena nie udaje publikacji", () => {
    const pending = domainView(dto({ custom: { state: "FAILED", status: "PENDING_ROUTING", category: "DNS" } }));
    expect(pending.detail).toContain("Adres Autervy działa nadal.");
    expect(pending.detail).toContain("Poproś firmę o poprawienie wpisu DNS");
    const ready = domainView(dto({ custom: { state: "READY", status: "READY" } }));
    expect(ready).toMatchObject({ tone: "waiting", label: "Gotowa do aktywacji" });
    expect(ready.detail).toContain("nie jest jeszcze adresem strony");
  });

  it.each([
    ["DNS", "Błąd: DNS domeny"], ["TLS", "Błąd: certyfikat domeny"], ["ROUTING", "Błąd: kierowanie domeny"], [null, "Błąd: sprawdzenie domeny"],
  ] as const)("D-64: aktywna domena z nieudanym sprawdzeniem (%s) — strona może być niedostępna, bez zapewnienia o adresie Autervy", (category, label) => {
    const live = domainView(dto({ domain: { severity: "ERROR" }, custom: { state: "FAILED", status: "ACTIVE", category } }));
    expect(live).toMatchObject({ tone: "error", label, subject: "wynajem.alfa.example", checkedAt: "2026-11-12T07:15:00.000Z" });
    expect(live.detail).toBe("Domena własna nie odpowiada poprawnie, więc strona firmy może być niedostępna: adres Autervy przekierowuje na tę domenę. Sprawdź z firmą wpisy DNS i certyfikat domeny własnej, a potem użyj „Sprawdź ponownie”.");
    expect(live.detail).not.toContain("działa nadal");
  });

  it("D-64: wygasły certyfikat aktywnej domeny ma ten sam skutek i krok, a brak konfiguracji platformy własny", () => {
    const expired = domainView(dto({ custom: { tlsExpiry: "EXPIRED", tlsNotAfter: "2026-11-01T00:00:00.000Z" } }));
    expect(expired.detail).toMatch(/^Certyfikat domeny stracił ważność\. Domena własna nie odpowiada poprawnie, więc strona firmy może być niedostępna/);
    const config = domainView(dto({ custom: { state: "FAILED", status: "ACTIVE", category: "CONFIG" } }));
    expect(config.detail).toBe("Cel domeny nie jest jeszcze skonfigurowany po stronie Autervy. Uzupełnij konfigurację platformy.");
  });

  it("data: domena własna z checkedAt; bez domeny znacznik odczytu adresu Autervy z etykietą, która nie udaje testu sieci", () => {
    expect(domainView(dto()).checkedAt).toBe("2026-11-12T07:15:00.000Z");
    expect(domainView(dto()).checkedLabel).toBeUndefined();
    expect(domainView(dto({ custom: null })).checkedAt).toBeNull();
    expect(domainView(dto({ custom: null, domain: { aliasCheckedAt: "2026-11-10T09:00:00.000Z" } })))
      .toMatchObject({ checkedAt: "2026-11-10T09:00:00.000Z", checkedLabel: "Adres Autervy aktywny, stan odczytano" });
    expect(domainView(dto({ domain: { adminHost: "MISSING", aliasCheckedAt: "2026-11-10T09:00:00.000Z" } })).checkedAt).toBeNull();
  });

  it("poczta: stany ostatniej wysyłki z lastMail", () => {
    expect(mailView(dto())).toMatchObject({ tone: "info", label: "Brak wysyłek", checkedAt: null });
    expect(mailView(dto({ lastMail: mail("ACCEPTED_BY_PROVIDER") }))).toMatchObject({ tone: "ok", label: "Ostatnia wysyłka przyjęta",
      subject: "Zaproszenie administratora · 11.11.2026, 14:02" });
    expect(mailView(dto({ lastMail: mail("DELIVERED", { type: "REMINDER" }) })).subject).toBe("Przypomnienie o końcu okresu · 11.11.2026, 14:02");
    expect(mailView(dto({ lastMail: mail("QUEUED") }))).toMatchObject({ tone: "waiting", label: "Wysyłka w kolejce",
      subject: "Zaproszenie administratora · od 11.11.2026, 14:02" });
    expect(mailView(dto({ lastMail: mail("UNCERTAIN", { cause: "OUTCOME_UNKNOWN" }) }))).toMatchObject({ tone: "uncertain", label: "Nie wiadomo, czy wysłano" });
    expect(mailView(dto({ lastMail: mail("UNCERTAIN") })).detail).toContain("cofnij bieżące w sekcji „Zaproszenie administratora”");
  });

  it("poczta: ponawianie pokazuje próbę i termin z wiersza dostarczenia (zaproszenie z limitem, przypomnienie bez)", () => {
    const invitation = mailView(dto({ lastMail: mail("RETRYING", { cause: "PROVIDER_TEMPORARY" }),
      invitation: { delivery: { state: "RETRYING", attempts: 2, maxAttempts: 5, nextAttemptAt: "2026-11-12T08:00:00.000Z" } } }));
    expect(invitation).toMatchObject({ tone: "warning", label: "Ponawianie wysyłki", subject: "Zaproszenie administratora · próba 2 z 5" });
    expect(invitation.detail).toContain("Kolejna próba automatycznie: 12.11.2026, 09:00.");
    const reminder = mailView(dto({ lastMail: mail("RETRYING", { type: "REMINDER" }),
      reminders: [{ state: "DELIVERED", attempts: 1, nextAttemptAt: null }, { state: "RETRYING", attempts: 3, nextAttemptAt: null }] }));
    expect(reminder.subject).toBe("Przypomnienie o końcu okresu · próba 3");
    expect(reminder.detail).toContain("Kolejna próba nastąpi automatycznie.");
  });

  it("poczta: błąd ma ogólną przyczynę i kolejny krok; zarejestrowany administrator nie dostaje rady o nowym zaproszeniu", () => {
    const rejected = mailView(dto({ lastMail: mail("FAILED", { cause: "PROVIDER_REJECTED" }) }));
    expect(rejected).toMatchObject({ tone: "error", label: "Błąd: wysyłka nieudana" });
    expect(rejected.detail).toBe("Serwer poczty odrzucił wiadomość. Sprawdź adres e-mail administratora i wydaj nowe zaproszenie w sekcji „Zaproszenie administratora”.");
    expect(mailView(dto({ lastMail: mail("FAILED", { cause: "PLATFORM_CONFIG" }) })).detail).toContain("po stronie Autervy");
    expect(mailView(dto({ lastMail: mail("SKIPPED", { cause: "OTHER" }) })).detail).toContain("Wiadomość nie została wysłana.");
    const registered = mailView(dto({ lastMail: mail("FAILED", { cause: "PROVIDER_REJECTED" }), invitation: { state: "NOT_APPLICABLE" } }));
    expect(registered.detail).not.toContain("wydaj nowe zaproszenie");
  });

  it("D-63: wysyłka innego rodzaju niż zaproszenie i przypomnienie nie jest opisywana", () => {
    const foreign = dto({ lastMail: { ...mail("ACCEPTED_BY_PROVIDER"), type: "PASSWORD_RESET" as Mail["type"] } });
    expect(mailView(foreign)).toMatchObject({ label: "Brak wysyłek", subject: null });
  });
});

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(responder: Responder) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return responder(String(input), init);
  });
  return calls;
}
const isPost = (init?: RequestInit) => init?.method === "POST";
const block = (title: string) => within(screen.getByRole("region", { name: title }));
const retry = (title: string) => block(title).getByRole("button", { name: "Sprawdź ponownie" });
const failedDns = dto({ custom: { state: "FAILED", status: "PENDING_ROUTING", category: "DNS" } });

describe("karta Diagnostyka (#78)", () => {
  it("pokazuje bloki Domena i Poczta ze statusem tekstowym i datą sprawdzenia, bez danych technicznych", async () => {
    const calls = mockApi(() => Response.json({ ...dto({ lastMail: mail("ACCEPTED_BY_PROVIDER") }),
      // Fields the API also returns; none of them may reach the screen.
      invitation: { severity: "OK", state: "ISSUED", delivery: { state: "ACCEPTED_BY_PROVIDER", errorCode: "MAIL_PERMANENT", attempts: 1, maxAttempts: 5, nextAttemptAt: null } } }));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    expect(await block("Domena").findByText("Aktywna")).toBeInTheDocument();
    expect(block("Domena").getByText("wynajem.alfa.example")).toBeInTheDocument();
    expect(block("Domena").getByText("Ostatnie sprawdzenie: 12.11.2026, 08:15")).toBeInTheDocument();
    expect(block("Poczta").getByText("Ostatnia wysyłka przyjęta")).toBeInTheDocument();
    expect(block("Poczta").getByText(/Nie potwierdza to odczytu/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sprawdź ponownie" })).toHaveLength(2);
    expect(calls).toEqual([{ url: api, method: "GET", body: null }]);
    expect(document.body.textContent).not.toMatch(/MAIL_|DELIVERY_|CNAME|TXT=|reset/i);
  });

  it("brak danych: brak domeny i brak wysyłek bez daty sprawdzenia", async () => {
    mockApi(() => Response.json(dto({ custom: null })));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    expect(await block("Domena").findByText("Brak domeny własnej")).toBeInTheDocument();
    expect(block("Poczta").getByText("Brak wysyłek")).toBeInTheDocument();
    expect(screen.queryByText(/Ostatnie sprawdzenie/)).toBeNull();
  });

  it("D-64: aktywna domena z nieudanym sprawdzeniem ma status błędu z ikoną, prawdziwy komunikat i działające Sprawdź ponownie", async () => {
    mockApi(() => Response.json(dto({ domain: { severity: "ERROR" }, custom: { state: "FAILED", status: "ACTIVE", category: "TLS" } })));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    const badge = (await block("Domena").findByText("Błąd: certyfikat domeny")).closest("p");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(badge?.className).toContain("diag_error");
    expect(block("Domena").getByText(/strona firmy może być niedostępna: adres Autervy przekierowuje na tę domenę/)).toBeInTheDocument();
    expect(block("Domena").getByText(/Sprawdź z firmą wpisy DNS i certyfikat domeny własnej, a potem użyj „Sprawdź ponownie”/)).toBeInTheDocument();
    expect(block("Domena").queryByText(/Adres Autervy działa nadal/)).toBeNull();
    expect(retry("Domena")).toBeEnabled();
  });

  it("archiwum: stan Nie dotyczy bez przycisków i bez zapytań", () => {
    const calls = mockApi(() => Response.json({}));
    render(<CompanyDiagnostics organizationId={id} archived />);
    expect(screen.getByText("Nie dotyczy — firma zarchiwizowana")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("Sprawdź ponownie w domenie: akcja recheck, stan w toku z komunikatem live, wynik z odpowiedzi akcji i fokus na przycisku", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const calls = mockApi(async (_url, init) => {
      if (!isPost(init)) return Response.json(failedDns);
      await new Promise<void>((resolve) => { release = resolve; });
      return Response.json(dto({ custom: { checkedAt: "2026-11-12T09:30:00.000Z" } }));
    });
    const onDomainChecked = vi.fn();
    render(<CompanyDiagnostics organizationId={id} archived={false} onDomainChecked={onDomainChecked} />);
    await block("Domena").findByText("Błąd: DNS domeny");
    retry("Domena").focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(block("Domena").getByText("Weryfikacja w toku")).toBeInTheDocument());
    expect(block("Domena").getByRole("status")).toHaveTextContent("Sprawdzanie teraz… Wynik pojawi się tutaj.");
    expect(block("Domena").getByRole("button", { name: "Sprawdzanie…" })).toBeDisabled();
    expect(retry("Poczta")).toBeDisabled();
    expect(block("Domena").getByText("Poprzednie sprawdzenie: 12.11.2026, 08:15")).toBeInTheDocument();
    expect(block("Domena").queryByText("Aktywna")).toBeNull();
    release();
    await block("Domena").findByText("Aktywna");
    expect(block("Domena").getByText("Ostatnie sprawdzenie: 12.11.2026, 10:30")).toBeInTheDocument();
    expect(block("Domena").getByRole("status")).toHaveTextContent("Sprawdzanie zakończone.");
    const post = calls.find((call) => call.method === "POST");
    expect(post).toMatchObject({ url: `${api}recheck/` });
    expect(Object.keys(post?.body as object)).toEqual(["eventKey"]);
    expect((post?.body as { eventKey: string }).eventKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
    await waitFor(() => expect(retry("Domena")).toHaveFocus());
    expect(onDomainChecked).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["5xx", () => new Response("boom", { status: 503 })],
    ["brak odpowiedzi", () => Promise.reject(new TypeError("network"))],
    ["nieczytelna odpowiedź 200", () => Response.json({ ok: true })],
  ])("%s po akcji: Wynik niepewny z ostatnim potwierdzonym wynikiem, bez fałszywego sukcesu ani błędu", async (_name, answer) => {
    const user = userEvent.setup();
    mockApi((_url, init) => isPost(init) ? answer() : Response.json(dto()));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Aktywna");
    await user.click(retry("Domena"));
    expect(await block("Domena").findByText("Wynik niepewny")).toBeInTheDocument();
    expect(block("Domena").getByText(/nie wiemy, czy sprawdzenie się wykonało/)).toBeInTheDocument();
    expect(block("Domena").getByText("Ostatni potwierdzony wynik: Aktywna, 12.11.2026, 08:15")).toBeInTheDocument();
    expect(block("Domena").queryByText(/^Aktywna$/)).toBeNull();
    expect(block("Domena").queryByText(/^Błąd/)).toBeNull();
    expect(block("Poczta").queryByText("Wynik niepewny")).toBeNull();
    await waitFor(() => expect(retry("Domena")).toHaveFocus());
  });

  it("429: limit z czasem oczekiwania, wynik bez zmian i bez niepewności", async () => {
    const user = userEvent.setup();
    mockApi((_url, init) => isPost(init)
      ? Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "1500" } }) : Response.json(dto()));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Aktywna");
    await user.click(retry("Domena"));
    expect(await block("Domena").findByText(/Limit sprawdzeń został wyczerpany, więc sprawdzenie się nie wykonało. Spróbuj ponownie za 25 min\./)).toBeInTheDocument();
    expect(block("Domena").getByText("Aktywna")).toBeInTheDocument();
    expect(block("Domena").queryByText("Wynik niepewny")).toBeNull();
  });

  it("409: konflikt stanu domeny pokazuje komunikat i świeżo odczytany stan", async () => {
    const user = userEvent.setup();
    let reads = 0;
    mockApi((_url, init) => {
      if (isPost(init)) return Response.json({ code: "DOMAIN_VERSION_CONFLICT" }, { status: 409 });
      reads += 1;
      return Response.json(reads === 1 ? failedDns : dto());
    });
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Błąd: DNS domeny");
    await user.click(retry("Domena"));
    expect(await block("Domena").findByText(/Stan domeny zmienił się w trakcie sprawdzania/)).toBeInTheDocument();
    expect(block("Domena").getByText("Aktywna")).toBeInTheDocument();
  });

  it("brak sieci: komunikat bez wysłania żądania i bez zmiany wyniku", async () => {
    const user = userEvent.setup();
    const calls = mockApi(() => Response.json(dto()));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Aktywna");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await user.click(retry("Domena"));
    expect(block("Domena").getByRole("status")).toHaveTextContent("Brak połączenia z siecią. Sprawdzenie nie zostało wysłane.");
    expect(block("Domena").getByText("Aktywna")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("Poczta nie ma aktywnego sprawdzenia: ponowny odczyt GET, bez POST", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const calls = mockApi(() => { reads += 1; return Response.json(reads === 1 ? dto() : dto({ lastMail: mail("FAILED", { cause: "PROVIDER_REJECTED" }) })); });
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Poczta").findByText("Brak wysyłek");
    await user.click(retry("Poczta"));
    expect(await block("Poczta").findByText("Błąd: wysyłka nieudana")).toBeInTheDocument();
    expect(block("Poczta").getByRole("status")).toHaveTextContent("Sprawdzanie zakończone.");
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
  });

  it("błąd pierwszego odczytu: oba bloki niepewne bez zgadywania; udany odczyt przywraca oba", async () => {
    const user = userEvent.setup();
    let reads = 0;
    mockApi(() => { reads += 1; return reads === 1 ? new Response("x", { status: 500 }) : Response.json(dto()); });
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    expect(await block("Domena").findByText("Wynik niepewny")).toBeInTheDocument();
    expect(block("Domena").getByText("Brak potwierdzonego wyniku.")).toBeInTheDocument();
    expect(block("Poczta").getByText("Wynik niepewny")).toBeInTheDocument();
    await user.click(retry("Poczta"));
    expect(await block("Domena").findByText("Aktywna")).toBeInTheDocument();
    expect(screen.queryByText("Wynik niepewny")).toBeNull();
  });

  it("brak konfiguracji platformy blokuje sprawdzenie domeny z wyjaśnieniem kolejnego kroku", async () => {
    mockApi(() => Response.json(dto({ custom: { state: "FAILED", status: "PENDING_ROUTING", category: "CONFIG",
      retry: { action: "VERIFY_DOMAIN", allowed: false, reason: "PLATFORM_CONFIG_REQUIRED" } } })));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Błąd: konfiguracja Autervy");
    expect(retry("Domena")).toBeDisabled();
    expect(block("Domena").getByText(/nie wykona się bez konfiguracji platformy/)).toBeInTheDocument();
    expect(retry("Poczta")).toBeEnabled();
  });

  it("zmiana w innej sekcji karty (reloadKey) odczytuje diagnostykę ponownie", async () => {
    let reads = 0;
    mockApi(() => { reads += 1; return Response.json(reads === 1 ? failedDns : dto()); });
    const view = render(<CompanyDiagnostics organizationId={id} archived={false} reloadKey="0" />);
    await block("Domena").findByText("Błąd: DNS domeny");
    view.rerender(<CompanyDiagnostics organizationId={id} archived={false} reloadKey="1" />);
    expect(await block("Domena").findByText("Aktywna")).toBeInTheDocument();
  });
});

describe("karta firmy: Diagnostyka i sekcja Domena własna (#78)", () => {
  const card: CompanyCardDto = {
    organizationId: id, slug: "alfa", name: "Alfa", organizationVersion: 1, archivedAt: null,
    registration: { status: "REGISTERED", firstAdminRegisteredAt: "2026-11-01T10:00:00.000Z" },
    account: { id: "u1", name: null, email: "a@b.pl", emailVerified: true, mfaEnabled: true, disabledAt: null },
    period: { paidThrough: null, trialGranted: true, trialStartedAt: null, trialEndsAt: null, paidEndsAt: null,
      effectiveEndsAt: null, effectiveSource: "NONE", paidValid: false, trialValid: false, headline: "EXPIRED",
      publicVisible: false, periodVersion: 1 },
    publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
    hosts: [], invitation: null, conversationId: null,
  };
  const stored = { aliasHostname: "alfa.auterva.test", domain: { hostname: "wynajem.alfa.example", status: "PENDING_ROUTING", version: 3,
    lastFailureCode: "CNAME_MISMATCH", checkedAt: null, activatedAt: null, instruction: {
      ownership: { type: "TXT", name: "_auterva-challenge.wynajem.alfa.example", value: "auterva-verification=abc" },
      routing: { type: "CNAME", name: "wynajem.alfa.example", value: "edge.auterva.test" } } } };

  it("po sprawdzeniu w jednej sekcji druga odczytuje stan ponownie, więc karta sobie nie przeczy", async () => {
    const user = userEvent.setup();
    const calls = mockApi((url, init) => url.includes("/launch-diagnostics/") ? Response.json(failedDns)
      : url.includes("/domains/") ? Response.json(isPost(init) ? { domain: stored.domain } : stored) : Response.json(card));
    const reads = (part: string) => calls.filter((call) => call.method === "GET" && call.url.includes(part)).length;
    render(<PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>
      <CompanyCard initial={card} justSaved={false} /></PanelShell>);
    await block("Domena").findByText("Błąd: DNS domeny");
    await screen.findByRole("button", { name: "Sprawdź konfigurację" });
    expect([reads("/launch-diagnostics/"), reads("/domains/")]).toEqual([1, 1]);
    await user.click(retry("Domena"));
    await waitFor(() => expect(reads("/domains/")).toBe(2));
    await user.click(await screen.findByRole("button", { name: "Sprawdź konfigurację" }));
    await waitFor(() => expect(reads("/launch-diagnostics/")).toBe(2));
  });
});
