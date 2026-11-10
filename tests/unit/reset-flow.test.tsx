// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResetRequestForm,
  SetNewPasswordForm,
} from "../../src/components/auth/reset-flow";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const token = "A".repeat(43);

describe("prośba o reset hasła", () => {
  it("pokazuje tekst pomocniczy i stopkę z makiety ADM-02, a po wysłaniu je ukrywa", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ accepted: true }));
    const user = userEvent.setup();
    render(<ResetRequestForm area="company" />);
    expect(screen.getByText("Adres przypisany do konta")).toBeVisible();
    expect(screen.getByText("Po wysłaniu zawsze pokażemy neutralne potwierdzenie.")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: /Adres e-mail/ }), "a@example.test");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    await screen.findByText("Jeśli konto z tym adresem istnieje, wyślemy instrukcję resetu hasła.");
    expect(screen.queryByText("Po wysłaniu zawsze pokażemy neutralne potwierdzenie.")).toBeNull();
  });

  it("pokazuje ten sam neutralny komunikat i link do logowania właściwego hosta", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ accepted: true }));
    const user = userEvent.setup();
    render(<ResetRequestForm area="company" />);
    await user.type(screen.getByRole("textbox", { name: /Adres e-mail/ }), "Ktos@Example.test");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    expect(
      await screen.findByText(
        "Jeśli konto z tym adresem istnieje, wyślemy instrukcję resetu hasła.",
      ),
    ).toBeVisible();
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.email).toBe("ktos@example.test");
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole("link", { name: "Wróć do logowania" })).toHaveAttribute("href", "/admin/login");
  });

  it("po sukcesie fokus przechodzi na tytuł, a po błędzie wraca do pola e-mail", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({}, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ accepted: true }));
    const user = userEvent.setup();
    render(<ResetRequestForm area="company" />);
    const email = screen.getByRole("textbox", { name: /Adres e-mail/ });
    await user.type(email, "ktos@example.test");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await waitFor(() => expect(email).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    await screen.findByText(/Link jest ważny 30 minut/);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus(),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ponawia ten sam klucz po utracie odpowiedzi, a nowy dla innego adresu", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    render(<ResetRequestForm area="platform" />);
    const field = screen.getByRole("textbox", { name: /Adres e-mail/ });
    await user.type(field, "a@example.test");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie wiemy, czy żądanie dotarło");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const keys = request.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(field).toHaveValue("a@example.test");
    expect(screen.queryByText(/wyślemy instrukcję resetu hasła\.$/)).not.toBeNull();
  });

  it("5xx po żądaniu pokazuje wynik niepewny i ponawia ten sam klucz", async () => {
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({}, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ accepted: true }));
    const user = userEvent.setup();
    render(<ResetRequestForm area="company" />);
    await user.type(screen.getByRole("textbox", { name: /Adres e-mail/ }), "a@example.test");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie wiemy, czy żądanie dotarło");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).idempotencyKey)
      .toBe(JSON.parse(String(request.mock.calls[1][1]?.body)).idempotencyKey);
  });

  it("limit blokuje ponowienie i nie pokazuje sukcesu", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "30" } }),
    );
    const user = userEvent.setup();
    render(<ResetRequestForm area="company" />);
    await user.type(screen.getByRole("textbox", { name: /Adres e-mail/ }), "a@example.test");
    await user.click(screen.getByRole("button", { name: "Wyślij link resetujący" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Limit prób");
    expect(screen.getByRole("button", { name: "Ponów po limicie" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ustawienie nowego hasła", () => {
  it("pokazuje wstęp, ostrzeżenie o wylogowaniu i stopkę z makiety ADM-03", () => {
    render(<SetNewPasswordForm area="company" token={token} />);
    expect(screen.getByText("Użyj unikalnego hasła i zapisz je w bezpiecznym menedżerze.")).toBeVisible();
    expect(screen.getByText("Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń. Zalogujesz się nowym hasłem i kodem MFA.")).toBeVisible();
    expect(screen.queryByText(/Token aktywny/)).toBeNull();
    expect(screen.getByText("Link jednorazowy • po zapisie wrócisz do logowania")).toBeVisible();
  });

  it("blokuje zbyt krótkie i niezgodne hasło przed wysłaniem", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<SetNewPasswordForm area="company" token={token} />);
    await user.type(screen.getByLabelText("Nowe hasło"), "krotkie");
    await user.type(screen.getByLabelText("Powtórz hasło"), "inne");
    await user.click(screen.getByRole("button", { name: "Ustaw nowe hasło" }));
    expect(await screen.findByText("Hasło musi mieć od 12 do 256 znaków")).toBeVisible();
    expect(screen.getByText("Hasła muszą być identyczne")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nowe hasło")).toHaveAttribute("autocomplete", "new-password");
  });

  it("po sukcesie kieruje do logowania właściwego hosta", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ status: true, signInRequired: true }));
    const user = userEvent.setup();
    render(<SetNewPasswordForm area="platform" token={token} />);
    await user.type(screen.getByLabelText("Nowe hasło"), "Dlugie haslo 12345!");
    await user.type(screen.getByLabelText("Powtórz hasło"), "Dlugie haslo 12345!");
    await user.click(screen.getByRole("button", { name: "Ustaw nowe hasło" }));
    expect(await screen.findByRole("heading", { name: "Hasło zostało zmienione" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Przejdź do logowania" })).toHaveAttribute("href", "/login");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      token,
      newPassword: "Dlugie haslo 12345!",
    });
  });

  it("użyty lub wygasły link pokazuje stan bez pól i drogę do nowego linku", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }),
    );
    const user = userEvent.setup();
    render(<SetNewPasswordForm area="company" token={token} />);
    await user.type(screen.getByLabelText("Nowe hasło"), "Dlugie haslo 12345!");
    await user.type(screen.getByLabelText("Powtórz hasło"), "Dlugie haslo 12345!");
    await user.click(screen.getByRole("button", { name: "Ustaw nowe hasło" }));
    expect(await screen.findByRole("heading", { name: "Link nie działa" })).toBeVisible();
    expect(screen.queryByLabelText("Nowe hasło")).toBeNull();
    expect(screen.getByRole("link", { name: "Poproś o nowy link" })).toHaveAttribute("href", "/admin/reset-hasla");
  });

  it("źle sformatowany token od razu pokazuje wygasły link", () => {
    render(<SetNewPasswordForm area="company" token="zly" />);
    expect(screen.getByRole("heading", { name: "Link nie działa" })).toBeVisible();
  });

  it("utrata połączenia zachowuje pola i nie ogłasza sukcesu", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();
    render(<SetNewPasswordForm area="company" token={token} />);
    await user.type(screen.getByLabelText("Nowe hasło"), "Dlugie haslo 12345!");
    await user.type(screen.getByLabelText("Powtórz hasło"), "Dlugie haslo 12345!");
    await user.click(screen.getByRole("button", { name: "Ustaw nowe hasło" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie wiemy, czy hasło zostało zmienione");
    expect(screen.getByLabelText("Nowe hasło")).toHaveValue("Dlugie haslo 12345!");
  });

  it("5xx po zmianie hasła zachowuje pola i pokazuje wynik niepewny", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}, { status: 502 }));
    const user = userEvent.setup();
    render(<SetNewPasswordForm area="company" token={token} />);
    await user.type(screen.getByLabelText("Nowe hasło"), "Dlugie haslo 12345!");
    await user.type(screen.getByLabelText("Powtórz hasło"), "Dlugie haslo 12345!");
    await user.click(screen.getByRole("button", { name: "Ustaw nowe hasło" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie wiemy, czy hasło zostało zmienione");
    expect(screen.getByLabelText("Nowe hasło")).toHaveValue("Dlugie haslo 12345!");
    await waitFor(() => expect(screen.getByLabelText("Nowe hasło")).toHaveFocus());
  });
});
