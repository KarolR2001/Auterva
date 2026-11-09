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

import { UnsavedChangesDialog } from "../../src/components/panel/unsaved-changes-dialog";

afterEach(cleanup);

describe("ochrona niezapisanych zmian", () => {
  it("pokazuje trzy decyzje i po Zostań zachowuje formularz oraz fokus", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const onSaveAndLeave = vi.fn();

    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Przejdź do pojazdów</button>
          <input aria-label="Nazwa firmy" defaultValue="Firma Alfa" />
          <UnsavedChangesDialog
            open={open}
            contextLabel="ustawienia firmy"
            onStay={() => setOpen(false)}
            onDiscard={onDiscard}
            onSaveAndLeave={onSaveAndLeave}
          />
        </>
      );
    }

    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Przejdź do pojazdów" });
    await user.click(trigger);
    const dialog = screen.getByRole("alertdialog", {
      name: "Niezapisane zmiany",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/ustawienia firmy/);
    expect(within(dialog).getAllByRole("button")).toHaveLength(3);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Zostań" }),
      ).toHaveFocus(),
    );

    await user.click(within(dialog).getByRole("button", { name: "Zostań" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Nazwa firmy" })).toHaveValue(
      "Firma Alfa",
    );
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onSaveAndLeave).not.toHaveBeenCalled();
  });

  it("Escape oznacza Zostań, ale kliknięcie poza dialogiem nie odrzuca zmian", async () => {
    const user = userEvent.setup();
    const onStay = vi.fn();
    render(
      <UnsavedChangesDialog
        open
        onStay={onStay}
        onDiscard={vi.fn()}
        onSaveAndLeave={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    fireEvent.pointerDown(document.body);
    expect(dialog).toBeInTheDocument();
    expect(onStay).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onStay).toHaveBeenCalledOnce();
  });

  it("czeka na zapis, blokuje ponowne akcje i po błędzie pozwala ponowić", async () => {
    const user = userEvent.setup();
    let rejectSave!: (reason?: unknown) => void;
    const save = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const discard = vi.fn();
    const callbacks = {
      onStay: vi.fn(),
      onDiscard: discard,
      onSaveAndLeave: save,
    };
    const { rerender } = render(<UnsavedChangesDialog open {...callbacks} />);
    const dialog = screen.getByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Zapisz i wyjdź" }),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(
      within(dialog)
        .getAllByRole("button")
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(dialog).toBeInTheDocument();
    rejectSave(new Error("fixture: zapis odrzucony"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać zmian",
    );
    expect(dialog).not.toHaveAttribute("aria-busy", "true");
    expect(
      within(dialog).getByRole("button", { name: "Zapisz i wyjdź" }),
    ).toBeEnabled();
    expect(discard).not.toHaveBeenCalled();

    rerender(<UnsavedChangesDialog open={false} {...callbacks} />);
    rerender(<UnsavedChangesDialog open {...callbacks} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
