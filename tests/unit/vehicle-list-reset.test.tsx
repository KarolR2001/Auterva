// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VehicleList } from "../../src/components/admin/vehicle-list";

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

/** The mobile sheets only exist in the compact layout, which the list derives from its measured width (jsdom measures 0). */
class Observer { constructor(private callback: () => void) {} observe() { this.callback(); } disconnect() {} }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(() => json({ total: 0, page: 1, pageSize: 20, items: [], statusCounts: { total: 0, published: 0, draft: 0, hidden: 0, archived: 0 } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

const start = (search: string) => { window.history.replaceState(null, "", `/admin/pojazdy/${search}`); render(<VehicleList title="Pojazdy" />); };

describe("#381 czyszczenie filtrów a sortowanie listy pojazdów", () => {
  it("„Wyczyść filtry” w arkuszu filtrów zeruje wyszukiwanie, filtry i stronę, ale zachowuje sortowanie", async () => {
    start("?sort=updatedDesc&status=DRAFT&search=alfa&page=2");
    fireEvent.click(await screen.findByRole("button", { name: /^Filtry/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Wyczyść filtry" }));
    await waitFor(() => expect(window.location.search).toBe("?sort=updatedDesc"));
    expect(screen.getByLabelText("Szukaj")).toHaveValue("");
  });

  it("„Wyczyść filtry” w stanie „Brak wyników” zachowuje sortowanie", async () => {
    start("?sort=updatedAsc&status=DRAFT");
    fireEvent.click(await screen.findByRole("button", { name: "Wyczyść filtry" }));
    await waitFor(() => expect(window.location.search).toBe("?sort=updatedAsc"));
  });

  it("„Przywróć domyślne” w arkuszu sortowania przywraca kolejność w ofercie i nie rusza filtrów", async () => {
    start("?sort=updatedDesc&status=DRAFT");
    fireEvent.click(await screen.findByRole("button", { name: /^Sortuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć domyślne" }));
    await waitFor(() => expect(window.location.search).toBe("?status=DRAFT"));
  });
});
