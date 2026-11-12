// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkBlocks } from "../../src/components/admin/bulk-blocks";
import { readBulkAnswer } from "../../src/components/admin/bulk-blocks-api";
import {
  activityText, checkedVehicles, emptyDraft, isDraftDirty, keyFor, ofVehicles, rejectionText, requestOf, signatureOf, validateDraft, type BulkSource,
} from "../../src/components/admin/bulk-blocks-model";
import { createGuardRegistry, UnsavedChangesGuardContext } from "../../src/components/panel/unsaved-changes-guard";
import { FleetCalendar } from "../../src/components/admin/fleet-calendar";
import { companyContext, platformContext } from "../../src/components/admin/fleet-api";
import { copyHref } from "../../src/components/admin/vehicle-calendar";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

const TODAY = "2027-03-10";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const BLOCK = "55555555-5555-4555-8555-555555555555";
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const item = (vehicleId: string, name: string, availableTo: string | null = null) => ({ vehicleId, name, slug: name, status: "PUBLISHED",
  availableFrom: "2027-01-01", availableTo, days: [], blocks: [] });
const vehicles = (items = [item(A, "Auto Alfa"), item(B, "Auto Beta"), item(C, "Auto Gamma", "2027-03-12")]) =>
  ({ from: TODAY, to: TODAY, total: items.length, page: 1, pageSize: 100, items });
type Call = { url: string; body: Record<string, unknown> | null };

/** Routes fetch: the vehicle read (fleet calendar of today) answers itself, every bulk POST takes the next scripted answer. */
function server(answers: (Response | Error)[], list = vehicles()) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null });
    if (url.includes("/availability/fleet/")) return reply(200, list);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected ${url}`);
    if (next instanceof Error) throw next;
    return next;
  }));
  return { calls, bulk: () => calls.filter((call) => call.url.includes("/blocks/")) };
}
function renderBulk(props: Partial<Parameters<typeof BulkBlocks>[0]> = {}) {
  const onSaved = vi.fn(), onClose = vi.fn(), onCopy = vi.fn();
  render(<BulkBlocks context={companyContext} mode="create" source={null} today={TODAY} calendarHref="/admin/kalendarz/"
    onClose={onClose} onSaved={onSaved} onCopy={onCopy} {...props} />);
  return { onSaved, onClose, onCopy };
}
const row = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) }).closest("li") as HTMLElement;
async function fillCreate(user: ReturnType<typeof userEvent.setup>, names = ["Auto Alfa", "Auto Beta"]) {
  await screen.findByRole("checkbox", { name: /Auto Alfa/ });
  await user.type(screen.getByLabelText(/^Od/), "2027-03-15");
  await user.selectOptions(screen.getByLabelText(/^Typ/), "MAINTENANCE");
  await user.type(screen.getByLabelText(/^Numer odniesienia/), "SRV-1");
  for (const name of names) await user.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
}
const preview = (wouldSave: string[], rejected: unknown[] = [], onConflict = "ABORT") =>
  reply(200, { dryRun: true, onConflict, wouldSave: wouldSave.map((vehicleId) => ({ vehicleId })), saved: [], rejected });

describe("#217 model: walidacja, klucz idempotencji, odpowiedzi, teksty", () => {
  it("jeden dzień jest poprawny; brak pojazdów, odwrotny zakres i ponad 50 aut to błędy", () => {
    const one = { ...emptyDraft(), from: "2027-03-15", to: "2027-03-15", vehicleIds: [A] };
    expect(validateDraft("create", one)).toEqual({});
    expect(validateDraft("create", { ...one, vehicleIds: [] }).vehicles).toMatch(/co najmniej jeden/);
    expect(validateDraft("create", { ...one, to: "2027-03-14" }).to).toMatch(/wcześniejsza/);
    expect(validateDraft("create", { ...one, vehicleIds: Array.from({ length: 51 }, (_, i) => `${i}`) }).vehicles).toMatch(/najwyżej 50/);
    expect(validateDraft("copy", { ...emptyDraft(), vehicleIds: [A] })).toEqual({});
  });
  it("ten sam wpis zachowuje klucz, zmiana danych daje nowy; kopia wysyła notatkę tylko jawnie", () => {
    const draft = { ...emptyDraft(), from: "2027-03-15", to: "2027-03-16", vehicleIds: [A, B] };
    const sig = signatureOf(requestOf("create", draft, null));
    let n = 0; const gen = () => `k${++n}`;
    const first = keyFor(null, sig, gen);
    expect(keyFor(first, sig, gen).key).toBe("k1");
    expect(keyFor(first, signatureOf(requestOf("create", { ...draft, to: "2027-03-17" }, null)), gen).key).toBe("k2");
    expect(requestOf("create", { ...draft, reference: "  " }, null)).toEqual({ vehicleIds: [A, B], onConflict: "ABORT",
      fields: { from: "2027-03-15", to: "2027-03-16", type: "BLOCKED" } });
    const source: BulkSource = { blockId: BLOCK, vehicleId: C, vehicleName: "Gamma", from: "2027-03-15", to: "2027-03-16", type: "MAINTENANCE", reference: "R", hasNote: false };
    expect(requestOf("copy", { ...draft, copyNote: true }, source)).toEqual({ sourceBlockId: BLOCK, targetVehicleIds: [A, B], copyNote: false, onConflict: "ABORT" });
    expect(requestOf("copy", { ...draft, copyNote: true }, { ...source, hasNote: true })).toMatchObject({ copyNote: true });
  });
  it("5xx, sieć i 2xx bez list to wynik niepewny; 409 BULK_CONFLICTS to odrzucenie bez zapisu", () => {
    expect(readBulkAnswer(503, {})).toEqual({ kind: "uncertain", status: 503 });
    expect(readBulkAnswer(0, {})).toEqual({ kind: "uncertain", status: 0 });
    expect(readBulkAnswer(201, {})).toEqual({ kind: "uncertain", status: 201 });
    expect(readBulkAnswer(409, { code: "BULK_CONFLICTS", saved: [], rejected: [{ vehicleId: A, code: "BLOCK_OVERLAP" }] }).kind).toBe("aborted");
    expect(readBulkAnswer(409, { code: "IDEMPOTENCY_KEY_CONFLICT" })).toMatchObject({ kind: "error", code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(readBulkAnswer(429, { code: "RATE_LIMITED" }, 30)).toEqual({ kind: "error", status: 429, code: "RATE_LIMITED", retryAfter: 30 });
    expect(readBulkAnswer(200, { dryRun: true, onConflict: "SKIP", wouldSave: [{ vehicleId: A }], saved: [], rejected: [] }))
      .toEqual({ kind: "preview", onConflict: "SKIP", wouldSave: [A], rejected: [] });
  });
  it("przyczyny odrzuceń, aktywność i liczebniki", () => {
    expect(rejectionText({ vehicleId: A, code: "BLOCK_OVERLAP", conflict: { id: "x", from: "2027-03-16", to: "2027-03-18", type: "MAINTENANCE", version: 1 } }))
      .toBe("Konflikt: Serwis 16–18.03.2027");
    expect(rejectionText({ vehicleId: A, code: "BLOCK_OUTSIDE_ACTIVITY" }, { availableFrom: "2027-01-01", availableTo: "2027-03-12" }))
      .toBe("Poza okresem aktywności pojazdu (01.01.2027–12.03.2027)");
    expect(rejectionText({ vehicleId: A, code: "BLOCK_VEHICLE_ARCHIVED" })).toMatch(/zarchiwizowany/);
    expect(activityText({ availableFrom: "2027-01-01", availableTo: null })).toBe("Aktywny od 01.01.2027");
    expect(activityText({ availableFrom: null, availableTo: null })).toBe("Bez okresu aktywności");
    expect([1, 2, 5, 22].map(checkedVehicles)).toEqual(["1 pojazd sprawdzony", "2 pojazdy sprawdzone", "5 pojazdów sprawdzonych", "22 pojazdy sprawdzone"]);
    expect([1, 4].map(ofVehicles)).toEqual(["1 pojazdu", "4 pojazdów"]);
    expect(copyHref("/admin", A, { id: BLOCK, from: "2027-03-15" })).toBe(`/admin/kalendarz/?kopiuj=${BLOCK}&pojazd=${A}&od=2027-03-15`);
  });
});

describe("#217 ekran: podgląd, tryby konfliktu, raport, wynik niepewny", () => {
  it("podgląd ABORT wstrzymuje zapis; „Pomiń konflikty” i zapis z kluczem; pełny raport przy każdym pojeździe", async () => {
    const user = userEvent.setup();
    const conflict = { vehicleId: B, code: "BLOCK_OVERLAP", conflict: { id: "c1", from: "2027-03-14", to: "2027-03-16", type: "MAINTENANCE", version: 1 } };
    const { bulk } = server([
      preview([], [conflict]),
      preview([A], [conflict], "SKIP"),
      reply(200, { saved: [{ vehicleId: A, blockId: "n1", version: 1 }], rejected: [conflict] }),
    ]);
    const { onSaved, onCopy } = renderBulk();
    expect(await screen.findByRole("heading", { name: "Blokada zbiorcza", level: 2 })).toHaveFocus();
    await fillCreate(user);
    expect(screen.getByRole("radio", { name: /Wszystko albo nic \(domyślnie\)/ })).toBeChecked();
    expect(screen.getByText("Zaznaczono 2 z 3 · limit 50 pojazdów w jednym żądaniu")).toBeInTheDocument();
    expect(within(row("Auto Gamma")).getByText("Aktywny 01.01.2027–12.03.2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    expect(await screen.findByText("Podgląd konfliktów — nic nie zapisano")).toBeInTheDocument();
    expect(screen.getByText(/Konflikty: 1 pojazd\. W trybie „wszystko albo nic”/)).toBeInTheDocument();
    expect(within(row("Auto Beta")).getByText("Konflikt: Serwis 14–16.03.2027")).toBeInTheDocument();
    expect(within(row("Auto Alfa")).getByText("Wolny w tym terminie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zapisz blokadę (wstrzymane)" })).toBeDisabled();
    expect(screen.getByText("Usuń kolidujące pojazdy z wyboru albo wybierz „Pomiń konflikty”.")).toBeInTheDocument();
    expect(bulk()[0].body).toEqual({ vehicleIds: [A, B], onConflict: "ABORT", dryRun: true,
      fields: { from: "2027-03-15", to: "2027-03-15", type: "MAINTENANCE", reference: "SRV-1" } });
    // Changing the mode drops the stale preview; the next preview is SKIP.
    await user.click(screen.getByRole("radio", { name: /Pomiń konflikty/ }));
    expect(screen.queryByText("Podgląd konfliktów — nic nie zapisano")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    const save = await screen.findByRole("button", { name: "Zapisz 1, pomiń 1" });
    expect(bulk()[1].body).toMatchObject({ onConflict: "SKIP", dryRun: true });
    expect(bulk()[1].body).not.toHaveProperty("idempotencyKey");
    await user.click(save);
    expect(await screen.findByText("Zapisano 1 z 2 pojazdów")).toBeInTheDocument();
    expect(screen.getByText(/Odrzucono 1 pojazd: dla nich nie powstała żadna blokada/)).toBeInTheDocument();
    expect(bulk()[2].body).toMatchObject({ onConflict: "SKIP", dryRun: false, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(bulk()[2].url).toBe("/api/admin/blocks/bulk/");
    expect(within(row("Auto Alfa")).getByText("Zapisano")).toBeInTheDocument();
    expect(within(row("Auto Beta")).getByText("Konflikt: Serwis 14–16.03.2027")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Auto Gamma/ })).toBeNull();
    expect(screen.getByLabelText(/^Od/)).toBeDisabled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Kopiuj blokadę na inne pojazdy" }));
    expect(onCopy).toHaveBeenCalledWith({ blockId: "n1", vehicleId: A, vehicleName: "Auto Alfa", from: "2027-03-15", to: "2027-03-15",
      type: "MAINTENANCE", reference: "SRV-1", hasNote: false });
  });

  it("zapis bez podglądu: 409 BULK_CONFLICTS to „Nic nie zapisano” z wszystkimi przyczynami; „Zmień wybór” zachowuje dane", async () => {
    const user = userEvent.setup();
    server([reply(409, { code: "BULK_CONFLICTS", saved: [], rejected: [{ vehicleId: A, code: "BLOCK_OUTSIDE_ACTIVITY" }, { vehicleId: B, code: "BLOCK_VEHICLE_ARCHIVED" }] })]);
    const { onSaved } = renderBulk();
    await fillCreate(user);
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    expect(await screen.findByText("Nic nie zapisano")).toBeInTheDocument();
    expect(within(row("Auto Alfa")).getByText("Poza okresem aktywności pojazdu (od 01.01.2027)")).toBeInTheDocument();
    expect(within(row("Auto Beta")).getByText(/zarchiwizowany/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Zmień wybór" }));
    expect(screen.getByLabelText(/^Od/)).toHaveValue("2027-03-15");
    expect(screen.getByLabelText(/^Od/)).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Auto Beta/ })).toBeChecked();
  });

  it("SKIP z odrzuceniem wszystkich: podgląd blokuje zapis z powodem, a 200 z pustym `saved` to „Nic nie zapisano” bez sukcesu", async () => {
    const user = userEvent.setup();
    const rejected = [{ vehicleId: A, code: "BLOCK_OUTSIDE_ACTIVITY" }, { vehicleId: B, code: "BLOCK_OVERLAP", conflict: { id: "c1", from: "2027-03-14", to: "2027-03-16", type: "MAINTENANCE", version: 1 } }];
    server([preview([], rejected, "SKIP"), reply(200, { saved: [], rejected })]);
    const { onSaved } = renderBulk();
    await fillCreate(user);
    await user.click(screen.getByRole("radio", { name: /Pomiń konflikty/ }));
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    expect(await screen.findByText(/Nic do zapisania: wszystkie wybrane pojazdy \(2\) mają konflikt/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Zapisz blokadę (nic do zapisania)" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Nic do zapisania: wszystkie wybrane pojazdy mają konflikt. Zmień wybór pojazdów albo daty.");
    // The server can still answer 200 with an empty `saved` (state changed after the preview): never shown as a success.
    await user.click(screen.getByRole("checkbox", { name: /Auto Gamma/ }));
    await user.click(screen.getByRole("checkbox", { name: /Auto Gamma/ }));
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    expect(await screen.findByText("Nic nie zapisano")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/odrzucono wszystkie wybrane pojazdy \(2\)/);
    expect(screen.queryByText(/^Zapisano/)).toBeNull();
    expect(within(row("Auto Alfa")).getByText(/Poza okresem aktywności/)).toBeInTheDocument();
    expect(within(row("Auto Beta")).getByText("Konflikt: Serwis 14–16.03.2027")).toBeInTheDocument();
    expect(screen.getByText("Wynik zapisu: nic nie zapisano, 2 odrzucone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kopiuj blokadę na inne pojazdy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zmień wybór" })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("po „Zmień dane” konflikt z blokadą może być własnym zapisem z wynikiem nieznanym: komunikat każe sprawdzić kalendarz", async () => {
    const user = userEvent.setup();
    const own = { vehicleId: A, code: "BLOCK_OVERLAP", conflict: { id: "n1", from: "2027-03-15", to: "2027-03-15", type: "MAINTENANCE", version: 1 } };
    server([reply(502, {}), reply(409, { code: "BULK_CONFLICTS", saved: [], rejected: [own] })]);
    renderBulk();
    await fillCreate(user, ["Auto Alfa"]);
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    await user.click(await screen.findByRole("button", { name: "Zmień dane (nowe żądanie)" }));
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    expect(await screen.findByText("Nic nie zapisano")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Konflikt może dotyczyć blokady zapisanej poprzednim żądaniem, którego wynik był nieznany — sprawdź kalendarz floty.");
  });

  it("5xx i brak sieci: brak pozornego sukcesu, ponowienie z tym samym kluczem, potem wynik serwera", async () => {
    const user = userEvent.setup();
    const { bulk } = server([
      reply(502, {}),
      new TypeError("network"),
      reply(201, { saved: [{ vehicleId: A, blockId: "n1", version: 1 }, { vehicleId: B, blockId: "n2", version: 1 }], rejected: [] }),
    ]);
    const { onSaved } = renderBulk();
    await fillCreate(user);
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    expect(await screen.findByText("Nie wiemy, czy blokady zostały zapisane")).toBeInTheDocument();
    expect(screen.queryByText(/^Zapisano/)).toBeNull();
    expect(within(row("Auto Alfa")).getByText("Wynik nieznany — nie potwierdzono zapisu")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Od/)).toBeDisabled();
    expect(onSaved).toHaveBeenCalledTimes(1); // the calendar re-reads the server state
    await user.click(screen.getByRole("button", { name: "Ponów wysyłkę (ten sam klucz)" }));
    await waitFor(() => expect(bulk()).toHaveLength(2));
    expect(await screen.findByText("Nie wiemy, czy blokady zostały zapisane")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ponów wysyłkę (ten sam klucz)" }));
    expect(await screen.findByText("Zapisano 2 z 2 pojazdów")).toBeInTheDocument();
    const keys = bulk().map((call) => call.body?.idempotencyKey);
    expect(keys[0]).toEqual(expect.any(String));
    expect(new Set(keys).size).toBe(1);
    expect(bulk()[0].body).toEqual(bulk()[2].body);
  });

  it("wynik nieznany ostrzega, że po opuszczeniu strony ponowienie tym samym kluczem znika (blokada i kopia)", async () => {
    const warning = "Po opuszczeniu tej strony nie ponowisz wysyłki tym samym kluczem — sprawdź kalendarz floty.";
    const user = userEvent.setup();
    server([reply(502, {})]);
    renderBulk();
    await fillCreate(user);
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    expect(await screen.findByText("Nie wiemy, czy blokady zostały zapisane")).toBeInTheDocument();
    expect(screen.getByText("Nie wiemy, czy blokady zostały zapisane").parentElement).toHaveTextContent(warning);
  });

  it("kopia: wynik nieznany niesie to samo ostrzeżenie", async () => {
    const user = userEvent.setup();
    server([preview([A]), reply(503, {})]);
    const source: BulkSource = { blockId: BLOCK, vehicleId: C, vehicleName: "Auto Gamma", from: "2027-03-15", to: "2027-03-17", type: "MAINTENANCE", reference: "SRV-9", hasNote: true };
    renderBulk({ mode: "copy", source });
    await user.click(await screen.findByRole("checkbox", { name: /Auto Alfa/ }));
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    await screen.findByText("Podgląd konfliktów — nic nie zapisano");
    await user.click(screen.getByRole("button", { name: "Kopiuj blokadę" }));
    expect(await screen.findByText("Nie wiemy, czy blokady zostały zapisane")).toBeInTheDocument();
    expect(screen.getByText("Nie wiemy, czy blokady zostały zapisane").parentElement).toHaveTextContent("Po opuszczeniu tej strony nie ponowisz wysyłki tym samym kluczem — sprawdź kalendarz floty.");
  });

  it("„Zmień dane” po wyniku nieznanym odblokowuje formularz, kolejny zapis ma nowy klucz", async () => {
    const user = userEvent.setup();
    const { bulk } = server([reply(500, { code: "INTERNAL_ERROR" }), reply(201, { saved: [{ vehicleId: A, blockId: "n1", version: 1 }], rejected: [] })]);
    const { onClose } = renderBulk();
    await fillCreate(user);
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    await screen.findByText("Nie wiemy, czy blokady zostały zapisane");
    expect(screen.getByRole("button", { name: "Sprawdź kalendarz floty" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zmień dane (nowe żądanie)" }));
    await user.click(screen.getByRole("checkbox", { name: /Auto Beta/ }));
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    await screen.findByText("Zapisano 1 z 1 pojazdu");
    expect(bulk()[1].body?.idempotencyKey).not.toBe(bulk()[0].body?.idempotencyKey);
    await user.click(screen.getByRole("button", { name: "Wróć do kalendarza" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("walidacja: podsumowanie z fokusem i nic nie wysłano; 429 mówi, że nic nie zapisano", async () => {
    const user = userEvent.setup();
    const { bulk } = server([reply(429, { code: "RATE_LIMITED" })]);
    renderBulk();
    await screen.findByRole("checkbox", { name: /Auto Alfa/ });
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    expect(await screen.findByText("Do poprawy: 3")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("bulk-summary")).toHaveFocus());
    expect(bulk()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Pojazdy" }));
    expect(document.getElementById("bulk-vehicles")).toHaveFocus();
    await user.click(screen.getByRole("checkbox", { name: /Auto Alfa/ }));
    await user.type(screen.getByLabelText(/^Od/), "2027-03-15");
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    expect(await screen.findByText(/Zbyt wiele żądań.*Nic nie zapisano/)).toBeInTheDocument();
  });

  it("kopia: bez auta źródłowego na liście, notatka domyślnie nie, ścieżka firmy superadmina", async () => {
    const user = userEvent.setup();
    const { bulk } = server([preview([A])]);
    const source: BulkSource = { blockId: BLOCK, vehicleId: C, vehicleName: "Auto Gamma", from: "2027-03-15", to: "2027-03-17", type: "MAINTENANCE", reference: "SRV-9", hasNote: true };
    renderBulk({ mode: "copy", source, context: platformContext("org-1") });
    expect(await screen.findByRole("heading", { name: "Kopiuj blokadę", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Blokada źródłowa" })).toHaveTextContent("Serwis · 15–17.03.2027Auto Gamma · SRV-9");
    await screen.findByRole("checkbox", { name: /Auto Alfa/ });
    expect(screen.queryByRole("checkbox", { name: /Auto Gamma/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Kopiuj także notatkę wewnętrzną/ })).not.toBeChecked();
    expect(screen.queryByLabelText(/^Od/)).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /Auto Alfa/ }));
    await user.click(screen.getByRole("button", { name: "Sprawdź konflikty" }));
    await screen.findByText("Podgląd konfliktów — nic nie zapisano");
    expect(screen.getByRole("button", { name: "Kopiuj blokadę" })).toBeEnabled();
    expect(bulk()[0]).toEqual({ url: "/api/platform/companies/org-1/blocks/copy/",
      body: { sourceBlockId: BLOCK, targetVehicleIds: [A], copyNote: false, onConflict: "ABORT", dryRun: true } });
  });

  it("limit 50: „Zaznacz widoczne” zatrzymuje się na 50, pozostałe pola są wyłączone; wyszukiwanie zawęża listę", async () => {
    const many = Array.from({ length: 55 }, (_, i) => item(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Auto ${i}`));
    server([], vehicles(many));
    const user = userEvent.setup();
    renderBulk();
    await user.click(await screen.findByRole("button", { name: "Zaznacz widoczne (do 50)" }));
    expect(screen.getByText("Zaznaczono 50 z 55 · limit 50 pojazdów w jednym żądaniu")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Auto 54/ })).toBeDisabled();
    await user.type(screen.getByRole("searchbox", { name: "Szukaj pojazdu" }), "Auto 54");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("#380: Enter w „Szukaj pojazdu” nie wysyła formularza (bez podglądu i podsumowania), fokus zostaje w polu", async () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Auto ${i}`));
    const { bulk } = server([], vehicles(many));
    const user = userEvent.setup();
    renderBulk();
    await screen.findByRole("checkbox", { name: /Auto 0/ });
    const search = screen.getByRole("searchbox", { name: "Szukaj pojazdu" });
    await user.type(search, "Auto{Enter}");
    expect(search).toHaveFocus();
    expect(bulk()).toHaveLength(0);
    expect(screen.queryByText(/Do poprawy/)).not.toBeInTheDocument();
  });
});

describe("#217 kalendarz floty: wejścia D-48, adres widoku i odświeżenie po zapisie", () => {
  const grid = { from: "2026-11-10", to: "2026-11-23", total: 1, page: 1, pageSize: 20, items: [item(A, "Auto Alfa")] };
  it("„Blokada zbiorcza” obok „Szybka blokada”, zapis odświeża kalendarz, powrót przywraca fokus", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input); calls.push(url);
      if (url.includes("/availability/fleet/")) return reply(200, url.includes("pageSize=100") ? vehicles([item(A, "Auto Alfa")]) : grid);
      if (url.includes("/blocks/bulk/")) return reply(201, { saved: [{ vehicleId: A, blockId: "n1", version: 1 }], rejected: [] });
      throw new Error(url);
    }));
    window.history.replaceState(null, "", "/admin/kalendarz/");
    render(<FleetCalendar today="2026-11-10" title="Kalendarz floty" />);
    await screen.findByRole("region", { name: /Kalendarz floty, przewijany poziomo/ });
    expect(screen.getByRole("button", { name: "Szybka blokada" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Blokada zbiorcza" }));
    expect(await screen.findByRole("heading", { name: "Blokada zbiorcza", level: 2 })).toHaveFocus();
    expect(window.location.search).toBe("?zbiorcza=1");
    await user.click(await screen.findByRole("checkbox", { name: /Auto Alfa/ }));
    await user.type(screen.getByLabelText(/^Od/), "2026-11-12");
    const reads = calls.filter((url) => url.includes("/availability/fleet/") && !url.includes("pageSize=100")).length;
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    await screen.findByText("Zapisano 1 z 1 pojazdu");
    await waitFor(() => expect(calls.filter((url) => url.includes("/availability/fleet/") && !url.includes("pageSize=100")).length).toBe(reads + 1));
    await user.click(screen.getByRole("button", { name: "Wróć do kalendarza" }));
    await screen.findByRole("region", { name: /Kalendarz floty, przewijany poziomo/ });
    await waitFor(() => expect(screen.getByRole("button", { name: "Blokada zbiorcza" })).toHaveFocus());
    expect(window.location.search).toBe("");
  });

  it("link kopii otwiera kopię z danymi blokady z serwera; nieistniejąca blokada daje komunikat", async () => {
    window.history.replaceState(null, "", `/admin/kalendarz/?kopiuj=${BLOCK}&pojazd=${C}&od=2027-03-15`);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/availability/fleet/")) return reply(200, url.includes("pageSize=100") ? vehicles() : grid);
      if (url.includes(`/vehicles/${C}/availability/`)) return reply(200, { vehicleId: C, availableFrom: null, availableTo: null, days: [],
        blocks: [{ id: BLOCK, from: "2027-03-15", to: "2027-03-17", type: "MAINTENANCE", typeLabel: "Serwis", source: "MANUAL", reference: "SRV-9", internalNote: "tajne", version: 1 }] });
      if (url.includes(`/vehicles/${C}/`)) return reply(200, { id: C, name: "Auto Gamma", status: "PUBLISHED" });
      throw new Error(url);
    }));
    render(<FleetCalendar today="2026-11-10" title="Kalendarz floty" />);
    expect(await screen.findByRole("heading", { name: "Kopiuj blokadę", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Blokada źródłowa" })).toHaveTextContent("Serwis · 15–17.03.2027Auto Gamma · SRV-9");
    expect(screen.queryByText("tajne")).toBeNull();
    await userEvent.setup().click(screen.getByRole("link", { name: "Kalendarz floty" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Kalendarz floty", level: 2 })).toHaveFocus());
    expect(window.location.search).toBe("");
    cleanup();
    window.history.replaceState(null, "", `/admin/kalendarz/?kopiuj=${A}&pojazd=${C}&od=2027-03-15`);
    render(<FleetCalendar today="2026-11-10" title="Kalendarz floty" />);
    expect(await screen.findByText(/Nie znaleźliśmy blokady do skopiowania/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("#378 ochrona niezapisanych zmian: blokada zbiorcza i kopia w powłoce panelu", () => {
  function guarded(props: Partial<Parameters<typeof BulkBlocks>[0]> = {}) {
    const registry = createGuardRegistry();
    const spies = renderBulkIn(registry, props);
    return { registry, ...spies };
  }
  function renderBulkIn(registry: ReturnType<typeof createGuardRegistry>, props: Partial<Parameters<typeof BulkBlocks>[0]>) {
    const onSaved = vi.fn(), onClose = vi.fn(), onCopy = vi.fn();
    render(<UnsavedChangesGuardContext.Provider value={registry}>
      <BulkBlocks context={companyContext} mode="create" source={null} today={TODAY} calendarHref="/admin/kalendarz/"
        onClose={onClose} onSaved={onSaved} onCopy={onCopy} {...props} />
    </UnsavedChangesGuardContext.Provider>);
    return { onSaved, onClose, onCopy };
  }

  it("model: pusty formularz jest czysty, każde wpisane pole albo wybrany pojazd to zmiana", () => {
    expect(isDraftDirty(emptyDraft())).toBe(false);
    expect(isDraftDirty({ ...emptyDraft(), vehicleIds: [A] })).toBe(true);
    expect(isDraftDirty({ ...emptyDraft(), internalNote: "x" })).toBe(true);
    expect(isDraftDirty({ ...emptyDraft(), onConflict: "SKIP" })).toBe(true);
    expect(isDraftDirty({ ...emptyDraft(), copyNote: true })).toBe(true);
  });

  it("wpis lub wybór pojazdu rejestruje „dirty”; po zapisanym wyniku stan jest czysty (admin i superadmin)", async () => {
    for (const context of [companyContext, platformContext("org-1")]) {
      cleanup();
      const user = userEvent.setup();
      server([reply(201, { saved: [{ vehicleId: A, blockId: "n1", version: 1 }], rejected: [] })]);
      const { registry } = guarded({ context });
      await screen.findByRole("checkbox", { name: /Auto Alfa/ });
      expect(registry.state()).toBe("free");
      await user.click(screen.getByRole("checkbox", { name: /Auto Alfa/ }));
      expect(registry.state()).toBe("dirty");
      expect(registry.label()).toBe("Blokada zbiorcza");
      await user.type(screen.getByLabelText(/^Od/), "2027-03-15");
      await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
      await screen.findByText(/Zapisano 1 z 1/);
      expect(registry.state()).toBe("free");
    }
  });

  it("w trakcie zapisu stan to „busy” (wyjście pokazuje ostrzeżenie), po odpowiedzi nie; anulowany zapis (wszystko albo nic) też jest czysty", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (String(input).includes("/availability/fleet/")) return reply(200, vehicles());
      return new Promise<Response>((resolve) => { release = resolve; });
    }));
    const { registry } = guarded();
    await fillCreate(user, ["Auto Alfa"]);
    await user.click(screen.getByRole("button", { name: "Zapisz blokadę" }));
    await waitFor(() => expect(registry.state()).toBe("busy"));
    release(reply(409, { code: "BULK_CONFLICTS", saved: [], rejected: [{ vehicleId: A, code: "BLOCK_OUTSIDE_ACTIVITY" }] }));
    expect(await screen.findByText("Nic nie zapisano")).toBeInTheDocument();
    expect(registry.state()).toBe("free");
  });

  it("kopia z wybranym pojazdem jest „dirty”", async () => {
    const user = userEvent.setup();
    server([]);
    const source: BulkSource = { blockId: BLOCK, vehicleId: C, vehicleName: "Auto Gamma", from: "2027-03-15", to: "2027-03-17", type: "MAINTENANCE", reference: null, hasNote: false };
    const { registry } = guarded({ mode: "copy", source });
    await screen.findByRole("checkbox", { name: /Auto Alfa/ });
    expect(registry.state()).toBe("free");
    await user.click(screen.getByRole("checkbox", { name: /Auto Alfa/ }));
    expect(registry.state()).toBe("dirty");
    expect(registry.label()).toBe("Kopia blokady");
  });

  it("okruszek: gdy powłoka przechwyciła kliknięcie (dialog), widok się nie zamyka; bez zmian zamyka", async () => {
    const user = userEvent.setup();
    server([]);
    const { onClose } = guarded();
    await screen.findByRole("checkbox", { name: /Auto Alfa/ });
    await user.click(screen.getByRole("link", { name: "Kalendarz floty" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("checkbox", { name: /Auto Alfa/ }));
    const shell = (event: Event) => event.preventDefault();
    document.addEventListener("click", shell, true);
    try { await user.click(screen.getByRole("link", { name: "Kalendarz floty" })); } finally { document.removeEventListener("click", shell, true); }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Wstecz przeglądarki z wpisanymi danymi pyta (host oddaje popstate strażnikowi); „Zostań” zachowuje dane, „Odrzuć” zamyka widok", async () => {
    const user = userEvent.setup();
    server([]);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const backGuard: { current: (() => boolean) | null } = { current: null };
    const hostSync = vi.fn();
    const host = () => { if (backGuard.current?.()) return; hostSync(); };
    window.addEventListener("popstate", host);
    const { onClose } = guarded({ backGuardRef: backGuard });
    await user.click(await screen.findByRole("checkbox", { name: /Auto Alfa/ }));
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(hostSync).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith(1);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Zostań" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /Auto Alfa/ })).toBeChecked();
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); }); // the restoring popstate
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await user.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Odrzuć zmiany" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hostSync).not.toHaveBeenCalled();
    window.removeEventListener("popstate", host);
    go.mockRestore();
  });
});
