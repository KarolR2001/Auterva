// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";

import { ChatPanel } from "../../src/components/chat/chat-panel";
import { loadDraft, loadPending } from "../../src/components/chat/draft-store";
import { navigation } from "../../src/components/panel/unsaved-changes-guard";
import { PanelShell } from "../../src/components/panel/panel-shell";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  emit(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

const m = (id: string, own: boolean, body = id) => ({ id, clientMessageId: own ? `c-${id}` : null, body,
  senderRole: own ? "ADMIN_FIRMY" : "SUPERADMIN_AUTERVA", own, createdAt: "2026-11-09T10:00:00Z" });
const history = (messages: object[], extra: object = {}) => ({ conversationId: "conv-1", messages, olderCursor: null, newerCursor: "cur-1", hasNewer: false, ...extra });
const state = { ownMessageId: null, ownSeq: 0, peerMessageId: null, peerSeq: 0, unread: 0 };

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  window.localStorage.clear();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const renderChat = () => render(
  <PanelShell area="company" accessState="allowed" title="Czat z Autervą" currentPath="/admin/czat" onLogout={vi.fn()}>
    <ChatPanel accountId="konto-a" organizationId="org-1" conversationId="conv-1" apiBase="/api/admin/chat" peerLabel="Auterva" companyName="Alfa Rent" peerWith="Autervą" loginHref="/admin/login" />
  </PanelShell>);

describe("czat firmy (#52)", () => {
  it("pokazuje pustą historię, a szkic zostaje i nie blokuje wyjścia", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([])));
    const user = userEvent.setup();
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "roboczy tekst");
    expect(loadDraft("konto-a", "conv-1")).toBe("roboczy tekst");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false); // chat draft is the exception of the #14 guard
  });

  it("sukces wysyłki wynika z odpowiedzi serwera; po 5xx ponowienie używa tego samego clientMessageId", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        keys.push(body.clientMessageId);
        return keys.length === 1 ? new Response(null, { status: 502 })
          : Response.json({ message: { ...m("n1", true, body.body), clientMessageId: body.clientMessageId }, conversationId: "conv-1", deduplicated: false }, { status: 201 });
      }
      return Response.json(history([]));
    });
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "Dzień dobry");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(screen.getByText("Niepewny wynik wysyłki")).toBeInTheDocument());
    expect(screen.getByText("Dzień dobry")).toBeInTheDocument(); // text kept, no false success
    expect(screen.queryByText(/Wysłano/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ponów wysyłkę" }));
    await waitFor(() => expect(screen.getByText(/Wysłano/)).toBeInTheDocument());
    expect(keys[1]).toBe(keys[0]);
    expect(loadDraft("konto-a", "conv-1")).toBe("");
  });

  it("błąd definitywny pozwala wrócić do edycji bez utraty tekstu", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST" ? Response.json({ code: "INVALID_MESSAGE" }, { status: 400 }) : Response.json(history([])));
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "x");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(screen.getByText("Nie wysłano")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edytuj tekst" }));
    expect(screen.getByRole("textbox", { name: /Napisz wiadomość/ })).toHaveValue("x");
  });

  it("teksty zgodne z TEN-11: podtytuł, Online, podpis firmą, podpowiedź szkicu; statusy tylko Wysłano/Przeczytano", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", true, "moja"), m("2", false, "pytanie")])));
    renderChat();
    await waitFor(() => expect(screen.getByText("pytanie")).toBeInTheDocument());
    expect(screen.getByText("Alfa Rent · kontakt z Autervą")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Czat z Autervą" })).toBeInTheDocument();
    expect(screen.getByText("Alfa Rent", { selector: "p" })).toBeInTheDocument(); // own message signed with the company
    expect(screen.queryByText("Ty", { exact: true })).toBeNull();
    expect(screen.getByText(/Szkic Alfa Rent · odbiorca: Auterva/)).toBeInTheDocument();
    // The shell's network chip (#56) also says "Online"; only the chat's own status is meant here.
    const chatOnline = () => screen.queryAllByText("Online").filter((node) => !node.closest("[data-online]"));
    expect(chatOnline()).toHaveLength(0); // not before the live channel is up
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.instances[0].emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-1", backlog: "none", state }));
    expect(chatOnline()).toHaveLength(1);
    expect(screen.getByText(/Wysłano/)).toBeInTheDocument();
    expect(screen.queryByText(/Dostarczono/)).toBeNull();
  });

  it("guard niewysłanej wiadomości: bez „Odrzuć zmiany”, wyjście bez wysyłania, wpis zostaje w storage", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status: 502 }) : Response.json(history([])));
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "do wysłania");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(screen.getByText("Niepewny wynik wysyłki")).toBeInTheDocument());
    await user.click(screen.getAllByRole("link", { name: "Dashboard" })[0]);
    const dialog = screen.getByRole("alertdialog", { name: "Niezapisane zmiany" });
    expect(dialog).toHaveTextContent("Zostaje na tym urządzeniu");
    expect(screen.queryByRole("button", { name: "Odrzuć zmiany" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Wyjdź bez wysyłania" }));
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(window.localStorage.length).toBeGreaterThan(0); // the unsent message is still stored
  });

  it("guard przy wylogowaniu: standardowe OVR-13, ostrzega o usunięciu i wpis faktycznie znika po potwierdzeniu", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status: 502 }) : Response.json(history([])));
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "do wysłania");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(screen.getByText("Niepewny wynik wysyłki")).toBeInTheDocument());
    expect(window.localStorage.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    const dialog = screen.getByRole("alertdialog", { name: "Niezapisane zmiany" });
    expect(dialog).toHaveTextContent("zostanie usunięty z tego urządzenia");
    expect(dialog).not.toHaveTextContent("Zostaje na tym urządzeniu");
    expect(screen.queryByRole("button", { name: "Wyjdź bez wysyłania" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Odrzuć zmiany" }));
    await waitFor(() => expect(window.localStorage.length).toBe(0)); // the stored unsent message is really gone
  });

  it("wiadomość drugiej strony z WebSocket, statusy odczytu i pisania; ready/połączenie nie czyta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", true, "moja"), m("2", false, "pytanie")])));
    renderChat();
    await waitFor(() => expect(screen.getByText("pytanie")).toBeInTheDocument());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain("/ws?organizationId=org-1&after=cur-1");
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-1", backlog: "none", state: { ...state, unread: 1 } }));
    expect(socket.sent).toEqual([]); // connecting never writes a read cursor
    act(() => socket.emit({ type: "message", conversationId: "conv-1", message: m("3", false, "odpowiedź"), cursor: "cur-3" }));
    act(() => socket.emit({ type: "message", conversationId: "conv-1", message: m("3", false, "odpowiedź"), cursor: "cur-3" }));
    expect(screen.getAllByText("odpowiedź")).toHaveLength(1); // deduplicated by id
    act(() => socket.emit({ type: "typing", conversationId: "conv-1", senderRole: "SUPERADMIN_AUTERVA", active: true }));
    expect(screen.getByText("Auterva pisze…")).toBeInTheDocument();
    act(() => socket.emit({ type: "read", conversationId: "conv-1", own: false, readerRole: "SUPERADMIN_AUTERVA", messageId: "2" }));
    expect(screen.getByText(/Przeczytano/)).toBeInTheDocument();
  });

  it("zerwanie łączy ponownie od ostatniego kursora, a 4401 nie łączy i prowadzi do logowania", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", false)])));
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => FakeSocket.instances[0].emit({ type: "message", conversationId: "conv-1", message: m("2", false), cursor: "cur-2" }));
    act(() => FakeSocket.instances[0].close(1006));
    expect(screen.getByText(/łączymy ponownie/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toContain("after=cur-2");
    act(() => FakeSocket.instances[1].close(4401));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(FakeSocket.instances).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Zaloguj się ponownie" })).toHaveAttribute("href", "/admin/login");
  });

  it("read dopiero po ok. 500 ms faktycznej widoczności najnowszej wiadomości drugiej strony", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let notify: ((entries: object[]) => void) | null = null;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: object[]) => void) { notify = callback; }
      observe() {} disconnect() {}
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", false, "pytanie")])));
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-1", backlog: "none", state: { ...state, unread: 1 } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(socket.sent).toEqual([]); // not visible yet: nothing is read
    act(() => notify?.([{ isIntersecting: true, intersectionRatio: 1 }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(socket.sent).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([{ type: "read", messageId: "1" }]);
  });

  it("nieudana wysyłka przeżywa przeładowanie: tekst wraca, ponowienie tym samym kluczem, bez auto-wysyłki", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let offline = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        keys.push(JSON.parse(String(init.body)).clientMessageId);
        if (offline) throw new TypeError("offline");
        return Response.json({ message: m("n1", true, "ważny tekst"), conversationId: "conv-1", deduplicated: true }, { status: 200 });
      }
      return Response.json(history([]));
    });
    const first = renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "ważny tekst");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(screen.getByText("Niepewny wynik wysyłki")).toBeInTheDocument());
    expect(loadPending("konto-a", "conv-1")?.body).toBe("ważny tekst");
    first.unmount(); // reload
    offline = false;
    renderChat();
    await waitFor(() => expect(screen.getByText("ważny tekst")).toBeInTheDocument());
    expect(screen.getByText("Niepewny wynik wysyłki")).toBeInTheDocument();
    expect(keys).toHaveLength(1); // nothing sent automatically
    await user.click(screen.getByRole("button", { name: "Ponów wysyłkę" }));
    await waitFor(() => expect(screen.getByText(/Wysłano/)).toBeInTheDocument());
    expect(keys[1]).toBe(keys[0]);
    expect(loadPending("konto-a", "conv-1")).toBeNull();
  });

  it.each([401, 502])("odpowiedź %i zostawia tekst w trwałym magazynie i ostrzega przy wyjściu", async (status) => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status }) : Response.json(history([])));
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "do zachowania");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(loadPending("konto-a", "conv-1")?.body).toBe("do zachowania"));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("własna wiadomość z WebSocket o tym samym clientMessageId zdejmuje dymek niepewnego wyniku", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status: 502 }) : Response.json(history([])));
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "abc");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(screen.getByText("Niepewny wynik wysyłki")).toBeInTheDocument());
    const key = loadPending("konto-a", "conv-1")!.clientMessageId;
    act(() => FakeSocket.instances[0].emit({ type: "message", conversationId: "conv-1", cursor: "c2", message: { ...m("n1", true, "abc"), clientMessageId: key } }));
    expect(screen.queryByText("Niepewny wynik wysyłki")).toBeNull();
    expect(loadPending("konto-a", "conv-1")).toBeNull();
  });

  it("429 z Retry-After blokuje ponowienie na podany czas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status: 429, headers: { "Retry-After": "5" } }) : Response.json(history([])));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "x");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    const blocked = await screen.findByRole("button", { name: "Poczekaj chwilę" });
    expect(blocked).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(screen.getByRole("button", { name: "Ponów wysyłkę" })).toBeEnabled();
  });

  it("read także dla wiadomości wyższej niż lista (zajmuje większość okna, ratio < 0,6)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let notify: ((entries: object[]) => void) | null = null;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: object[]) => void) { notify = callback; }
      observe() {} disconnect() {}
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", false, "x".repeat(3000))])));
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-1", backlog: "none", state: { ...state, unread: 1 } }));
    act(() => notify?.([{ isIntersecting: true, intersectionRatio: 0.2, rootBounds: { height: 500 }, intersectionRect: { height: 500 } }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([{ type: "read", messageId: "1" }]);
    // a barely visible slice of a tall message is still not "read"
    act(() => notify?.([{ isIntersecting: true, intersectionRatio: 0.02, rootBounds: { height: 500 }, intersectionRect: { height: 40 } }]));
  });

  it("nowa wiadomość nie przewija czytającego historię; akcja prowadzi do nowych", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", false, "stara")])));
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const log = screen.getByRole("log", { name: "Historia rozmowy" });
    Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 300, configurable: true });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    act(() => FakeSocket.instances[0].emit({ type: "message", conversationId: "conv-1", message: m("2", false, "nowa"), cursor: "cur-2" }));
    expect(log.scrollTop).toBe(100); // the reader is not moved
    await user.click(screen.getByRole("button", { name: /Nowe wiadomości \(1\)/ }));
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /Nowe wiadomości/ })).toBeNull();
  });

  // #393: too far behind (backlog "refetch"), the socket lives from the server head; the gap after the client's own cursor
  // comes over HTTP, page by page, before the cursor moves on.
  const order = () => [...document.querySelectorAll("[data-message-id]")].map((node) => node.getAttribute("data-message-id"));
  const gapPage = (ids: string[], newerCursor: string, hasNewer: boolean) => history(ids.map((id) => m(id, false)), { newerCursor, hasNewer });

  it("ready z backlog refetch: dociąga lukę od własnego kursora stronami, bez duplikatów, potem przyjmuje nowy kursor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queries: string[] = [];
    let releaseSecond: (() => void) | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const query = String(input).split("?")[1] ?? "";
      queries.push(query);
      if (query === "limit=30") return Response.json(history([m("1", false), m("2", false)], { newerCursor: "cur-2" }));
      if (query === "limit=100&after=cur-2") return Response.json(gapPage(["3", "4"], "cur-4", true));
      if (query === "limit=100&after=cur-4") {
        await new Promise<void>((resolve) => { releaseSecond = resolve; });
        return Response.json(gapPage(["5", "6"], "cur-6", false));
      }
      return Response.json(history([], { newerCursor: null }));
    });
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-head-6", backlog: "refetch", state }));
    await waitFor(() => expect(releaseSecond).not.toBeNull());
    // Live frames from the head arrive while the gap is still loading: they never land before it.
    act(() => socket.emit({ type: "message", conversationId: "conv-1", message: m("6", false), cursor: "cur-6" }));
    act(() => socket.emit({ type: "message", conversationId: "conv-1", message: m("7", false), cursor: "cur-7" }));
    await act(async () => { releaseSecond?.(); });
    await waitFor(() => expect(order()).toEqual(["1", "2", "3", "4", "5", "6", "7"]));
    expect(queries).toEqual(["limit=30", "limit=100&after=cur-2", "limit=100&after=cur-4"]);
    // The resume point is the newest message really on the list, not the head announced by ready.
    act(() => socket.close(1006));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(FakeSocket.instances[1].url).toContain("after=cur-7");
  });

  it("ready z backlog refetch bez nowszych wiadomości na żywo: kursor z ostatniej strony HTTP", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const query = String(input).split("?")[1] ?? "";
      if (query === "limit=30") return Response.json(history([m("1", false)], { newerCursor: "cur-1" }));
      if (query === "limit=100&after=cur-1") return Response.json(gapPage(["2", "3"], "cur-3", false));
      return Response.json(history([], { newerCursor: null }));
    });
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-head-3", backlog: "refetch", state }));
    await waitFor(() => expect(order()).toEqual(["1", "2", "3"]));
    act(() => socket.close(1006));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(FakeSocket.instances[1].url).toContain("after=cur-3");
  });

  it("błąd dociągania luki: komunikat, kursor bez zmian, ponowienie kończy uzupełnianie w dobrej kolejności", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let failing = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const query = String(input).split("?")[1] ?? "";
      if (query === "limit=30") return Response.json(history([m("1", false)], { newerCursor: "cur-1" }));
      if (query === "limit=100&after=cur-1") {
        if (failing) return new Response(null, { status: 503 });
        return Response.json(gapPage(["2", "3"], "cur-3", false));
      }
      return Response.json(history([], { newerCursor: null }));
    });
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-head-3", backlog: "refetch", state }));
    const alert = await screen.findByTestId("chat-gap-alert");
    expect(alert).toHaveTextContent("Nie udało się wczytać wiadomości z czasu rozłączenia.");
    // One announcement only: the polite status region, not a second role="alert".
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("status").some((region) => region.textContent === "Nie udało się wczytać wiadomości z czasu rozłączenia.")).toBe(true);
    // #411: pinned outside the scrolling history, so it never needs a scroll to be seen.
    expect(screen.getByRole("log", { name: "Historia rozmowy" })).not.toContainElement(alert);
    act(() => socket.emit({ type: "message", conversationId: "conv-1", message: m("4", false), cursor: "cur-4" }));
    expect(order()).toEqual(["1"]); // nothing after the gap is shown as if it were contiguous
    failing = false;
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(order()).toEqual(["1", "2", "3", "4"]));
    expect(screen.queryByTestId("chat-gap-alert")).toBeNull();
    expect(screen.getByText("Uzupełniono wiadomości z czasu rozłączenia.")).toBeInTheDocument();
    act(() => socket.close(1006));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(FakeSocket.instances[1].url).toContain("after=cur-4");
  });

  it("ready z backlog replay nie dociąga przez HTTP i zachowuje kursor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([m("1", false)], { newerCursor: "cur-1" })));
    renderChat();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];
    act(() => socket.emit({ type: "ready", protocol: 1, conversationId: "conv-1", cursor: "cur-1", backlog: "replay", state }));
    act(() => socket.emit({ type: "message", conversationId: "conv-1", message: m("2", false), cursor: "cur-2" }));
    expect(order()).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => socket.close(1006));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(FakeSocket.instances[1].url).toContain("after=cur-2");
  });

  it("wylogowanie usuwa szkice czatu z przeglądarki", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(history([])));
    renderChat();
    await waitFor(() => expect(screen.getByText(/Brak wiadomości/)).toBeInTheDocument());
    await user.type(screen.getByRole("textbox", { name: /Napisz wiadomość/ }), "szkic");
    expect(loadDraft("konto-a", "conv-1")).toBe("szkic");
    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    await waitFor(() => expect(loadDraft("konto-a", "conv-1")).toBe(""));
  });
});
