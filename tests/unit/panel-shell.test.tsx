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
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";
import {
  navigation,
  useUnsavedChanges,
} from "../../src/components/panel/unsaved-changes-guard";
import { UnsavedChangesDialog } from "../../src/components/panel/unsaved-changes-dialog";

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
      within(mobile).getByRole("link", { name: "Czat Nowe" }),
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

  it("pokazuje okruszek z jednym h1 i przypina Ustawienia oraz Konto na dole paska bocznego", () => {
    render(
      <PanelShell area="company" accessState="allowed" title="Firma Alfa" currentPath="/admin" onLogout={vi.fn()}>
        <p>Treść</p>
      </PanelShell>,
    );
    const crumbs = screen.getByRole("navigation", { name: "Okruszki" });
    expect(within(crumbs).getByText("Panel")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(crumbs).getByRole("heading", { level: 1, name: "Firma Alfa" })).toBeVisible();
    const sidebar = screen.getByRole("navigation", { name: "Nawigacja panelu" });
    const labels = within(sidebar).getAllByRole("link").map((link) => link.textContent);
    expect(labels).toEqual(["Auterva", "Pulpit", "Pojazdy", "Czat z Autervą", "Ustawienia", "Konto"]);
    expect(within(sidebar).getByText("Panel firmy")).toBeVisible();
    expect(screen.getByRole("button", { name: "Menu użytkownika" })).toBeVisible();
  });

  it("na kalendarzu floty oznacza Pojazdy jako bieżącą pozycję (ADM-10)", () => {
    render(
      <PanelShell area="company" accessState="allowed" title="Kalendarz floty" currentPath="/admin/kalendarz" onLogout={vi.fn()}>
        <p>Treść</p>
      </PanelShell>,
    );
    for (const name of ["Nawigacja panelu", "Nawigacja mobilna"]) {
      const nav = screen.getByRole("navigation", { name });
      expect(within(nav).getByRole("link", { name: "Pojazdy" })).toHaveAttribute("aria-current", "page");
    }
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
    // ADM-17 (#75): the change log is reachable from the menu; sessions still have no entry.
    expect(
      within(menu).getByRole("link", { name: "Dziennik zmian" }),
    ).toHaveAttribute("href", "/admin/logi");
    expect(within(menu).queryByRole("link", { name: /sesje/i })).toBeNull();
    // OVR-17: one order of the sheet, "Wyloguj" last.
    expect(within(menu).getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["Kalendarz floty", "Dziennik zmian", "Status usługi", "Ustawienia", "Konto"]);
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual(["Zamknij", "Wyloguj"]);
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
      expect(
        screen.getByRole("button", { name: "Profil superadmina" }),
      ).toHaveAttribute("aria-expanded", "false");
    } finally {
      request.mockRestore();
    }
  });

  it("zachowuje wpisany formularz przy przejściu do wygasłej usługi", async () => {
    const user = userEvent.setup();
    const props = {
      area: "company" as const,
      title: "Pojazdy",
      currentPath: "/admin/pojazdy",
    };
    const form = (
      <label>
        Nazwa pojazdu <input defaultValue="Mercedes" />
      </label>
    );
    const { rerender } = render(
      <PanelShell {...props} accessState="allowed">
        {form}
      </PanelShell>,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Nazwa pojazdu" }),
      " V",
    );
    rerender(
      <PanelShell {...props} accessState="service-expired">
        {form}
      </PanelShell>,
    );
    expect(screen.getByRole("textbox", { name: "Nazwa pojazdu" })).toHaveValue(
      "Mercedes V",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Usługa wygasła");
    rerender(
      <PanelShell {...props} accessState="allowed">
        {form}
      </PanelShell>,
    );
    expect(screen.getByRole("textbox", { name: "Nazwa pojazdu" })).toHaveValue(
      "Mercedes V",
    );
  });

  it("po wygaśnięciu usługi nadal usuwa panel po cofnięciu sesji", async () => {
    let revoked = false;
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        revoked
          ? Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401 })
          : Response.json({ session: { id: "sesja-firmy" } }),
      );
    try {
      const props = {
        area: "company" as const,
        expectedSessionId: "sesja-firmy",
        title: "Pojazdy",
        currentPath: "/admin/pojazdy",
      };
      const { rerender } = render(
        <PanelShell {...props} accessState="allowed">
          <p>Prywatne pojazdy</p>
        </PanelShell>,
      );
      await waitFor(() => expect(request).toHaveBeenCalled());
      rerender(
        <PanelShell {...props} accessState="service-expired">
          <p>Prywatne pojazdy</p>
        </PanelShell>,
      );
      expect(screen.getByText("Prywatne pojazdy")).toBeInTheDocument();
      revoked = true;
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(screen.getByText("Sesja wygasła")).toBeInTheDocument(),
      );
      expect(screen.queryByText("Prywatne pojazdy")).toBeNull();
    } finally {
      request.mockRestore();
    }
  });

  it("chowa otwarty dialog niezapisanych zmian przy błędzie sieci i nie wznawia go po retry", async () => {
    const user = userEvent.setup();
    const stayed = vi.fn();
    let offline = false;
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        if (offline) throw new TypeError("network unavailable");
        return Response.json({ session: { id: "sesja-firmy" } });
      });
    function Draft() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <label>
            Szkic <input defaultValue="Firma" />
          </label>
          <button onClick={() => setOpen(true)}>Opuść formularz</button>
          <UnsavedChangesDialog
            open={open}
            onStay={() => {
              stayed();
              setOpen(false);
            }}
            onDiscard={vi.fn()}
            onSaveAndLeave={vi.fn()}
          />
        </>
      );
    }
    try {
      render(
        <PanelShell
          area="company"
          accessState="allowed"
          expectedSessionId="sesja-firmy"
          title="Panel"
          currentPath="/admin"
        >
          <Draft />
        </PanelShell>,
      );
      const draft = screen.getByRole("textbox", { name: "Szkic" });
      await user.type(draft, " Alfa");
      await user.click(screen.getByRole("button", { name: "Opuść formularz" }));
      expect(
        screen.getByRole("alertdialog", { name: "Niezapisane zmiany" }),
      ).toBeVisible();
      offline = true;
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(
          screen.getByText("Nie udało się sprawdzić dostępu"),
        ).toBeVisible(),
      );
      expect(
        screen.queryByRole("alertdialog", { name: "Niezapisane zmiany" }),
      ).toBeNull();
      expect(stayed).toHaveBeenCalledOnce();
      offline = false;
      await user.click(
        screen.getByRole("button", { name: "Spróbuj ponownie" }),
      );
      await waitFor(() => expect(draft).toBeVisible());
      expect(draft).toHaveValue("Firma Alfa");
      expect(
        screen.queryByRole("alertdialog", { name: "Niezapisane zmiany" }),
      ).toBeNull();
    } finally {
      request.mockRestore();
    }
  });
});

describe("ochrona niezapisanych zmian w shellu (OVR-13)", () => {
  function Form({
    saving = false,
    chatDraft = false,
    save,
  }: {
    saving?: boolean;
    chatDraft?: boolean;
    save?: () => void;
  }) {
    const [value, setValue] = useState("Firma");
    useUnsavedChanges({
      dirty: value !== "Firma",
      saving,
      chatDraft,
      save,
      contextLabel: "formularz firmy",
    });
    return (
      <label>
        Nazwa
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
    );
  }
  const shell = (child: React.ReactNode, onLogout = vi.fn()) =>
    render(
      <PanelShell
        area="company"
        accessState="allowed"
        title="Panel"
        currentPath="/admin"
        onLogout={onLogout}
      >
        {child}
      </PanelShell>,
    );
  const alert = () =>
    screen.queryByRole("alertdialog", { name: "Niezapisane zmiany" });

  it("czysty formularz nie blokuje linków ani zamknięcia karty", () => {
    shell(<Form />);
    const link = screen.getAllByRole("link", { name: "Pojazdy" })[0];
    let prevented = true;
    const spy = (e: Event) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener("click", spy);
    link.click();
    document.removeEventListener("click", spy);
    expect(prevented).toBe(false);
    expect(alert()).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("brudny formularz: link shellu pokazuje dialog, Pozostań zachowuje wartość i fokus", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    shell(<Form />);
    const input = screen.getByRole("textbox", { name: "Nazwa" });
    await user.type(input, " Alfa");
    const link = screen.getAllByRole("link", { name: "Pojazdy" })[0];
    link.focus();
    await user.click(link);
    expect(alert()).toBeVisible();
    expect(assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Zostań" }));
    await waitFor(() => expect(alert()).toBeNull());
    expect(input).toHaveValue("Firma Alfa");
    expect(link).toHaveFocus();
    await user.click(link);
    await user.click(screen.getByRole("button", { name: "Odrzuć zmiany" }));
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(assign.mock.calls[0][0]).toMatch(/\/admin\/pojazdy$/);
    assign.mockRestore();
  });

  it("beforeunload jest anulowany tylko przy niezapisanych zmianach", async () => {
    const user = userEvent.setup();
    shell(<Form />);
    await user.type(screen.getByRole("textbox", { name: "Nazwa" }), "x");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("Wyloguj przy brudnym formularzu pyta i wylogowuje dopiero po Odrzuć", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    shell(<Form />, logout);
    await user.type(screen.getByRole("textbox", { name: "Nazwa" }), "x");
    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(alert()).toBeVisible();
    expect(logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Zostań" }));
    await waitFor(() => expect(alert()).toBeNull());
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Nazwa" })).toHaveValue(
      "Firmax",
    );
    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    await user.click(screen.getByRole("button", { name: "Odrzuć zmiany" }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(screen.getByText("Wylogowano")).toBeInTheDocument();
    expect(screen.queryByText("Sesja wygasła")).toBeNull();
  });

  it("Wyloguj z menu profilu → Zostań: fokus wraca na przycisk profilu, a wartości formularza zostają", async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    shell(<Form />, logout);
    const input = screen.getByRole("textbox", { name: "Nazwa" });
    await user.type(input, "x");
    const avatar = screen.getByRole("button", { name: "Menu użytkownika" });
    await user.click(avatar);
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(alert()).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Zostań" }));
    await waitFor(() => expect(alert()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(avatar));
    expect(input).toHaveValue("Firmax");
    expect(logout).not.toHaveBeenCalled();
  });

  it("Zapisz i wyjdź woła zapis zarejestrowany przez formularz", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    const save = vi.fn().mockResolvedValue(undefined);
    shell(<Form save={save} />);
    await user.type(screen.getByRole("textbox", { name: "Nazwa" }), "x");
    await user.click(screen.getAllByRole("link", { name: "Czat z Autervą" })[0]);
    await user.click(screen.getByRole("button", { name: "Zapisz i wyjdź" }));
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledOnce();
    assign.mockRestore();
  });

  it("podczas zapisu nie ma wyjścia i nie ma dialogu", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    const logout = vi.fn();
    shell(<Form saving />, logout);
    await user.click(screen.getAllByRole("link", { name: "Pojazdy" })[0]);
    expect(alert()).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Trwa zapisywanie");
    expect(assign).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Menu użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj" }));
    expect(logout).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("szkic czatu nie blokuje wyjścia", async () => {
    const user = userEvent.setup();
    shell(<Form chatDraft />);
    await user.type(screen.getByRole("textbox", { name: "Nazwa" }), "x");
    let prevented = true;
    const spy = (e: Event) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener("click", spy);
    screen.getAllByRole("link", { name: "Pojazdy" })[0].click();
    document.removeEventListener("click", spy);
    expect(prevented).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});

describe("awatar w topbarze (#14)", () => {
  it("aria-expanded awatara odzwierciedla otwarte menu i wraca po zamknięciu", async () => {
    const user = userEvent.setup();
    render(
      <PanelShell area="company" accessState="allowed" title="Panel" currentPath="/admin" onLogout={vi.fn()}>
        <p>Treść</p>
      </PanelShell>,
    );
    const avatar = screen.getByRole("button", { name: "Menu użytkownika" });
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    await user.click(avatar);
    await waitFor(() => expect(avatar).toHaveAttribute("aria-expanded", "true"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(avatar).toHaveAttribute("aria-expanded", "false"));
    expect(avatar).toHaveFocus();
  });
});
