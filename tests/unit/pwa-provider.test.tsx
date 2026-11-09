// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";
import { useUnsavedChanges } from "../../src/components/panel/unsaved-changes-guard";
import { clearNonStaticCaches, PwaProvider, pwaBrowser, usePwa } from "../../src/components/pwa/pwa-provider";

class FakeWorker extends EventTarget {
  state = "installed";
  postMessage = vi.fn();
}
function installServiceWorker(options: { controller: boolean; waiting?: FakeWorker }) {
  const container = new EventTarget() as EventTarget & { controller: object | null; register: ReturnType<typeof vi.fn> };
  container.controller = options.controller ? {} : null;
  const registration = Object.assign(new EventTarget(), { waiting: options.waiting ?? null, installing: null, update: vi.fn(async () => undefined) });
  container.register = vi.fn(async () => registration);
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  return { container, registration };
}

beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

function Probe() {
  const pwa = usePwa();
  return <p>{`online=${pwa.online} update=${pwa.updateReady} install=${pwa.canInstall}`}</p>;
}

describe("PwaProvider", () => {
  it("rejestruje worker tylko w zakresie /admin/ i tylko gdy włączony", async () => {
    const { container } = installServiceWorker({ controller: true });
    const { unmount } = render(<PwaProvider enabled={false}><Probe /></PwaProvider>);
    expect(container.register).not.toHaveBeenCalled();
    unmount();
    render(<PwaProvider enabled><Probe /></PwaProvider>);
    await waitFor(() => expect(container.register).toHaveBeenCalledWith("/sw.js", { scope: "/admin/", updateViaCache: "none" }));
  });

  it("pokazuje Online/Offline według zdarzeń przeglądarki", async () => {
    render(<PwaProvider enabled={false}><Probe /></PwaProvider>);
    expect(screen.getByText(/online=true/)).toBeInTheDocument();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByText(/online=false/)).toBeInTheDocument();
  });

  it("oczekująca aktualizacja nie przeładowuje strony bez zgody i nie aktywuje workera", async () => {
    const waiting = new FakeWorker();
    installServiceWorker({ controller: true, waiting });
    const reload = vi.spyOn(pwaBrowser, "reload").mockImplementation(() => undefined);
    render(<PwaProvider enabled><Probe /></PwaProvider>);
    await waitFor(() => expect(screen.getByText(/update=true/)).toBeInTheDocument());
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("pierwsza instalacja (brak kontrolera) nie zgłasza aktualizacji", async () => {
    installServiceWorker({ controller: false, waiting: new FakeWorker() });
    render(<PwaProvider enabled><Probe /></PwaProvider>);
    await waitFor(() => expect(screen.getByText(/online=true/)).toBeInTheDocument());
    expect(screen.getByText(/update=false/)).toBeInTheDocument();
  });

  it("zmiana kontrolera z innej karty nie przeładowuje tej karty", async () => {
    const { container } = installServiceWorker({ controller: true, waiting: new FakeWorker() });
    const reload = vi.spyOn(pwaBrowser, "reload").mockImplementation(() => undefined);
    render(<PwaProvider enabled><Probe /></PwaProvider>);
    await waitFor(() => expect(screen.getByText(/update=true/)).toBeInTheDocument());
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("clearNonStaticCaches", () => {
  it("usuwa każdy cache poza wersjonowanym precache", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", { keys: async () => ["serwist-precache-v2-https://x/admin/", "runtime-private", "other"], delete: async (name: string) => { deleted.push(name); return true; } });
    await clearNonStaticCaches();
    expect(deleted).toEqual(["runtime-private", "other"]);
    vi.unstubAllGlobals();
  });
});

describe("shell panelu firmy a PWA", () => {
  function Form() {
    const [value, setValue] = useState("");
    useUnsavedChanges({ dirty: value !== "", contextLabel: "formularz auta" });
    return <label>Nazwa<input value={value} onChange={(event) => setValue(event.target.value)} /></label>;
  }
  const mount = () => render(
    <PwaProvider enabled>
      <PanelShell area="company" accessState="allowed" title="Panel" currentPath="/admin" onLogout={vi.fn()}><Form /></PanelShell>
    </PwaProvider>,
  );

  it("chip pokazuje tekst i ikonę dla Online oraz Offline", async () => {
    installServiceWorker({ controller: true });
    mount();
    const chip = screen.getByText("Online").closest("[aria-live]");
    expect(chip?.querySelector("svg")).not.toBeNull();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByText("Offline").closest("[aria-live]")?.querySelector("svg")).not.toBeNull();
  });

  it("przy brudnym formularzu aktualizacja czeka na zgodę w oknie niezapisanych zmian", async () => {
    const waiting = new FakeWorker();
    const { container } = installServiceWorker({ controller: true, waiting });
    const reload = vi.spyOn(pwaBrowser, "reload").mockImplementation(() => undefined);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Nazwa"), "Nowe auto");
    await user.click(await screen.findByRole("button", { name: "Odśwież teraz" }));
    expect(waiting.postMessage).not.toHaveBeenCalled();
    await screen.findByRole("alertdialog", { name: "Niezapisane zmiany" });
    await user.click(screen.getByRole("button", { name: "Zostań" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nazwa")).toHaveValue("Nowe auto");
    await user.click(screen.getByRole("button", { name: "Odśwież teraz" }));
    await user.click(await screen.findByRole("button", { name: /Odrzuć zmiany/ }));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("czysty formularz: aktualizacja po kliknięciu bez okna", async () => {
    const waiting = new FakeWorker();
    installServiceWorker({ controller: true, waiting });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Odśwież teraz" }));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("oferuje instalację z zdarzenia beforeinstallprompt", async () => {
    installServiceWorker({ controller: true });
    const prompt = vi.fn(async () => undefined);
    const user = userEvent.setup();
    mount();
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(await screen.findByRole("button", { name: "Zainstaluj aplikację" }));
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
