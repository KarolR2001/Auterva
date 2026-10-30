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

  it("błędne aktualne hasło przy żywej sesji zostaje na stronie z komunikatem", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ session: { id: "s" }, user: { id: "u" } }));
    const user = userEvent.setup();
    render(<AccountView area="company" account={account} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sprawdź aktualne hasło");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Hasło nie zostało zmienione");
    expect(replace).not.toHaveBeenCalled();
    request
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(Response.json(null));
    await user.click(screen.getByRole("button", { name: "Zmień hasło" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/login?password=changed"));
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
