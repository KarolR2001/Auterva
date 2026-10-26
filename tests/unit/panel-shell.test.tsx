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

  it("oznacza Firmy jako bieżącą sekcję także na aliasie platformy /", () => {
    render(
      <PanelShell
        area="platform"
        accessState="allowed"
        title="Firmy"
        currentPath="/"
        onLogout={vi.fn()}
      >
        <p>Lista firm</p>
      </PanelShell>,
    );

    expect(
      within(
        screen.getByRole("navigation", { name: "Nawigacja panelu" }),
      ).getByRole("link", { name: "Firmy" }),
    ).toHaveAttribute("aria-current", "page");
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

  it("po potwierdzonym wylogowaniu natychmiast usuwa prywatne dzieci", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    render(
      <PanelShell
        area="company"
        accessState="allowed"
        title="Panel"
        currentPath="/admin"
        onLogout={logout}
      >
        <p>Poufna treść firmy</p>
      </PanelShell>,
    );

    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(screen.queryByText("Poufna treść firmy")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Nawigacja panelu" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Przejdź do logowania" }),
    ).toHaveAttribute("href", "/admin/login");
  });

  it("bez callbacku wylogowuje przez API bieżącego hosta", async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    try {
      render(
        <PanelShell
          area="platform"
          accessState="allowed"
          title="Firmy"
          currentPath="/firmy"
        >
          <p>Poufne dane platformy</p>
        </PanelShell>,
      );

      await user.click(
        screen.getByRole("button", { name: "Profil superadmina" }),
      );
      await user.click(screen.getByRole("button", { name: "Wyloguj" }));

      await waitFor(() =>
        expect(screen.queryByText("Poufne dane platformy")).toBeNull(),
      );
      expect(request).toHaveBeenCalledWith("/api/auth/sign-out/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(
        screen.getByRole("link", { name: "Przejdź do logowania" }),
      ).toHaveAttribute("href", "/login");
    } finally {
      request.mockRestore();
    }
  });

  it("usuwa prywatny widok, gdy serwer cofnie sesję już otwartego panelu", async () => {
    let revoked = false;
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        revoked
          ? Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 })
          : Response.json({ session: { id: "sesja-alfa" } }),
      );
    try {
      render(
        <PanelShell
          area="company"
          accessState="allowed"
          expectedSessionId="sesja-alfa"
          title="Panel"
          currentPath="/admin"
        >
          <p>Poufne dane firmy Alfa</p>
        </PanelShell>,
      );
      expect(screen.getByText("Poufne dane firmy Alfa")).toBeInTheDocument();
      revoked = true;
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(screen.queryByText("Poufne dane firmy Alfa")).toBeNull(),
      );
      expect(screen.getByText("Sesja wygasła")).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith(
        "/api/auth/get-session/",
        expect.objectContaining({
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    } finally {
      request.mockRestore();
    }
  });

  it("przy błędzie sieci ukrywa widok, lecz zachowuje szkic do ponownej kontroli", async () => {
    const user = userEvent.setup();
    let offline = false;
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        if (offline) throw new TypeError("network unavailable");
        return Response.json({ session: { id: "sesja-platformy" } });
      });
    try {
      render(
        <PanelShell
          area="platform"
          accessState="allowed"
          expectedSessionId="sesja-platformy"
          title="Firmy"
          currentPath="/firmy"
        >
          <label>
            Szkic <input defaultValue="Firma" />
          </label>
        </PanelShell>,
      );
      const draft = screen.getByRole("textbox", { name: "Szkic" });
      await user.type(draft, " Alfa");
      expect(draft).toHaveValue("Firma Alfa");
      await user.click(
        screen.getByRole("button", { name: "Profil superadmina" }),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      offline = true;
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(
          screen.getByText(/nie udało się sprawdzić dostępu/i),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByText("Sesja wygasła")).toBeNull();
      expect(draft).toBeInTheDocument();
      expect(draft).not.toBeVisible();
      offline = false;
      await user.click(
        screen.getByRole("button", { name: "Spróbuj ponownie" }),
      );
      await waitFor(() => expect(draft).toBeVisible());
      expect(draft).toHaveValue("Firma Alfa");
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      request.mockRestore();
    }
  });
});
