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
    expect(screen.getByText("Firma Alfa")).toBeVisible();
    const email = screen.getByRole("textbox", { name: "Adres e-mail" });
    const password = screen.getByLabelText("Hasło");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(
      screen.queryByRole("link", { name: /rejestracj|reset/i }),
    ).toBeNull();

    await user.type(email, "admin@example.test");
    await user.type(password, "PoprawneHasło123!");
    await user.click(screen.getByRole("button", { name: "Zaloguj" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Adres e-mail lub hasło są nieprawidłowe",
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
    await user.click(screen.getByRole("button", { name: "Zaloguj" }));
    expect(screen.getByRole("button", { name: "Logowanie…" })).toBeDisabled();
    expect(request).toHaveBeenCalledTimes(1);
    complete(Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Zaloguj" })).toBeEnabled(),
    );
  });

  it("awarię serwera odróżnia od błędnych danych, zachowując formularz", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({}, { status: 500 }),
    );
    const user = userEvent.setup();
    render(<LoginForm area="company" />);
    await user.type(
      screen.getByRole("textbox", { name: "Adres e-mail" }),
      "admin@example.test",
    );
    await user.type(
      screen.getByLabelText("Hasło", { exact: true }),
      "PoprawneHasło123!",
    );
    await user.click(screen.getByRole("button", { name: "Zaloguj" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /usługa|spróbuj ponownie/i,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /hasło są nieprawidłowe/i,
    );
    expect(screen.getByLabelText("Hasło", { exact: true })).toHaveValue(
      "PoprawneHasło123!",
    );
  });
});

describe("obowiązkowe MFA", () => {
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
      screen.getByRole("button", { name: "Użyj kodu odzyskania" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Kod odzyskania" }),
      "abc-def-123",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź kod" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /inna operacja MFA|spróbuj ponownie/i,
    );
    expect(screen.queryByText(/nieprawidłowy kod/i)).toBeNull();
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
    expect(await screen.findByText("ABCDEF123456")).toBeVisible();
    expect(screen.queryByText("kod-1")).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "Kod z aplikacji" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Potwierdź MFA" }));
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
});
