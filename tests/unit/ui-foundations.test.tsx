// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Alert } from "../../src/components/ui/alert";
import { AnnouncementRegion } from "../../src/components/ui/announcement-region";
import { Button } from "../../src/components/ui/button";
import { Dialog } from "../../src/components/ui/dialog";
import { FormField } from "../../src/components/ui/form-field";
import { PasswordInput } from "../../src/components/ui/password-input";
import { SkipLink } from "../../src/components/ui/skip-link";
import { TextInput } from "../../src/components/ui/text-input";

afterEach(cleanup);

describe("wspólne komponenty", () => {
  it("blokuje ponowną akcję podczas loading i ogłasza jej stan", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Zapisywanie" onClick={onClick}>
        Zapisz
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Zapisywanie" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Zapisywanie");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("zachowuje jawną nazwę dostępną w zwykłym stanie, także bez tekstu", () => {
    const { rerender } = render(
      <>
        <Button aria-label="Usuń pojazd" loadingLabel="Usuwanie pojazdu">
          Usuń
        </Button>
        <Button
          aria-label="Otwórz menu"
          icon={<span aria-hidden="true">⋯</span>}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: "Usuń pojazd" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Otwórz menu" })).toBeVisible();

    rerender(
      <>
        <Button
          aria-label="Usuń pojazd"
          loading
          loadingLabel="Usuwanie pojazdu"
        >
          Usuń
        </Button>
        <Button
          aria-label="Otwórz menu"
          icon={<span aria-hidden="true">⋯</span>}
        />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Usuwanie pojazdu" }),
    ).toBeDisabled();

    rerender(
      <>
        <Button aria-label="Usuń pojazd" loadingLabel="Usuwanie pojazdu">
          Usuń
        </Button>
        <Button
          aria-label="Otwórz menu"
          icon={<span aria-hidden="true">⋯</span>}
        />
      </>,
    );
    expect(screen.getByRole("button", { name: "Usuń pojazd" })).toBeEnabled();
  });

  it("wiąże etykietę i błąd z polem bez utraty wpisanej wartości", () => {
    render(
      <FormField id="email" label="E-mail" error="Podaj poprawny adres e-mail">
        <TextInput required defaultValue="błędny-adres" />
      </FormField>,
    );

    const input = screen.getByRole("textbox", { name: "E-mail" });
    const error = screen.getByText("Podaj poprawny adres e-mail");
    expect(input).toHaveValue("błędny-adres");
    expect(input).toBeRequired();
    expect(screen.getByText("E-mail")).toHaveTextContent("*");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });

  it("ujawnia hasło bez wyczyszczenia wartości i zachowuje fokus przycisku", async () => {
    const user = userEvent.setup();
    function Example() {
      const [visibility, setVisibility] = useState<"hidden" | "shown">(
        "hidden",
      );
      return (
        <PasswordInput
          id="password"
          label="Hasło"
          autoComplete="current-password"
          defaultValue="testowe-hasło"
          visibility={visibility}
          onVisibilityChange={setVisibility}
        />
      );
    }
    render(<Example />);

    const input = screen.getByLabelText("Hasło");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Pokaż hasło" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("testowe-hasło");
    expect(screen.getByRole("button", { name: "Ukryj hasło" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Ukryj hasło" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("wiąże błąd hasła z polem bez odsłaniania wartości", () => {
    render(
      <PasswordInput
        id="password-error"
        label="Hasło"
        autoComplete="current-password"
        defaultValue="hasło-testowe"
        visibility="hidden"
        error="Niepoprawne hasło"
        onVisibilityChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Hasło");
    const error = screen.getByText("Niepoprawne hasło");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });

  it("pokazuje stan Caps Lock bez zmiany hasła", () => {
    render(
      <PasswordInput
        id="password-caps"
        label="Hasło"
        autoComplete="current-password"
        defaultValue="hasło-testowe"
        visibility="hidden"
        onVisibilityChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Hasło");
    const event = new KeyboardEvent("keydown", { bubbles: true, key: "A" });
    Object.defineProperty(event, "getModifierState", {
      value: (key: string) => key === "CapsLock",
    });
    fireEvent(input, event);
    expect(screen.getByText("Caps Lock jest włączony")).toBeInTheDocument();
    expect(input).toHaveValue("hasło-testowe");
  });

  it("ogłasza błąd tekstem i pozwala zamknąć tylko ten komunikat", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Alert tone="error" title="Nie zapisano" onDismiss={onDismiss}>
        Spróbuj ponownie.
      </Alert>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Nie zapisano");
    expect(alert).toHaveTextContent("Spróbuj ponownie.");
    expect(alert.querySelector("svg")).not.toBeNull();
    await user.click(
      within(alert).getByRole("button", {
        name: "Zamknij komunikat: Nie zapisano",
      }),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("zamyka dialog Escape i przywraca fokus wywołującej akcji", async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Otwórz</button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Potwierdź usunięcie"
            description="Usunąć pojazd testowy?"
            type="destructive"
            primaryAction={{ label: "Usuń pojazd testowy", onClick: vi.fn() }}
            secondaryAction={{ label: "Anuluj", onClick: () => setOpen(false) }}
          />
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Otwórz" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Potwierdź usunięcie" });
    expect(dialog).toHaveTextContent("Usunąć pojazd testowy?");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("daje bezpieczne anulowanie i początkowy fokus bez secondaryAction", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Otwórz</button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Usuń pojazd?"
            type="destructive"
            primaryAction={{ label: "Usuń", onClick: onDelete }}
          />
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Otwórz" });
    await user.click(trigger);
    const cancel = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Anuluj",
    });
    await waitFor(() => expect(cancel).toHaveFocus());
    await user.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("ogłasza wynik zapisu bez przenoszenia fokusu", () => {
    render(
      <>
        <button autoFocus>Akcja</button>
        <AnnouncementRegion politeness="polite" message="Zmiany zapisane" />
      </>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Zmiany zapisane");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(screen.getByRole("button", { name: "Akcja" })).toHaveFocus();
  });

  it("zachowuje natywną kotwicę SkipLink w kolejności klawiatury", () => {
    render(<SkipLink target="content" />);
    const link = screen.getByRole("link", { name: "Przejdź do treści" });
    expect(link).toHaveAttribute("href", "#main-content");
    expect(link).not.toHaveAttribute("tabindex", "-1");
    expect(link).not.toHaveAttribute("aria-hidden");
  });
});
