"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Button } from "../ui/button";
import styles from "./panel.module.css";

type UnsavedChangesDialogProps = {
  open: boolean;
  contextLabel?: string;
  onStay: () => void;
  onDiscard: () => void | Promise<void>;
  onSaveAndLeave: () => void | Promise<void>;
};

export const UnsavedChangesSuspensionContext = createContext(false);

export function UnsavedChangesDialog({
  open,
  contextLabel,
  onStay,
  onDiscard,
  onSaveAndLeave,
}: UnsavedChangesDialogProps) {
  const suspended = useContext(UnsavedChangesSuspensionContext);
  const descriptionId = useId();
  const actions = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<"discard" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (suspended && open) onStay();
  }, [suspended, open, onStay]);

  async function run(action: "discard" | "save") {
    if (pending) return;
    setError(null);
    setPending(action);
    try {
      await (action === "save" ? onSaveAndLeave() : onDiscard());
    } catch {
      setError(
        action === "save"
          ? "Nie udało się zapisać zmian. Spróbuj ponownie."
          : "Nie udało się opuścić formularza. Spróbuj ponownie.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <DialogPrimitive.Root
      open={open && !suspended}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onStay();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.unsavedOverlay} />
        <DialogPrimitive.Content
          role="alertdialog"
          aria-modal="true"
          aria-describedby={descriptionId}
          aria-busy={pending ? "true" : undefined}
          className={styles.unsavedDialog}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            setError(null);
            previousFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            actions.current?.querySelector("button")?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (suspended) {
              event.preventDefault();
              return;
            }
            if (previousFocus.current) {
              event.preventDefault();
              previousFocus.current.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className={styles.unsavedTitle}>
            Niezapisane zmiany
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id={descriptionId}
            className={styles.unsavedDescription}
          >
            Masz niezapisane zmiany{contextLabel ? ` w: ${contextLabel}` : ""}.
            Możesz zostać, odrzucić zmiany albo zapisać je przed wyjściem.
          </DialogPrimitive.Description>
          {error && (
            <p role="alert" className={styles.unsavedError}>
              {error}
            </p>
          )}
          <div ref={actions} className={styles.unsavedActions}>
            <Button
              variant="secondary"
              disabled={Boolean(pending)}
              onClick={onStay}
            >
              Zostań
            </Button>
            <Button
              variant="destructive"
              disabled={Boolean(pending)}
              loading={pending === "discard"}
              loadingLabel="Odrzucanie zmian"
              onClick={() => void run("discard")}
            >
              Odrzuć zmiany
            </Button>
            <Button
              disabled={Boolean(pending)}
              loading={pending === "save"}
              loadingLabel="Zapisywanie zmian"
              onClick={() => void run("save")}
            >
              Zapisz i wyjdź
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
