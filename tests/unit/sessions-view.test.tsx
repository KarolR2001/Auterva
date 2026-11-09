// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsView } from "../../src/components/account/sessions-view";
import { classifyEnd, endBody, endConfirmedByList, orderSessions, reauthBody, targetDescription, type SessionDto } from "../../src/components/account/sessions-model";

configure({ asyncUtilTimeout: 10_000 });
// The screen scenarios type codes and click several times; under a loaded machine 5 s is not enough.
const SLOW = 30_000;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const s = (id: string, over: Partial<SessionDto> = {}): SessionDto => ({ id, createdAt: "2026-11-08T10:00:00.000Z", lastActiveAt: "2026-11-09T10:00:00.000Z", device: "Chrome, macOS", current: false, ...over });
const proof = "a".repeat(64);

describe("model sesji konta (#73)", () => {
  it("bieżąca sesja jest pierwsza, ciało końca nazywa cel, dowód ma cel end-sessions", () => {
    expect(orderSessions([s("2"), s("1", { current: true, lastActiveAt: "2020-01-01T00:00:00.000Z" })])[0].id).toBe("1");
    expect(endBody(proof, { kind: "one", session: s("2") })).toEqual({ proof, sessionId: "2" });
    expect(endBody(proof, { kind: "others", count: 2 })).toEqual({ proof });
    expect(reauthBody("totp", "123 456")).toEqual({ method: "totp", code: "123456", purpose: "end-sessions" });
    expect(reauthBody("totp", "12")).toBeNull();
    expect(targetDescription({ kind: "others", count: 3 }).title).toMatch(/3/);
  });
  it("klasyfikuje wyniki: tylko 5xx bez MFA_RETRY jest niepewne", () => {
    expect(classifyEnd(200, { status: true, ended: 2 }, null)).toEqual({ kind: "ended", ended: 2 });
    expect(classifyEnd(404, {}, null).kind).toBe("already-gone");
    expect(classifyEnd(401, {}, null).kind).toBe("proof-rejected");
    expect(classifyEnd(503, { code: "MFA_RETRY" }, "1")).toEqual({ kind: "retry-same-proof", retryAfter: 1 });
    expect(classifyEnd(502, null, null).kind).toBe("uncertain");
    expect(classifyEnd(null, null, null).kind).toBe("uncertain");
  });
  it("niepewny wynik potwierdza dopiero lista z serwera", () => {
    const before = [s("1", { current: true }), s("2"), s("3")];
    expect(endConfirmedByList({ kind: "one", session: s("2") }, before, [s("1", { current: true }), s("3")])).toBe(true);
    expect(endConfirmedByList({ kind: "one", session: s("2") }, before, before)).toBe(false);
    expect(endConfirmedByList({ kind: "others", count: 2 }, before, [s("1", { current: true })])).toBe(true);
  });
});

function mockApi(handlers: { end?: () => Response; reauth?: () => Response; alive?: () => Response; lists: SessionDto[][] }) {
  let list = 0;
  const calls: { path: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (init?.method === "POST") {
      calls.push({ path, body: JSON.parse(String(init.body)) });
      if (path.includes("mfa/reauth")) return handlers.reauth?.() ?? Response.json({ proof });
      return handlers.end?.() ?? Response.json({ status: true, ended: 1 });
    }
    if (path.includes("get-session")) return handlers.alive?.() ?? Response.json({ session: { id: "1" } });
    const value = handlers.lists[Math.min(list, handlers.lists.length - 1)];
    list += 1;
    return Response.json({ sessions: value });
  });
  return calls;
}

describe("ekran sesji konta (#73)", () => {
  it("pokazuje bieżącą sesję bez akcji kończenia, bez IP, stan pusty gdy brak innych", async () => {
    mockApi({ lists: [[s("1", { current: true })]] });
    render(<SessionsView area="company" />);
    await waitFor(() => expect(screen.getByText("Ta sesja")).toBeInTheDocument());
    expect(screen.getByText("Brak innych aktywnych sesji.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zakończ/ })).toBeNull();
    expect(screen.getByText(/Bieżącą sesję kończy/)).toBeInTheDocument();
  }, SLOW);

  it("kończy wskazaną sesję po reauth z celem end-sessions; lista po sukcesie pochodzi z serwera", async () => {
    const user = userEvent.setup({ delay: null });
    const calls = mockApi({ lists: [[s("1", { current: true }), s("2")], [s("1", { current: true })]] });
    render(<SessionsView area="company" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Zakończ sesję: Chrome/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Zakończ sesję: Chrome/ }));
    expect(screen.getByRole("heading", { name: /Zakończyć sesję: Chrome, macOS/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Kod z aplikacji/), "123456");
    await user.click(screen.getByRole("button", { name: "Zakończ tę sesję" }));
    await waitFor(() => expect(screen.getByText("Zakończono 1 sesję.")).toBeInTheDocument());
    expect(calls.map((c) => c.path)).toEqual(["/api/auth/mfa/reauth/", "/api/auth/sessions/end/"]);
    expect(calls[0].body).toEqual({ method: "totp", code: "123456", purpose: "end-sessions" });
    expect(calls[1].body).toEqual({ proof, sessionId: "2" });
    expect(screen.queryByRole("button", { name: /Zakończ sesję: Chrome/ })).toBeNull();
    // Opener and confirmation are gone: focus stays on the status notice, not on <body>.
    await waitFor(() => expect(screen.getByText("Zakończono 1 sesję.").closest('[tabindex="-1"]')).toHaveFocus());
  }, SLOW);

  it("zły kod nic nie kończy; 503 MFA_RETRY ponawia z tym samym dowodem; 5xx potwierdza lista", async () => {
    const user = userEvent.setup({ delay: null });
    let attempt = 0;
    const calls = mockApi({
      lists: [[s("1", { current: true }), s("2")], [s("1", { current: true })]],
      reauth: () => (calls.filter((c) => c.path.includes("reauth")).length === 1 ? Response.json({}, { status: 401 }) : Response.json({ proof })),
      end: () => { attempt += 1; return attempt === 1 ? Response.json({ code: "MFA_RETRY" }, { status: 503, headers: { "Retry-After": "1" } }) : new Response(null, { status: 502 }); },
    });
    render(<SessionsView area="platform" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Zakończ sesję: Chrome/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Zakończ sesję: Chrome/ }));
    await user.type(screen.getByLabelText(/^Kod z aplikacji/), "111111");
    await user.click(screen.getByRole("button", { name: "Zakończ tę sesję" }));
    await waitFor(() => expect(screen.getByText(/Kod jest nieprawidłowy/)).toBeInTheDocument());
    expect(calls.some((c) => c.path.includes("sessions/end"))).toBe(false);
    await user.clear(screen.getByLabelText(/^Kod z aplikacji/));
    await user.type(screen.getByLabelText(/^Kod z aplikacji/), "222222");
    await user.click(screen.getByRole("button", { name: "Zakończ tę sesję" }));
    await waitFor(() => expect(screen.getByText("Usługa chwilowo zajęta.")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Zakończ tę sesję" }));
    await waitFor(() => expect(screen.getByText("Sesja została zakończona.")).toBeInTheDocument());
    const ends = calls.filter((c) => c.path.includes("sessions/end"));
    expect(ends).toHaveLength(2);
    expect(ends[1].body).toEqual(ends[0].body); // same proof reused, no second reauth
    expect(calls.filter((c) => c.path.includes("reauth"))).toHaveLength(2);
    await waitFor(() => expect(screen.getByText("Sesja została zakończona.").closest('[tabindex="-1"]')).toHaveFocus());
  }, SLOW);

  it("Escape zamyka potwierdzenie i oddaje fokus przyciskowi, który je otworzył", async () => {
    const user = userEvent.setup({ delay: null });
    mockApi({ lists: [[s("1", { current: true }), s("2")]] });
    render(<SessionsView area="company" />);
    const opener = await screen.findByRole("button", { name: /Zakończ sesję: Chrome/ });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: /Zakończyć sesję/ })).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  }, SLOW);

  async function openAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(screen.getByRole("button", { name: /Zakończ sesję: Chrome/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Zakończ sesję: Chrome/ }));
    await user.type(screen.getByLabelText(/^Kod z aplikacji/), "123456");
    await user.click(screen.getByRole("button", { name: "Zakończ tę sesję" }));
  }
  function stubLocation() {
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, replace });
    return replace;
  }

  it("401 z reauth po utracie sesji kończy się przekierowaniem na login, nie pętlą złego kodu", async () => {
    const replace = stubLocation();
    mockApi({ lists: [[s("1", { current: true }), s("2")]], reauth: () => Response.json({}, { status: 401 }), alive: () => new Response(null, { status: 401 }) });
    render(<SessionsView area="company" />);
    await openAndSubmit(userEvent.setup({ delay: null }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login?returnTo=%2Fadmin%2Fkonto%2F&session=expired"));
    expect(screen.queryByText(/Kod jest nieprawidłowy/)).toBeNull();
    vi.unstubAllGlobals();
  }, SLOW);

  it("401 z sessions/end po utracie sesji kończy się przekierowaniem; przy żywej sesji prosi o nowy kod", async () => {
    const replace = stubLocation();
    let alive = false;
    mockApi({ lists: [[s("1", { current: true }), s("2")]], end: () => Response.json({}, { status: 401 }),
      alive: () => (alive ? Response.json({ session: { id: "1" } }) : new Response(null, { status: 401 })) });
    render(<SessionsView area="platform" />);
    await openAndSubmit(userEvent.setup({ delay: null }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Fkonto%2F&session=expired"));
    cleanup();
    replace.mockClear();
    alive = true;
    render(<SessionsView area="platform" />);
    await openAndSubmit(userEvent.setup({ delay: null }));
    await waitFor(() => expect(screen.getByText("Potwierdzenie wygasło lub nie jest już ważne.")).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  }, SLOW);
});
