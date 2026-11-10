// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  evaluatePassword,
  PASSWORD_MAX,
} from "../../src/components/auth/password-policy";
import { PasswordStrength } from "../../src/components/auth/password-strength";

afterEach(cleanup);

describe("polityka hasła zgodna z serwerem", () => {
  it("akceptuje 12–256 znaków i odrzuca resztę, niezależnie od składu", () => {
    expect(evaluatePassword("a".repeat(11)).valid).toBe(false);
    expect(evaluatePassword("a".repeat(12)).valid).toBe(true);
    expect(evaluatePassword("a".repeat(PASSWORD_MAX)).valid).toBe(true);
    expect(evaluatePassword("a".repeat(PASSWORD_MAX + 1)).valid).toBe(false);
  });
  it("poziom wynika z długości i kryteriów, nie z koloru", () => {
    expect(evaluatePassword("abcdefghijkl").level).toBe("weak");
    expect(evaluatePassword("Abcdefghijkl").level).toBe("weak");
    expect(evaluatePassword("Abcdefghijk1").level).toBe("medium");
    expect(evaluatePassword("Abcdefghij1!").level).toBe("strong");
  });
  it("poniżej 12 znaków zawsze za krótkie, niezależnie od składu", () => {
    for (const value of ["", "Ab1!", "Abcdefg1!xy"]) {
      const result = evaluatePassword(value);
      expect(result.tooShort).toBe(true);
      expect(result.valid).toBe(false);
    }
    expect(evaluatePassword("a".repeat(12)).tooShort).toBe(false);
  });
  it("długość 16+ to dodatkowy punkt, ale sam nie daje poziomu mocnego", () => {
    expect(evaluatePassword("a".repeat(16)).level).toBe("weak");
    expect(evaluatePassword("a".repeat(15) + "1").level).toBe("medium");
    expect(evaluatePassword("A" + "a".repeat(14) + "1").level).toBe("strong");
    expect(evaluatePassword("A" + "a".repeat(10) + "1").level).toBe("medium");
  });
  it("słabe hasło 12+ pozostaje poprawne dla walidacji", () => {
    expect(evaluatePassword("abcdefghijkl").valid).toBe(true);
  });
});

describe("PasswordStrength", () => {
  it("za krótkie hasło: tekst „Za krótkie”, pusty pasek, bez poziomu", () => {
    const { container } = render(<PasswordStrength id="s" {...evaluatePassword("abc")} />);
    expect(screen.getByText("Siła hasła: Za krótkie")).toBeVisible();
    expect(container.querySelector("[data-level]")).toHaveAttribute("data-level", "short");
    expect(container.querySelector("[aria-hidden='true'] > div")).toHaveStyle({ width: "0%" });
  });

  it("ogłoszenie zmienia się tylko przy zmianie poziomu, nie przy każdym znaku", () => {
    const { container, rerender } = render(
      <PasswordStrength id="s" {...evaluatePassword("Abcdefghijk1")} />,
    );
    const live = container.querySelector("[aria-live]");
    const before = live?.textContent;
    rerender(<PasswordStrength id="s" {...evaluatePassword("Abcdefghijk12")} />);
    expect(container.querySelector("[aria-live]")).toBe(live);
    expect(live?.textContent).toBe(before);
  });

  it("pokazuje tekst poziomu i checklistę ze stanem tekstowym", () => {
    const result = evaluatePassword("Abcdefghijk1");
    render(<PasswordStrength id="s" {...result} />);
    expect(screen.getByText("Siła hasła: Średnie")).toBeVisible();
    expect(screen.getByText(/Cyfra/)).toHaveTextContent("Cyfra (zalecane): spełnione");
    expect(screen.getByText(/Znak specjalny/)).toHaveTextContent(
      "Znak specjalny (zalecane): oczekuje",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("aria-live obejmuje tylko poziom, a nie checklistę; zmiana poziomu zmienia tylko etykietę", () => {
    const { container, rerender } = render(
      <PasswordStrength id="s" {...evaluatePassword("abcdefghijkl")} />,
    );
    const live = container.querySelector("[aria-live]");
    expect(live).toHaveTextContent(/^Siła hasła: Słabe$/);
    expect(live?.querySelector("li")).toBeNull();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    rerender(<PasswordStrength id="s" {...evaluatePassword("Abcdefghij1!")} />);
    expect(container.querySelector("[aria-live]")).toHaveTextContent(/^Siła hasła: Mocne$/);
  });

  it("poziom wynika z tekstu i długości paska, nie tylko z koloru", () => {
    const { container } = render(
      <PasswordStrength id="s" {...evaluatePassword("Abcdefghijk1")} />,
    );
    expect(container.querySelector("[data-level]")).toHaveAttribute("data-level", "medium");
    expect(container.querySelector("[aria-hidden='true'] > div")).toHaveStyle({ width: "75%" });
  });

  it("tylko długość jest wymagana, pozostałe kryteria są oznaczone jako zalecane", () => {
    render(<PasswordStrength id="s" {...evaluatePassword("abc")} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Co najmniej 12 znaków (wymagane)");
    for (const item of items.slice(1)) expect(item).toHaveTextContent("(zalecane)");
    expect(screen.getAllByText("(wymagane)", { exact: false })).toHaveLength(1);
  });
});
