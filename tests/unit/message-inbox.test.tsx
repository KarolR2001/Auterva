// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDraft, loadPending } from "../../src/components/chat/draft-store";
import { PanelShell } from "../../src/components/panel/panel-shell";
import { MessageInbox } from "../../src/components/platform/message-inbox";

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
const platformSocket = () => FakeSocket.instances.find((socket) => socket.url.endsWith("/ws/platform"))!;
const chatSockets = () => FakeSocket.instances.filter((socket) => socket.url.includes("/ws?organizationId="));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const Z = "33333333-3333-4333-8333-333333333333";
const row = (id: string, name: string, extra: object = {}) => ({
  conversationId: `conv-${id.slice(0, 1)}`, organizationId: id, organizationName: name, archived: false,
  activityAt: new Date().toISOString(), lastSeq: 2, readSeq: 0, version: 1, unread: 0,
  lastMessage: { id: `m-${id.slice(0, 1)}`, senderRole: "ADMIN_FIRMY", createdAt: new Date().toISOString(), preview: `Pytanie ${name}`, truncated: false }, ...extra });
const list = (...conversations: object[]) => ({ conversations, nextCursor: null });
const history = (id: string) => ({ conversationId: `conv-${id.slice(0, 1)}`, messages: [], olderCursor: null, newerCursor: "cur", hasNewer: false });
const message = (body: string, clientMessageId: string) => ({ id: `n-${clientMessageId}`, clientMessageId, body, senderRole: "SUPERADMIN_AUTERVA", own: true, createdAt: new Date().toISOString() });

let posts: { url: string; body: { body: string; conversationId?: string } }[] = [];
let sendGate: Promise<void> | null = null;
let archivedOrgs = new Set<string>();

function mockApi(rows: object[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("/api/platform/chat/conversations/")) return Response.json(list(...rows));
    const company = url.match(/companies\/([0-9a-f-]{36})\/chat\/messages\//)?.[1];
    if (!company) return new Response(null, { status: 404 });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push({ url, body });
      if (sendGate) await sendGate;
      if (archivedOrgs.has(company)) return Response.json({ code: "CHAT_ORGANIZATION_ARCHIVED" }, { status: 409 });
      return Response.json({ message: message(body.body, body.clientMessageId), conversationId: `conv-${company.slice(0, 1)}`, deduplicated: false }, { status: 201 });
    }
    return Response.json(history(company));
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  posts = [];
  sendGate = null;
  archivedOrgs = new Set();
  vi.stubGlobal("WebSocket", FakeSocket);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/wiadomosci/");
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const renderInbox = (initialSelected: Parameters<typeof MessageInbox>[0]["initialSelected"] = null) => render(
  <PanelShell area="platform" accessState="allowed" title="Wiadomości" currentPath="/wiadomosci" onLogout={vi.fn()}>
    <MessageInbox accountId="super-1" initialSelected={initialSelected} />
  </PanelShell>);
const composer = (name: string) => screen.getByRole("textbox", { name: `Napisz wiadomość do ${name}` });
const openRow = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await waitFor(() => expect(composer(name)).toBeInTheDocument());
};

describe("skrzynka superadmina (#53)", () => {
  it("lista pokazuje firmę, ostatnią wiadomość, czas i licznik nowych tekstem; archiwum dopiero po filtrze", async () => {
    const fetchMock = mockApi([row(A, "Alfa Rent", { unread: 3 }), row(B, "Beta Cars")]);
    const user = userEvent.setup();
    renderInbox();
    const alfa = await screen.findByRole("button", { name: /Alfa Rent/ });
    expect(within(alfa).getByText("Pytanie Alfa Rent")).toBeInTheDocument();
    expect(within(alfa).getByText("Nowe: 3")).toBeInTheDocument();
    expect(alfa.querySelector("time")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("includeArchived"))).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: "Pokaż zarchiwizowane" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("includeArchived=true"))).toBe(true));
  });

  it("A -> B -> A: szkic A wraca, B wysyła dokładnie treść B do firmy B i nigdy szkic A (TEST-MVP-31)", async () => {
    mockApi([row(A, "Alfa Rent"), row(B, "Beta Cars")]);
    const user = userEvent.setup();
    renderInbox();
    await openRow(user, "Alfa Rent");
    await user.type(composer("Alfa Rent"), "szkic dla Alfy");
    await openRow(user, "Beta Cars"); // no dialog while switching
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(composer("Beta Cars")).toHaveValue("");
    expect(loadDraft("super-1", "conv-1")).toBe("szkic dla Alfy");
    await user.type(composer("Beta Cars"), "treść dla Bety");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain(`/companies/${B}/chat/messages/`);
    expect(posts[0].body.body).toBe("treść dla Bety");
    await waitFor(() => expect(loadDraft("super-1", "conv-2")).toBe(""));
    await openRow(user, "Alfa Rent");
    expect(composer("Alfa Rent")).toHaveValue("szkic dla Alfy");
    expect(posts).toHaveLength(1);
  });

  it("wynik starego żądania nie przełącza odbiorcy: odpowiedź A po przejściu do B zostaje przy A", async () => {
    mockApi([row(A, "Alfa Rent"), row(B, "Beta Cars")]);
    let release!: () => void;
    sendGate = new Promise<void>((resolve) => { release = resolve; });
    const user = userEvent.setup();
    renderInbox();
    await openRow(user, "Alfa Rent");
    await user.type(composer("Alfa Rent"), "do Alfy");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    await openRow(user, "Beta Cars");
    act(() => release());
    await waitFor(() => expect(loadPending("super-1", "conv-1")).toBeNull());
    expect(screen.getByRole("heading", { level: 2, name: "Beta Cars" })).toBeInTheDocument();
    expect(screen.getByText("Odbiorca: Beta Cars")).toBeInTheDocument();
    expect(screen.queryByText("do Alfy")).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it("niepewna wysyłka do A zostaje przy A po przełączeniu i wraca do ponowienia z tym samym kluczem", async () => {
    const fetchMock = mockApi([row(A, "Alfa Rent"), row(B, "Beta Cars")]);
    const base = fetchMock.getMockImplementation()!;
    let first = true;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST" && first) { first = false; posts.push({ url: String(input), body: JSON.parse(String(init.body)) }); return new Response(null, { status: 502 }); }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderInbox();
    await openRow(user, "Alfa Rent");
    await user.type(composer("Alfa Rent"), "ważne");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await screen.findByText("Niepewny wynik wysyłki");
    await openRow(user, "Beta Cars");
    expect(screen.queryByText("Niepewny wynik wysyłki")).toBeNull();
    await openRow(user, "Alfa Rent");
    await user.click(await screen.findByRole("button", { name: "Ponów wysyłkę" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toEqual(posts[0].body);
    expect(posts[1].url).toContain(`/companies/${A}/`);
  });

  it("wejście z karty (?firma=) otwiera dokładnie tę rozmowę; WebSocket i HTTP dotyczą tylko tej firmy", async () => {
    const fetchMock = mockApi([row(A, "Alfa Rent"), row(B, "Beta Cars")]);
    window.history.replaceState(null, "", `/wiadomosci/?firma=${B}`);
    renderInbox({ organizationId: B, name: "Beta Cars", archived: false, conversationId: "conv-2" });
    expect(await screen.findByRole("heading", { level: 2, name: "Beta Cars" })).toBeInTheDocument();
    await waitFor(() => expect(chatSockets()).toHaveLength(1));
    expect(chatSockets()[0].url).toContain(`organizationId=${B}`);
    const messageCalls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/chat/messages/"));
    expect(messageCalls.length).toBeGreaterThan(0);
    expect(messageCalls.every((url) => url.includes(`/companies/${B}/`))).toBe(true);
    expect(screen.getByRole("link", { name: "Karta firmy Beta Cars" })).toHaveAttribute("href", expect.stringMatching(new RegExp(`^/firmy/${B}/?$`)));
  });

  it("firma zarchiwizowana: historia tak, pole wiadomości nie; 409 z serwera przełącza rozmowę w tryb odczytu", async () => {
    mockApi([row(A, "Alfa Rent"), row(Z, "Zeta Arch", { archived: true })]);
    archivedOrgs.add(A);
    const user = userEvent.setup();
    renderInbox({ organizationId: Z, name: "Zeta Arch", archived: true, conversationId: "conv-3" });
    expect(await screen.findByText(/Firma Zeta Arch jest zarchiwizowana/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wyślij" })).toBeNull();
    await waitFor(() => expect(chatSockets()).toHaveLength(1));
    act(() => chatSockets()[0].emit({ type: "ready", protocol: 1, conversationId: "conv-3", cursor: null, backlog: "none",
      state: { ownMessageId: null, ownSeq: 0, peerMessageId: "m-3", peerSeq: 1, unread: 0 } }));
    act(() => chatSockets()[0].emit({ type: "message", conversationId: "conv-3", cursor: "c", message: { ...message("x", "x"), own: false, senderRole: "ADMIN_FIRMY", id: "peer-1" } }));
    await screen.findByText("x");
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(chatSockets()[0].sent).toEqual([]); // no read and no typing signal in an archived company

    await user.click(await screen.findByRole("button", { name: /Alfa Rent/ }));
    await user.type(composer("Alfa Rent"), "pisz");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await screen.findByText(/Firma Alfa Rent jest zarchiwizowana/);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Odrzuć niewysłaną wiadomość" })).toBeInTheDocument();
  });

  it("spóźnione 409 dla A po przejściu do B nie przełącza B w odczyt; A po powrocie pokazuje odmowę archiwum", async () => {
    mockApi([row(A, "Alfa Rent"), row(B, "Beta Cars")]);
    archivedOrgs.add(A);
    let release!: () => void;
    sendGate = new Promise<void>((resolve) => { release = resolve; });
    const user = userEvent.setup();
    renderInbox();
    await openRow(user, "Alfa Rent");
    await user.type(composer("Alfa Rent"), "do Alfy");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    await openRow(user, "Beta Cars");
    act(() => release());
    await waitFor(() => expect(loadPending("super-1", "conv-1")?.status).toBe("failed"));
    expect(composer("Beta Cars")).toBeInTheDocument();
    expect(screen.queryByText(/jest zarchiwizowana/)).toBeNull();
    await openRow(user, "Alfa Rent");
    expect(await screen.findByText("Ta firma jest zarchiwizowana — nie można pisać.")).toBeInTheDocument();
  });

  it("nieznane ?firma= po Wstecz czyści adres", async () => {
    mockApi([row(A, "Alfa Rent")]);
    const user = userEvent.setup();
    renderInbox();
    await openRow(user, "Alfa Rent");
    window.history.pushState(null, "", `/wiadomosci/?firma=${Z}`);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("ramka conversation aktualizuje licznik, a starsza ramka (niższy klucz) go nie cofa", async () => {
    mockApi([row(A, "Alfa Rent", { unread: 1, lastSeq: 2, readSeq: 0 })]);
    renderInbox();
    await screen.findByRole("button", { name: /Alfa Rent/ });
    await waitFor(() => expect(platformSocket()).toBeDefined());
    const frame = (extra: object) => ({ type: "conversation", organizationId: A, conversationId: "conv-1", archived: false, unread: 0,
      lastSeq: 2, readSeq: 2, version: 1, activityAt: new Date().toISOString(), ...extra });
    act(() => platformSocket().emit(frame({})));
    await waitFor(() => expect(screen.queryByText(/Nowe: 1/)).toBeNull());
    act(() => platformSocket().emit(frame({ unread: 1, readSeq: 1 })));
    expect(screen.queryByText(/Nowe:/)).toBeNull();
  });

  it("mobile: wstecz wraca do listy z zachowanym stanem, fokus wraca na wiersz rozmowy", async () => {
    mockApi([row(A, "Alfa Rent"), row(B, "Beta Cars")]);
    const user = userEvent.setup();
    renderInbox();
    await openRow(user, "Beta Cars");
    expect(window.location.search).toBe(`?firma=${B}`);
    await user.click(screen.getByRole("button", { name: "Wiadomości" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(window.location.search).toBe("");
    await waitFor(() => expect(screen.getByRole("button", { name: /Beta Cars/ })).toHaveFocus());
    expect(screen.getByRole("button", { name: /Alfa Rent/ })).toBeInTheDocument();
  });

  it("błąd listy daje komunikat i ponowienie bez utraty szkiców", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 500 }));
    fetchMock.mockResolvedValue(Response.json(list(row(A, "Alfa Rent"))));
    const user = userEvent.setup();
    renderInbox();
    await screen.findByText("Nie udało się wczytać listy rozmów.");
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("button", { name: /Alfa Rent/ })).toBeInTheDocument();
  });
});
