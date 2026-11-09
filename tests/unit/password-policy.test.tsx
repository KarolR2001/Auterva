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
    expect(evaluatePassword("Ab1!").level).toBe("weak");
    expect(evaluatePassword("abcdefghijkl").level).toBe("weak");
    expect(evaluatePassword("Abcdefghijk1").level).toBe("medium");
    expect(evaluatePassword("Abcdefghij1!").level).toBe("strong");
  });
});

describe("PasswordStrength", () => {
  it("pokazuje tekst poziomu i checklistę ze stanem tekstowym", () => {
    const result = evaluatePassword("Abcdefghijk1");
    render(<PasswordStrength id="s" {...result} />);
    expect(screen.getByText("Siła hasła: Średnie")).toBeVisible();
    expect(screen.getByText(/Cyfra/)).toHaveTextContent("Cyfra: spełnione");
    expect(screen.getByText(/Znak specjalny/)).toHaveTextContent(
      "Znak specjalny: oczekuje",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
