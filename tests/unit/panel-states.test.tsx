// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PanelAccess,
  PanelFeedback,
} from "../../src/components/panel/panel-states";

afterEach(cleanup);

describe("stany dostępu panelu", () => {
  it.each(["session-expired", "forbidden", "archived"] as const)(
    "nie montuje prywatnych dzieci przy stanie %s",
    (state) => {
      const mounted = vi.fn();
      function PrivateContent() {
        useEffect(mounted, []);
        return <p>Dane prywatne firmy Alfa</p>;
      }

      render(
        <PanelAccess state={state} area="company">
          <PrivateContent />
        </PanelAccess>,
      );

      expect(mounted).not.toHaveBeenCalled();
      expect(screen.queryByText("Dane prywatne firmy Alfa")).toBeNull();
      expect(screen.getByRole("main")).toHaveTextContent(
        state === "session-expired"
          ? "Sesja wygasła"
          : state === "archived"
            ? "Dostęp wstrzymany"
            : "Brak dostępu",
      );
    },
  );

  it("zachowuje panel i formularz po wygaśnięciu samej usługi", () => {
    const mounted = vi.fn();
    function Form() {
      useEffect(mounted, []);
      return <input aria-label="Nazwa pojazdu" defaultValue="Auterva V01" />;
    }

    render(
      <PanelAccess state="service-expired" area="company">
        <Form />
      </PanelAccess>,
    );

    expect(mounted).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Nazwa pojazdu" })).toHaveValue(
      "Auterva V01",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Twoja strona publiczna jest wyłączona");
    expect(screen.queryByRole("link", { name: /logowania/i })).toBeNull();
  });

  it("nie ujawnia prywatnych dzieci podczas ładowania dostępu", () => {
    render(
      <PanelAccess state="loading" area="platform">
        <p>Dane prywatne</p>
      </PanelAccess>,
    );
    expect(screen.queryByText("Dane prywatne")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Sprawdzanie dostępu");
  });

  it("kieruje wygasłą sesję na login właściwego obszaru", () => {
    const { rerender } = render(
      <PanelAccess state="session-expired" area="company">
        <p>Dane</p>
      </PanelAccess>,
    );
    expect(screen.getByRole("link", { name: "Przejdź do logowania" })).toHaveAttribute(
      "href",
      "/admin/login?returnTo=%2Fadmin",
    );

    rerender(
      <PanelAccess state="session-expired" area="platform">
        <p>Dane</p>
      </PanelAccess>,
    );
    expect(screen.getByRole("link", { name: "Przejdź do logowania" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2F",
    );
  });
});

describe("stany błędu panelu", () => {
  it("pokazuje 404 z powrotem do właściwej sekcji", () => {
    render(
      <PanelFeedback
        kind="not-found"
        dashboardHref="/admin"
        previousHref="/admin/pojazdy"
      />,
    );
    expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Przejdź do panelu" })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(screen.getByRole("link", { name: "Wróć do poprzedniej sekcji" })).toHaveAttribute(
      "href",
      "/admin/pojazdy",
    );
  });

  it("pozwala ponowić błąd i pokazuje requestId bez prywatnych szczegółów", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <PanelFeedback
        kind="error"
        dashboardHref="/admin"
        requestId="req-123"
        onRetry={retry}
      />,
    );
    expect(screen.getByText(/req-123/)).toBeVisible();
    expect(screen.queryByText(/stack trace|postgres|exception/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /czat/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("pokazuje bezpieczny link do czatu tylko z dopuszczonym dostępem", () => {
    const { rerender } = render(
      <PanelFeedback kind="error" dashboardHref="/admin" chatHref="/admin/czat" />,
    );
    expect(screen.queryByRole("link", { name: /czat/i })).toBeNull();

    rerender(
      <PanelFeedback
        kind="error"
        dashboardHref="/admin"
        chatHref="/admin/czat"
        canOpenChat
      />,
    );
    expect(screen.getByRole("link", { name: /czat/i })).toHaveAttribute(
      "href",
      "/admin/czat",
    );
  });
});
