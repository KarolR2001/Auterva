// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountView } from "../../src/components/account/account-view";

const account = { name: "Ola Test", email: "ola@example.test", role: "ADMIN_FIRMY" };
const replace = vi.fn();
beforeEach(() => {
  replace.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, replace, reload: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function url(call: unknown[]) {
  return String(call[0]);
}

describe("konto: profil", () => {
  it("pokazuje e-mail i rolę tylko do odczytu, a zapisuje wyłącznie nazwę", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ name: "Ola Nowa" }));
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    expect(screen.getByText("ola@example.test")).toBeVisible();
    expect(screen.getByText("Administrator firmy")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /e-mail/i })).toBeNull();
    const name = screen.getByRole("textbox", { name: /Nazwa/ });
    await user.clear(name);
    await user.type(name, "Ola Nowa");
    await user.click(screen.getByRole("button", { name: "Zapisz nazwę" }));
    expect(await screen.findByText("Zapisano nazwę: Ola Nowa")).toBeVisible();
    expect(url(request.mock.calls[0])).toBe("/api/auth/profile/");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ name: "Ola Nowa" });
  });

  it("błąd serwera zachowuje wpisaną nazwę i nie ogłasza zapisu", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: "INVALID_REQUEST" }, { status: 400 }),
    );
    const user = userEvent.setup();
    render(<AccountView area="platform" account={{ ...account, role: "SUPERADMIN_AUTERVA" }} />);
    const name = screen.getByRole("textbox", { name: /Nazwa/ });
    await user.clear(name);
    await user.type(name, "X");
    await user.click(screen.getByRole("button", { name: "Zapisz nazwę" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nazwa musi mieć");
    expect(name).toHaveValue("X");
    expect(screen.queryByText(/Zapisano nazwę/)).toBeNull();
  });

  it("cofnięta sesja przy zapisie kieruje do logowania właściwego hosta", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json(null));
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "!");
    await user.click(screen.getByRole("button", { name: "Zapisz nazwę" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login?session=expired"));
  });
});

describe("konto: zmiana hasła", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Aktualne hasło"), "Stare haslo 12345!");
    await user.type(screen.getByLabelText("Nowe hasło"), "Nowe haslo 12345!");
    await user.type(screen.getByLabelText("Potwierdź nowe hasło"), "Nowe haslo 12345!");
  }

  it("ostrzega o wylogowaniu urządzeń i po potwierdzeniu serwera przechodzi do logowania", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ status: true, signInRequired: true }));
    const user = userEvent.setup();
    render(<AccountView area="platform" account={account} />);
    expect(screen.getByText(/wylogujemy Cię ze wszystkich urządzeń/)).toBeVisible();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?password=changed"));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      currentPassword: "Stare haslo 12345!",
      newPassword: "Nowe haslo 12345!",
    });
  });

  it("401 na zmianie hasła: do rozstrzygnięcia sesji nie ma banera, potem jeden komunikat przy polu", async () => {
    let release!: (response: Response) => void;
    const session = new Promise<Response>((resolve) => { release = resolve; });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }))
      .mockReturnValueOnce(session);
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); // the session is being asked
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Sprawdź aktualne hasło/)).toBeNull();
    release(Response.json({ session: { id: "s" }, user: { id: "u" } }));
    await waitFor(() => expect(screen.getByLabelText("Aktualne hasło")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByText("Aktualne hasło jest nieprawidłowe.")).toHaveLength(1);
    expect(screen.queryByRole("alert", { name: /./ })).toBeNull();
  });

  it("błędne aktualne hasło przy żywej sesji to błąd pola z aria-invalid i fokusem, bez banera", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ session: { id: "s" }, user: { id: "u" } }));
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    const current = screen.getByLabelText("Aktualne hasło");
    await waitFor(() => expect(current).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("Aktualne hasło jest nieprawidłowe.")).toBeVisible();
    expect(screen.queryByText(/Sprawdź aktualne hasło/)).toBeNull();
    await waitFor(() => expect(current).toHaveFocus());
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nowe hasło")).toHaveValue("Nowe haslo 12345!");
  });

  it("utrata odpowiedzi: żywa sesja oznacza brak zmiany, cofnięta sesja oznacza zmianę", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(Response.json({ session: { id: "s" }, user: { id: "u" } }));
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("hasło prawdopodobnie nie zostało zmienione");
    expect(replace).not.toHaveBeenCalled();
    request
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(Response.json(null));
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login?password=changed"));
  });

  it("5xx przy zmianie hasła jest wynikiem niepewnym rozstrzyganym odczytem sesji", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json(null));
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login?password=changed"));
  });

  it("po błędzie zapisu nazwy fokus wraca do pola", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: "INVALID_REQUEST" }, { status: 400 }),
    );
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    const name = screen.getByRole("textbox", { name: /Nazwa/ });
    await user.clear(name);
    await user.type(name, "X");
    await user.click(screen.getByRole("button", { name: "Zapisz nazwę" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("nie wysyła zbyt krótkiego ani niezgodnego hasła", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await user.type(screen.getByLabelText("Aktualne hasło"), "x");
    await user.type(screen.getByLabelText("Nowe hasło"), "krotkie");
    await user.type(screen.getByLabelText("Potwierdź nowe hasło"), "inne");
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    expect(await screen.findByText("Hasła muszą być identyczne")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("konto: MFA i wylogowanie", () => {
  it("nie ma wyłączenia MFA, a nowe kody prowadzą do świeżej weryfikacji", async () => {
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    expect(screen.queryByRole("button", { name: /wyłącz/i })).toBeNull();
    expect(screen.getByText("Włączone")).toBeVisible();
    expect(screen.getByRole("link", { name: "Wydaj nowe kody" })).toHaveAttribute(
      "href",
      "/admin/mfa?returnTo=%2Fadmin%2Fkonto&recoverCodes=1",
    );
    await user.click(screen.getByRole("button", { name: "Nie mam obu czynników" }));
    expect(screen.getByText(/ręcznej procedury właściciela/)).toBeVisible();
  });

  it("wylogowanie czeka na potwierdzenie serwera; błąd zostawia sesję i komunikat", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({}, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const user = userEvent.setup();
    render(<AccountView area="platform" account={account} />);
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sesja nadal jest aktywna");
    expect(replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(url(request.mock.calls[1])).toBe("/api/auth/sign-out/");
    expect(screen.queryByText("ola@example.test")).toBeNull();
  });
});

describe("konto: układ w powłoce panelu", () => {
  it("firma ma zakładki zamiast karty sesji, własny nagłówek h1 należy do powłoki", () => {
    render(<AccountView area="company" account={account} />);
    expect(screen.getByRole("navigation", { name: "Sekcje konta" })).toBeVisible();
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Bezpieczeństwo" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Aktywne sesje" })).toHaveLength(1);
  });
  it("platforma nie ma zakładek, ale zachowuje wejście do sesji jako akcję drugorzędną", () => {
    render(<AccountView area="platform" account={{ ...account, role: "SUPERADMIN_AUTERVA" }} />);
    expect(screen.queryByRole("navigation", { name: "Sekcje konta" })).toBeNull();
    expect(screen.getByRole("link", { name: "Aktywne sesje" })).toHaveAttribute("href", expect.stringMatching(/^\/konto\/sesje\/?$/));
  });
});
