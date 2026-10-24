// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";

afterEach(cleanup);

describe("nawigacja panelu", () => {
  it("pokazuje tylko zakres firmy MVP i sygnalizuje nowe wiadomości tekstem", () => {
    render(
      <PanelShell
        area="company"
        accessState="allowed"
        title="Pojazdy"
        currentPath="/admin/pojazdy"
        unreadChat
        onLogout={vi.fn()}
      >
        <p>Lista pojazdów</p>
      </PanelShell>,
    );
    const desktop = screen.getByRole("navigation", {
      name: "Nawigacja panelu",
    });
    const mobile = screen.getByRole("navigation", {
      name: "Nawigacja mobilna",
    });
    expect(
      within(desktop).getByRole("link", { name: "Pojazdy" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(mobile).getByRole("link", { name: "Czat, nowe wiadomości" }),
    ).toHaveAttribute("href", "/admin/czat");
    expect(within(mobile).getAllByRole("link")).toHaveLength(3);
    expect(
      within(mobile).getByRole("button", { name: "Więcej" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: /kalendarz całej floty|dziennik zmian|sesje/i,
      }),
    ).toBeNull();
    expect(screen.getByRole("main")).toHaveTextContent("Lista pojazdów");
  });

  it("utrzymuje aktora platformy i powrót do wybranej firmy bez pulpitu platformy", () => {
    render(
      <PanelShell
        area="platform"
        accessState="allowed"
        title="Pojazdy firmy"
        currentPath="/firmy/firma-alfa/pojazdy"
        companyContext={{ id: "firma-alfa", name: "Firma Alfa" }}
        onLogout={vi.fn()}
      >
        <p>Dane firmy Alfa</p>
      </PanelShell>,
    );
    const desktop = screen.getByRole("navigation", {
      name: "Nawigacja panelu",
    });
    expect(
      within(desktop).getByRole("link", { name: "Firmy" }),
    ).toHaveAttribute("href", "/firmy");
    expect(
      within(desktop).getByRole("link", { name: "Wiadomości" }),
    ).toHaveAttribute("href", "/wiadomosci");
    expect(
      within(desktop).queryByRole("link", { name: /pulpit|ustawienia/i }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Wróć do karty firmy Firma Alfa" }),
    ).toHaveAttribute("href", "/firmy/firma-alfa");
    expect(screen.getByRole("main")).toHaveTextContent("Dane firmy Alfa");
  });

  it.each(["session-expired", "forbidden", "archived", "loading"] as const)(
    "nie montuje prywatnego shella ani danych w stanie %s",
    (accessState) => {
      const mounted = vi.fn();
      function PrivateData() {
        mounted();
        return <p>Poufne dane firmy Alfa</p>;
      }
      render(
        <PanelShell
          area="company"
          accessState={accessState}
          title="Firma Alfa"
          currentPath="/admin"
          onLogout={vi.fn()}
        >
          <PrivateData />
        </PanelShell>,
      );
      expect(mounted).not.toHaveBeenCalled();
      expect(screen.queryByText("Poufne dane firmy Alfa")).toBeNull();
      expect(
        screen.queryByRole("navigation", { name: "Nawigacja panelu" }),
      ).toBeNull();
    },
  );

  it("po utracie dostępu usuwa otwarte menu i nie przywraca go po nowej sesji", async () => {
    const user = userEvent.setup();
    const props = {
      area: "company" as const,
      title: "Panel firmy",
      currentPath: "/admin",
      onLogout: vi.fn(),
    };
    const { rerender } = render(
      <PanelShell {...props} accessState="allowed">
        <p>Dane prywatne</p>
      </PanelShell>,
    );
    await user.click(
      within(
        screen.getByRole("navigation", { name: "Nawigacja mobilna" }),
      ).getByRole("button", { name: "Więcej" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(
      <PanelShell {...props} accessState="session-expired">
        <p>Dane prywatne</p>
      </PanelShell>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Dane prywatne")).toBeNull();
    rerender(
      <PanelShell {...props} accessState="allowed">
        <p>Nowa sesja</p>
      </PanelShell>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("otwiera Więcej z akcjami firmy, zamyka Escape i oddaje fokus", async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    render(
      <PanelShell
        area="company"
        accessState="allowed"
        title="Panel"
        currentPath="/admin"
        onLogout={logout}
      >
        <p>Dashboard</p>
      </PanelShell>,
    );
    const more = within(
      screen.getByRole("navigation", { name: "Nawigacja mobilna" }),
    ).getByRole("button", { name: "Więcej" });
    await user.click(more);
    const menu = screen.getByRole("dialog", {
      name: "Więcej — menu administratora",
    });
    expect(
      within(menu).getByRole("link", { name: "Status usługi" }),
    ).toHaveAttribute("href", "/admin/usluga");
    expect(
      within(menu).getByRole("link", { name: "Ustawienia" }),
    ).toHaveAttribute("href", "/admin/ustawienia");
    expect(within(menu).getByRole("link", { name: "Konto" })).toHaveAttribute(
      "href",
      "/admin/konto",
    );
    expect(
      within(menu).getByRole("button", { name: "Wyloguj" }),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole("link", { name: /dziennik|sesje/i }),
    ).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(more).toHaveFocus();
    expect(logout).not.toHaveBeenCalled();
  });
});
