// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm, MfaFlow } from "../../src/components/auth/auth-flow";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("logowanie na właściwym hoście", () => {
  it("nie ujawnia konta po odmowie i zachowuje wklejone hasło", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }),
      );
    const user = userEvent.setup();
    render(<LoginForm area="company" companyName="Firma Alfa" />);

    expect(
      screen.getByRole("heading", { name: "Zaloguj się do panelu" }),
    ).toBeVisible();
    expect(screen.getByText("Panel administratora")).toBeVisible();
    // The accessible name equals the visible label, so voice control can target it.
    const email = screen.getByRole("textbox", { name: "E-mail" });
    const password = screen.getByLabelText("Hasło");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    // No public registration (MVP 3.1); the reset link "Nie pamiętasz hasła? Zresetuj je" exists since the reset flow.
    expect(
      screen.queryByRole("link", { name: /rejestracj/i }),
    ).toBeNull();

    await user.type(email, "admin@example.test");
    await user.type(password, "PoprawneHasło123!");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się zalogować. Sprawdź dane i spróbuj ponownie.",
    );
    expect(screen.queryByText(/konto istnieje|konto nie istnieje/i)).toBeNull();
    expect(password).toHaveValue("PoprawneHasło123!");
    expect(request).toHaveBeenCalledWith(
      "/api/auth/sign-in/email/",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          email: "admin@example.test",
          password: "PoprawneHasło123!",
        }),
      }),
    );
  });

  it("nie wysyła drugiej próby, gdy pierwszy submit trwa", async () => {
    let complete!: (response: Response) => void;
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<LoginForm area="platform" />);
    await user.type(
      screen.getByRole("textbox", { name: "Adres e-mail" }),
      "admin@example.test",
    );
    await user.type(screen.getByLabelText("Hasło"), "PoprawneHasło123!");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(screen.getByRole("button", { name: "Logowanie…" })).toBeDisabled();
    expect(request).toHaveBeenCalledTimes(1);
    complete(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeEnabled(),
    );
  });

  it("awarię serwera odróżnia od błędnych danych, zachowując formularz", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({}, { status: 500 }),
    );
    const user = userEvent.setup();
    render(<LoginForm area="company" />);
    await user.type(
      screen.getByRole("textbox", { name: "E-mail" }),
      "admin@example.test",
    );
    await user.type(
      screen.getByLabelText("Hasło", { exact: true }),
      "PoprawneHasło123!",
    );
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /usługa|spróbuj ponownie/i,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /sprawdź dane/i,
    );
    expect(screen.getByLabelText("Hasło", { exact: true })).toHaveValue(
      "PoprawneHasło123!",
    );
  });
});

describe("obowiązkowe MFA", () => {
  it("respektuje pełne Retry-After z serwera", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "900" } },
      ),
    );
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ponów za 900 s.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Limit prób. Odczekaj czas podany przez usługę przed kolejną próbą.",
    );
    expect(
      screen.getByRole("button", { name: "Ponów po limicie" }),
    ).toBeDisabled();
  });

  it("po utracie odpowiedzi challenge sprawdza sesję zamiast ponawiać kod", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({ session: { id: "s1" } }));
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(
      await screen.findByRole("button", { name: "Sprawdź stan" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Sprawdź stan MFA" }),
    ).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Potwierdź kod" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sprawdź stan" }));
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/auth/get-session/",
      expect.objectContaining({ method: "GET" }),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("po utracie odpowiedzi powtórnego challenge zachowuje zamiar odzyskania kodów", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("challenge response lost"))
      .mockResolvedValueOnce(Response.json({ session: { id: "s1" } }));
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" recoverCodes />);
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    await user.click(
      await screen.findByRole("button", { name: "Sprawdź stan" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Wydaj nowe kody",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Kod MFA" })).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("po utracie odpowiedzi recovery nie zużywa drugi raz kodu", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.click(
      screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Kod odzyskania" }),
      "kod-1",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(
      await screen.findByRole("button", { name: "Sprawdź stan" }),
    ).toBeVisible();
    expect(screen.getByText(/nie wiadomo, czy operacja została zakończona/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sprawdź stan" }));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/auth/get-session/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("przy awarii sieci przed zapisem nie zakłada sukcesu i nie ponawia POST", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline before write"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="challenge" />);
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(
      await screen.findByRole("button", { name: "Sprawdź stan" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sprawdź stan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /nie udało się sprawdzić sesji.*wynik nadal jest niepotwierdzony/i,
    );
    expect(
      screen.getByRole("button", { name: "Ponów odczyt sesji" }),
    ).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: "Kod MFA" })).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/auth/get-session/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("potwierdzona odmowa MFA zachowuje formularz bez przejścia do niepewnego stanu", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{", { status: 401 }),
    );
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kod jest nieprawidłowy lub wygasł. Wpisz aktualny kod z aplikacji.",
    );
    expect(
      screen.getByRole("textbox", { name: "Kod MFA" }),
    ).toHaveValue("123456");
    expect(screen.queryByRole("button", { name: "Sprawdź stan" })).toBeNull();
  });

  it("po nieczytelnym JSON enrollment nie ponawia TOTP i wymaga świeżej rotacji kodów", async () => {
    const unreadable = new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          totpURI: "otpauth://totp/Auterva?secret=ABCDEF123456",
        }),
      )
      .mockResolvedValueOnce(unreadable)
      .mockResolvedValueOnce(Response.json({ session: { id: "s1" } }))
      .mockResolvedValueOnce(Response.json({ proof: "a".repeat(64) }))
      .mockResolvedValueOnce(
        Response.json({ status: true, backupCodes: ["nowy-kod-1"] }),
      );
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="enroll" />);
    await user.type(screen.getByLabelText("Potwierdź hasło"), "Hasło123!");
    await user.click(
      screen.getByRole("button", { name: "Rozpocznij konfigurację" }),
    );
    await screen.findByText("ABCD EF12 3456");
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Włącz MFA i pokaż kody" }));
    expect(
      await screen.findByRole("button", { name: "Sprawdź stan" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sprawdź stan" }));
    expect(await screen.findByText(/poprzednia lista nie jest dostępna/i)).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }),
      "654321",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    await user.type(await screen.findByLabelText("Hasło"), "Hasło123!");
    await user.click(screen.getByRole("button", { name: "Wydaj nowe kody" }));
    expect(await screen.findByText("nowy-kod-1")).toBeVisible();
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/api/auth/mfa/reauth/",
      expect.objectContaining({
        body: JSON.stringify({ method: "totp", code: "654321" }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      5,
      "/api/auth/mfa/rotate-backup-codes/",
      expect.objectContaining({
        body: JSON.stringify({ password: "Hasło123!", proof: "a".repeat(64) }),
      }),
    );
  });

  it("po utracie odpowiedzi rotacji wymaga nowego czynnika i nie ponawia proof", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ proof: "a".repeat(64) }))
      .mockRejectedValueOnce(new TypeError("rotation response lost"))
      .mockResolvedValueOnce(Response.json({ session: { id: "s1" } }))
      .mockResolvedValueOnce(Response.json({ proof: "b".repeat(64) }));
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="restore" />);
    await user.type(
      screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    await user.type(await screen.findByLabelText("Hasło"), "Hasło123!");
    await user.click(screen.getByRole("button", { name: "Wydaj nowe kody" }));
    expect(
      await screen.findByRole("button", { name: "Sprawdź stan" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sprawdź stan" }));
    expect(
      await screen.findByRole("textbox", { name: "Nowy kod z aplikacji" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Wydaj nowe kody" }),
    ).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }),
      "654321",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/api/auth/mfa/reauth/",
      expect.objectContaining({
        body: JSON.stringify({ method: "totp", code: "654321" }),
      }),
    );
  });

  it("po odmowie zużytego proof wraca do świeżego czynnika", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ proof: "a".repeat(64) }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="restore" />);
    await user.type(
      screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    await user.type(await screen.findByLabelText("Hasło"), "Hasło123!");
    await user.click(screen.getByRole("button", { name: "Wydaj nowe kody" }));
    expect(
      await screen.findByRole("heading", { name: "Weryfikacja wygasła" }),
    ).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Potwierdzenie wygasło lub zostało odrzucone.",
    );
    expect(screen.queryByLabelText("Hasło")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ponów weryfikację" }));
    expect(
      screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }),
    ).toHaveValue("");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("odróżnia zajęty czynnik od błędnego kodu odzyskania", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { code: "MFA_BUSY" },
          { status: 409, headers: { "Retry-After": "1" } },
        ),
      );
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.click(
      screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Kod odzyskania" }),
      "abc-def-123",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /inna operacja MFA|spróbuj ponownie/i,
    );
    expect(screen.queryByText(/nieprawidłowy lub został użyty/i)).toBeNull();
    expect(request).toHaveBeenCalledWith(
      "/api/auth/two-factor/verify-backup-code/",
      expect.objectContaining({
        body: JSON.stringify({ code: "abc-def-123", trustDevice: false }),
      }),
    );
  });

  it("pokazuje kody odzyskania dopiero po potwierdzonym enrolmencie", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          totpURI: "otpauth://totp/Auterva?secret=ABCDEF123456",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ status: true, backupCodes: ["kod-1", "kod-2"] }),
      );
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="enroll" />);
    expect(screen.queryByText("kod-1")).toBeNull();
    await user.type(
      screen.getByLabelText("Potwierdź hasło"),
      "PoprawneHasło123!",
    );
    await user.click(
      screen.getByRole("button", { name: "Rozpocznij konfigurację" }),
    );
    expect(await screen.findByText("ABCD EF12 3456")).toBeVisible();
    expect(screen.queryByText("kod-1")).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Kod MFA" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Włącz MFA i pokaż kody" }));
    expect(await screen.findByText("kod-1")).toBeVisible();
    expect(screen.getByText("kod-2")).toBeVisible();
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/auth/two-factor/verify-totp/",
      expect.objectContaining({
        body: JSON.stringify({ code: "123456", trustDevice: false }),
      }),
    );
  });

  it("pokazuje lokalny kod QR do enrollmentu bez usługi zewnętrznej", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        totpURI: "otpauth://totp/Auterva:test?secret=ABCDEF123456&issuer=Auterva",
      }),
    );
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="enroll" />);
    await user.type(screen.getByLabelText("Potwierdź hasło"), "Hasło123!");
    await user.click(
      screen.getByRole("button", { name: "Rozpocznij konfigurację" }),
    );
    expect(await screen.findByRole("img", { name: "Kod QR do konfiguracji MFA" })).toBeVisible();
    expect(screen.getByText("ABCD EF12 3456")).toBeVisible();
    expect(document.querySelector('img[src^="http"]')).toBeNull();
  });

  it("z posiadanego kodu odróżnia ręczną pomoc po utracie obu czynników", async () => {
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.click(
      screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }),
    );
    expect(screen.getByRole("textbox", { name: "Kod odzyskania" })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Nie mam aplikacji ani kodów" }),
    );
    expect(
      screen.getByRole("heading", { name: "Nie masz dostępu do kodów?" }),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Kod odzyskania" })).toBeNull();
    expect(screen.getByText(/ręcznego potwierdzenia tożsamości/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Wróć do kodu odzyskania" }));
    expect(screen.getByRole("textbox", { name: "Kod odzyskania" })).toBeVisible();
  });
});

describe("stany odzyskiwania i dostępności MFA (#132)", () => {
  const replace = () => {
    const spy = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      replace: spy,
    } as Location);
    return spy;
  };

  it("nazwa dostępna każdego pola zawiera widoczną etykietę, bez nadpisania aria-label", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<LoginForm area="platform" />);
    expect(screen.getByRole("textbox", { name: "Adres e-mail" })).not.toHaveAttribute("aria-label");
    unmount();
    render(<MfaFlow area="company" initialMode="challenge" />);
    const code = screen.getByRole("textbox", { name: "Kod MFA" });
    expect(code).toHaveAccessibleName("Kod MFA");
    expect(code).not.toHaveAttribute("aria-label");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAccessibleDescription("Kod jest ważny tylko przez krótki czas");
    await user.click(screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }));
    const recovery = screen.getByRole("textbox", { name: "Kod odzyskania" });
    expect(recovery).not.toHaveAttribute("aria-label");
    expect(recovery).toHaveAccessibleDescription("Kod jest jednorazowy");
  });

  it("obsługuje challenge klawiaturą: kolejność fokusu, Enter i fokus na nagłówku nowego kroku", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }));
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="challenge" returnTo="/firmy" />);
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Kod MFA" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Potwierdź kod" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Wróć do logowania" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Ffirmy",
    );
    await user.click(screen.getByRole("textbox", { name: "Kod MFA" }));
    await user.paste("123456");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Kod jest nieprawidłowy lub wygasł");
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Kod MFA" })).toHaveValue("123456");
    screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Użyj kodu odzyskania" })).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("kod odzyskania prowadzi przez hasło, nowy TOTP i nową listę kodów do panelu", async () => {
    const navigate = replace();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ enrollmentRequired: true }))
      .mockResolvedValueOnce(
        Response.json({ method: "totp", totpURI: "otpauth://totp/Auterva:a?secret=NEWSECRET234&issuer=Auterva" }),
      )
      .mockResolvedValueOnce(Response.json({ status: true, backupCodes: ["nowy-1", "nowy-2"] }));
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" returnTo="/admin/pojazdy" />);
    await user.click(screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }));
    expect(screen.getByText("Weryfikacja MFA")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Kod odzyskania" }), "abcd-efgh");
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByRole("heading", { name: "Potwierdź hasło" })).toHaveFocus();
    expect(screen.getByText(/kod odzyskania został przyjęty/i)).toBeVisible();
    await user.type(screen.getByLabelText("Hasło"), "Hasło123!");
    await user.click(screen.getByRole("button", { name: "Potwierdź hasło" }));
    expect(await screen.findByText("NEWS ECRE T234")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Kod MFA" }), "123456");
    await user.click(screen.getByRole("button", { name: "Włącz MFA i pokaż kody" }));
    expect(await screen.findByRole("heading", { name: "Zapisz kody odzyskania" })).toHaveFocus();
    expect(screen.getByRole("list")).toHaveTextContent("nowy-1nowy-2");
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Zapisałem kody" }));
    expect(navigate).toHaveBeenCalledWith("/admin/pojazdy");
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/two-factor/verify-backup-code/",
      "/api/auth/two-factor/enable/",
      "/api/auth/two-factor/verify-totp/",
    ]);
  });

  it("błędny lub użyty kod odzyskania daje neutralny komunikat i zachowuje wpis", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }),
    );
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.click(screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }));
    await user.type(screen.getByRole("textbox", { name: "Kod odzyskania" }), "zuzyty-kod");
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kod jest nieprawidłowy lub został użyty. Wpisz inny kod.",
    );
    expect(screen.getByRole("textbox", { name: "Kod odzyskania" })).toHaveValue("zuzyty-kod");
  });

  it("w trakcie weryfikacji kodu odzyskania blokuje ponowne wysłanie i zmianę ścieżki", async () => {
    let complete!: (response: Response) => void;
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { complete = resolve; }),
    );
    const user = userEvent.setup();
    render(<MfaFlow area="company" initialMode="challenge" />);
    await user.click(screen.getByRole("button", { name: "Nie mam dostępu do aplikacji" }));
    await user.type(screen.getByRole("textbox", { name: "Kod odzyskania" }), "kod-1");
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(screen.getByRole("status")).toHaveTextContent("Trwa weryfikacja kodu. Nie wysyłaj go ponownie.");
    expect(screen.getByRole("button", { name: "Sprawdzanie…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Użyj kodu z aplikacji" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nie mam aplikacji ani kodów" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(request).toHaveBeenCalledTimes(1);
    complete(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Użyj kodu z aplikacji" })).toBeEnabled(),
    );
  });

  it("rotacja pozwala wrócić do świeżej weryfikacji bez ponownego użycia proof", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ proof: "a".repeat(64) }));
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="restore" />);
    expect(screen.getByRole("textbox", { name: "Nowy kod z aplikacji" })).toHaveAccessibleDescription(
      "Użyj aktualnego kodu.",
    );
    await user.type(screen.getByRole("textbox", { name: "Nowy kod z aplikacji" }), "123456");
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByText(/świeży czynnik został potwierdzony/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Wróć do weryfikacji" }));
    expect(screen.getByRole("heading", { name: "Wydaj nowe kody" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Nowy kod z aplikacji" })).toHaveValue("");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("logowanie informuje o wygasłej sesji i o zachowanym zamiarze nowych kodów", () => {
    render(<LoginForm area="company" sessionExpired recoverCodes />);
    const notices = screen.getAllByRole("status");
    expect(notices[0]).toHaveTextContent("Twoja sesja wygasła. Zaloguj się ponownie.");
    expect(notices[1]).toHaveTextContent("Po zalogowaniu wydasz nowe kody odzyskania.");
    expect(screen.queryByRole("link", { name: /rejestracj/i })).toBeNull();
  });
});

describe("logowanie: reset i zmiana hasła", () => {
  it("link resetu prowadzi na właściwy host, a po zmianie hasła jest komunikat", () => {
    render(<LoginForm area="company" passwordChanged />);
    expect(screen.getByRole("link", { name: "Nie pamiętasz hasła? Zresetuj je" })).toHaveAttribute("href", "/admin/reset-hasla");
    expect(screen.getByText("Hasło zostało zmienione.")).toBeVisible();
    cleanup();
    render(<LoginForm area="platform" />);
    expect(screen.getByRole("link", { name: "Nie pamiętasz hasła?" })).toHaveAttribute("href", "/reset-hasla");
  });
});

describe("5xx na mutacji MFA (D-05, #132)", () => {
  const enroll = () =>
    Response.json({ totpURI: "otpauth://totp/Auterva?secret=ABCDEF123456" });
  async function toSetupAndSubmit(second: Response, code = "123456") {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(enroll())
      .mockResolvedValueOnce(second);
    const user = userEvent.setup();
    render(<MfaFlow area="platform" initialMode="enroll" />);
    await user.type(screen.getByLabelText("Potwierdź hasło"), "Hasło123!");
    await user.click(screen.getByRole("button", { name: "Rozpocznij konfigurację" }));
    await screen.findByText("ABCD EF12 3456");
    await user.type(screen.getByRole("textbox", { name: "Kod MFA" }), code);
    await user.click(screen.getByRole("button", { name: "Włącz MFA i pokaż kody" }));
    return request;
  }

  it.each([500, 502, 504])(
    "enrollment: %i to stan niepewny bez ponowienia kodu",
    async (status) => {
      const request = await toSetupAndSubmit(Response.json({}, { status }));
      expect(await screen.findByRole("button", { name: "Sprawdź stan" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Włącz MFA i pokaż kody" })).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("enrollment: spacje w kodzie z aplikacji są ignorowane", async () => {
    const request = await toSetupAndSubmit(
      Response.json({ backupCodes: ["k1"] }),
      "123 456",
    );
    await screen.findByText("k1");
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).code).toBe("123456");
  });

  it.each([500, 502, 504])(
    "challenge: %i na verify-totp to stan niepewny",
    async (status) => {
      const request = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json({}, { status }));
      const user = userEvent.setup();
      render(<MfaFlow area="company" initialMode="challenge" />);
      await user.type(screen.getByRole("textbox", { name: "Kod MFA" }), "123456");
      await user.click(screen.getByRole("button", { name: /Zweryfikuj|Zaloguj|Potwierdź/ }));
      expect(await screen.findByRole("button", { name: "Sprawdź stan" })).toBeVisible();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [409, { code: "MFA_BUSY" }],
    [503, { code: "MFA_RETRY" }],
  ])("%i %j pozostaje ponowieniem po Retry-After", async (status, body) => {
    const request = await toSetupAndSubmit(
      Response.json(body, { status, headers: { "Retry-After": "2" } }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/spróbuj ponownie/i);
    expect(screen.queryByRole("button", { name: "Sprawdź stan" })).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
