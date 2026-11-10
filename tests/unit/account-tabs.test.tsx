// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AccountTabs } from "../../src/components/account/account-tabs";

afterEach(cleanup);

describe("zakładki konta firmy (ADM-15)", () => {
  it("wskazują bieżącą stronę i prowadzą do dwóch tras konta", () => {
    render(<AccountTabs current="sessions" />);
    const nav = screen.getByRole("navigation", { name: "Sekcje konta" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aktywne sesje" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Aktywne sesje" })).toHaveAttribute("href", expect.stringMatching(/^\/admin\/konto\/sesje\/?$/));
    const profile = screen.getByRole("link", { name: "Profil i hasło" });
    expect(profile).not.toHaveAttribute("aria-current");
    expect(profile).toHaveAttribute("href", expect.stringMatching(/^\/admin\/konto\/?$/));
  });
});
