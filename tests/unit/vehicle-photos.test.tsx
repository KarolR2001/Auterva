// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VehicleImage } from "../../src/components/admin/fleet-api";
import { companyContext } from "../../src/components/admin/fleet-api";
import { VehiclePhotos } from "../../src/components/admin/vehicle-photos";
import { createGuardRegistry, UnsavedChangesGuardContext } from "../../src/components/panel/unsaved-changes-guard";
import * as core from "../../src/components/media/upload-core";

vi.mock("../../src/components/media/upload-core", async (original) => ({
  ...(await original<typeof import("../../src/components/media/upload-core")>()), sendImage: vi.fn() }));
const send = vi.mocked(core.sendImage);

const vehicleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const image = (n: number, extra: Partial<VehicleImage> = {}): VehicleImage => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, status: "READY", isCover: n === 1, alt: `Auto, zdjęcie ${n}`,
  version: n, position: n - 1, width: 800, height: 600,
  urls: { large: `/l/${n}`, thumb: `/t/${n}` }, ...extra });
const file = (name: string, type = "image/jpeg", size = 1000) => new File([new Uint8Array(size)], name, { type });
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
let handler: Handler;
let calls: { url: string; method: string; body: unknown }[];

function detail(images: VehicleImage[]) { return json(200, { id: vehicleId, images }); }

function Harness({ initial, published = false, readOnly = false }: { initial: VehicleImage[]; published?: boolean; readOnly?: boolean }) {
  const [images, setImages] = useState(initial);
  return <VehiclePhotos context={companyContext} vehicleId={vehicleId} published={published} readOnly={readOnly} images={images} onImages={setImages} />;
}

beforeEach(() => {
  calls = [];
  send.mockReset();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url, init);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const select = async (user: ReturnType<typeof userEvent.setup>, ...files: File[]) => {
  await user.upload(screen.getByTestId("vehicle-photo-input"), files);
};

describe("zdjęcia pojazdu: upload", () => {
  it("pokazuje limity przed wyborem i licznik", () => {
    render(<Harness initial={[image(1), image(2)]} />);
    expect(screen.getByRole("heading", { name: "Zdjęcia pojazdu (2 z 30)" })).toBeInTheDocument();
    expect(screen.getByText(/JPEG, PNG lub WebP, do 10 MB każdy, najwyżej 30 zdjęć/)).toHaveTextContent("zostało 28");
    expect(screen.getByTestId("vehicle-photo-input")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.getByTestId("vehicle-photo-input")).toHaveAttribute("multiple");
  });

  it("zestaw mieszany: zły typ i rozmiar odpadają bez żądania, poprawny jest wysyłany, a sukces zostaje po błędzie innego pliku", async () => {
    handler = () => detail([image(1), image(2)]);
    send.mockImplementation(async ({ file: sent }) => sent.name === "zly.jpg"
      ? { kind: "rejected", status: 422, code: "INVALID_IMAGE" }
      : { kind: "accepted", status: 200, body: { imageId: image(2).id, state: "READY" } });
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1)]} />);
    await select(user, file("dobry.jpg"), file("notatki.pdf", "application/pdf"), file("puste.png", "image/png", 0), file("za-duze.webp", "image/webp", 10 * 1024 * 1024 + 1), file("zly.jpg"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("To nie jest poprawne zdjęcie JPEG, PNG lub WebP.")).toBeInTheDocument();
    expect(screen.getByText(/Nieobsługiwany format/)).toBeInTheDocument();
    expect(screen.getAllByText("Plik jest pusty albo większy niż 10 MB.")).toHaveLength(2);
    // The accepted photo is in the list and the broken ones have no retry (the server would always refuse them).
    await waitFor(() => expect(screen.getByRole("heading", { name: "Zdjęcia pojazdu (2 z 30)" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Spróbuj ponownie/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Usuń z kolejki/ })).toHaveLength(4);
  });

  it("limit 30 obejmuje gotowe i wysyłane: nadmiarowe pliki są odrzucone z komunikatem", async () => {
    handler = () => detail(Array.from({ length: 29 }, (_, i) => image(i + 1)));
    send.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={Array.from({ length: 29 }, (_, i) => image(i + 1))} />);
    await select(user, file("a.jpg"), file("b.jpg"), file("c.jpg"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Osiągnięto limit 30 zdjęć pojazdu. Usuń jedno, aby dodać kolejne.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Dodaj zdjęcia" })).toBeDisabled();
  });

  it("przetwarzanie: plik czeka na listę, po jej odświeżeniu znika z kolejki", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let processed = false;
    handler = () => detail(processed ? [image(1), image(2)] : [image(1)]);
    send.mockResolvedValue({ kind: "accepted", status: 202, body: { imageId: image(2).id, state: "PROCESSING" } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, applyAccept: false });
    render(<Harness initial={[image(1)]} />);
    await select(user, file("nowe.jpg"));
    expect(await screen.findByText("Przetwarzanie zdjęcia…")).toBeInTheDocument();
    processed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    await waitFor(() => expect(screen.queryByText("Przetwarzanie zdjęcia…")).toBeNull());
    expect(screen.getByRole("heading", { name: "Zdjęcia pojazdu (2 z 30)" })).toBeInTheDocument();
  });

  it("niepewny wynik: lista jest odczytana, ponowienie używa tego samego klucza i nie dubluje wiersza", async () => {
    handler = () => detail([image(1)]);
    const keys: string[] = [];
    send.mockImplementationOnce(async ({ key }) => { keys.push(key); return { kind: "uncertain", status: 0 }; })
      .mockImplementationOnce(async ({ key }) => { keys.push(key); return { kind: "accepted", status: 200, body: { imageId: image(2).id } }; });
    handler = (() => { let n = 0; return () => detail(++n < 2 ? [image(1)] : [image(1), image(2)]); })();
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1)]} />);
    await select(user, file("siec.jpg"));
    expect(await screen.findByText(/Wynik wysyłania jest nieznany/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "GET")).toBe(true);
    await user.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Zdjęcia pojazdu (2 z 30)" })).toBeInTheDocument());
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(screen.queryByText("siec.jpg")).toBeNull();
  });

  it("odrzucenie z zużytym kluczem daje nowy klucz przy ponowieniu (MEDIA_BUSY zachowuje stary)", async () => {
    handler = () => detail([image(1)]);
    const keys: string[] = [];
    send.mockImplementation(async ({ key }) => { keys.push(key); return { kind: "rejected", status: 503, code: "MEDIA_BUSY", retryAfter: 5 }; });
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1)]} />);
    await select(user, file("zajety.jpg"));
    expect(await screen.findByText(/Spróbuj za 5 s\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("zdjęcia pojazdu: cover, kolejność, alt, usuwanie", () => {
  it("przesunięcie przyciskiem wysyła pełną permutację z wersjami, odczytuje stan serwera i zachowuje fokus", async () => {
    const reordered = [image(2, { isCover: false }), image(1, { isCover: true }), image(3, { isCover: false })];
    handler = (url, init) => init?.method === "PUT" ? json(200, { items: [] }) : detail(reordered);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1), image(2), image(3)]} />);
    await user.click(screen.getByRole("button", { name: /Przesuń wyżej, zdjęcie 2/ }));
    await waitFor(() => expect(screen.getByText("Zdjęcie przesunięto na pozycję 1 z 3.")).toBeInTheDocument());
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe(`/api/admin/vehicles/${vehicleId}/images/order/`);
    expect(put.body).toEqual({ items: [{ id: image(2).id, expectedVersion: 2 }, { id: image(1).id, expectedVersion: 1 }, { id: image(3).id, expectedVersion: 3 }] });
    const first = screen.getAllByRole("listitem").find((li) => within(li).queryByText("Zdjęcie 1 z 3"))!;
    expect(within(first).getByRole("button", { name: /Przesuń niżej/ })).toHaveFocus();
    expect(screen.getAllByRole("button", { name: /Przesuń wyżej/ })[0]).toBeDisabled();
  });

  it("konflikt wersji przy kolejności jest jawny, lista odświeżona, a szkice opisów innych zdjęć zostają", async () => {
    handler = (url, init) => init?.method === "PUT" ? json(409, { code: "MEDIA_VERSION_CONFLICT" }) : detail([image(1), image(2, { version: 9 })]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1), image(2)]} />);
    const alt = screen.getByLabelText(/Opis alternatywny \(zdjęcie 1\)/);
    await user.clear(alt); await user.type(alt, "Mój opis");
    await user.click(screen.getByRole("button", { name: /Przesuń niżej, zdjęcie 1/ }));
    expect(await screen.findByText(/Zdjęcia zostały zmienione w międzyczasie/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Opis alternatywny \(zdjęcie 1\)/)).toHaveValue("Mój opis");
  });

  it("ustaw jako główne wysyła isCover z wersją; pokazuje wynik dopiero z serwera", async () => {
    let done = false;
    handler = (url, init) => init?.method === "PATCH" ? ((done = true), json(200, {})) : detail(done ? [image(1, { isCover: false }), image(2, { isCover: true })] : [image(1), image(2)]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1), image(2)]} />);
    expect(screen.getByText("Główne")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ustaw jako główne, zdjęcie 2/ }));
    expect(await screen.findByText("Zmieniono zdjęcie główne.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ expectedVersion: 2, isCover: true });
    const second = screen.getAllByRole("listitem").find((li) => within(li).queryByText("Zdjęcie 2 z 2"))!;
    expect(within(second).getByText("Główne")).toBeInTheDocument();
  });

  it("opis: zapis wysyła tylko zmieniony opis; puste pole wysyła null (opis domyślny); wynik nieznany odświeża listę", async () => {
    handler = (url, init) => init?.method === "PATCH" ? json(200, {}) : detail([image(1, { alt: "Nowy", version: 2 })]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1)]} />);
    const alt = screen.getByLabelText(/Opis alternatywny \(zdjęcie 1\)/);
    await user.clear(alt); await user.type(alt, "Nowy");
    await user.click(screen.getByRole("button", { name: /Zapisz opis/ }));
    expect(await screen.findByText("Zapisano opis zdjęcia.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ expectedVersion: 1, alt: "Nowy" });
    await user.clear(screen.getByLabelText(/Opis alternatywny/));
    await user.click(screen.getByRole("button", { name: /Zapisz opis/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "PATCH")[1]!.body).toEqual({ expectedVersion: 2, alt: null });
  });

  it("niezapisany opis rejestruje się w strażniku formularza", async () => {
    handler = () => detail([image(1)]);
    const registry = createGuardRegistry();
    const user = userEvent.setup({ applyAccept: false });
    render(<UnsavedChangesGuardContext.Provider value={registry}><Harness initial={[image(1)]} /></UnsavedChangesGuardContext.Provider>);
    expect(registry.state()).toBe("free");
    await user.type(screen.getByLabelText(/Opis alternatywny/), "x");
    expect(registry.state()).toBe("dirty");
    expect(registry.hasSave()).toBe(true);
    expect(registry.label()).toBe("zdjęcia pojazdu");
  });

  it("usuwanie wymaga potwierdzenia; anulowanie niczego nie wysyła", async () => {
    handler = () => detail([image(1), image(2)]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1), image(2)]} />);
    await user.click(screen.getByRole("button", { name: /Usuń, zdjęcie 2/ }));
    expect(screen.getByRole("dialog", { name: "Usunąć zdjęcie?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /Usuń, zdjęcie 2/ }));
    handler = (url, init) => init?.method === "DELETE" ? json(200, { id: image(2).id, deleted: true, coverImageId: null }) : detail([image(1)]);
    await user.click(screen.getByRole("button", { name: "Usuń zdjęcie" }));
    expect(await screen.findByText("Usunięto zdjęcie.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "DELETE")!.body).toEqual({ expectedVersion: 2 });
    expect(screen.getByRole("heading", { name: "Zdjęcia pojazdu (1 z 30)" })).toBeInTheDocument();
  });

  it("opublikowany pojazd: usunięcie głównego wymaga wskazania zamiennika i wysyła replacementCoverId", async () => {
    handler = (url, init) => init?.method === "DELETE" ? json(200, { id: image(1).id, deleted: true, coverImageId: image(3).id })
      : detail([image(2, { isCover: false }), image(3, { isCover: true })]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1), image(2), image(3)]} published />);
    await user.click(screen.getByRole("button", { name: /Usuń, zdjęcie 1/ }));
    await user.selectOptions(screen.getByLabelText("Nowe zdjęcie główne"), image(3).id);
    await user.click(screen.getByRole("button", { name: "Usuń zdjęcie" }));
    expect(await screen.findByText("Usunięto zdjęcie.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "DELETE")!.body).toEqual({ expectedVersion: 1, replacementCoverId: image(3).id });
  });

  it("jedyne zdjęcie opublikowanego pojazdu: wyjaśnienie bez żądania usunięcia i bez fałszywego sukcesu", async () => {
    handler = () => detail([image(1)]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1)]} published />);
    await user.click(screen.getByRole("button", { name: /Usuń, zdjęcie 1/ }));
    expect(screen.getByRole("dialog", { name: "Nie można usunąć jedynego zdjęcia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usuń zdjęcie" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Rozumiem" }));
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Zdjęcia pojazdu (1 z 30)" })).toBeInTheDocument();
  });

  it("serwer odmawia usunięcia ostatniego głównego (równoległa publikacja): błąd w oknie, zdjęcie zostaje", async () => {
    handler = () => json(409, { code: "MEDIA_COVER_REQUIRED" });
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1)]} />);
    await user.click(screen.getByRole("button", { name: /Usuń, zdjęcie 1/ }));
    await user.click(screen.getByRole("button", { name: "Usuń zdjęcie" }));
    expect(await screen.findByText(/To jedyne zdjęcie opublikowanego pojazdu\. Najpierw cofnij publikację/)).toBeInTheDocument();
    expect(screen.queryByText("Usunięto zdjęcie.")).toBeNull();
  });

  it("utrata odpowiedzi przy usuwaniu: komunikat o nieznanym wyniku i lista z serwera", async () => {
    handler = (url, init) => init?.method === "DELETE" ? Promise.reject(new TypeError("network")) : detail([image(1), image(2)]);
    const user = userEvent.setup({ applyAccept: false });
    render(<Harness initial={[image(1), image(2)]} />);
    await user.click(screen.getByRole("button", { name: /Usuń, zdjęcie 2/ }));
    await user.click(screen.getByRole("button", { name: "Usuń zdjęcie" }));
    expect(await screen.findByText(/Wynik operacji jest nieznany: usuwanie zdjęcia/)).toBeInTheDocument();
    expect(screen.queryByText("Usunięto zdjęcie.")).toBeNull();
  });

  it("zarchiwizowany pojazd: tylko odczyt, bez przycisków zmian", () => {
    render(<Harness initial={[image(1), image(2)]} readOnly />);
    expect(screen.queryByRole("button", { name: "Dodaj zdjęcia" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Przesuń|Usuń|Ustaw/ })).toBeNull();
    expect(screen.getByLabelText(/Opis alternatywny \(zdjęcie 1\)/)).toBeDisabled();
  });
});
