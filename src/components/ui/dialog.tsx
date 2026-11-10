"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useId, useRef, type ReactNode } from "react";

import { Button } from "./button";
import styles from "./ui.module.css";

type DialogAction = { label: string; onClick: () => void };

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type?: "confirm" | "info" | "destructive" | "form";
  title: string;
  description?: string;
  children?: ReactNode;
  primaryAction: DialogAction;
  secondaryAction?: DialogAction;
  /** Optional control shown in the header next to the title (e.g. a secondary link); the caller hides it where it does not fit. */
  headerAction?: ReactNode;
};

export function Dialog({
  open,
  onOpenChange,
  type = "confirm",
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  headerAction,
}: DialogProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const descriptionId = useId();
  const cancelAction =
    secondaryAction ??
    (type === "destructive"
      ? { label: "Anuluj", onClick: () => onOpenChange(false) }
      : undefined);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.dialogOverlay} />
        <DialogPrimitive.Content
          className={styles.dialogContent}
          aria-modal="true"
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={(event) => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            if (type === "destructive") {
              const cancelButton = actionsRef.current?.querySelector("button");
              if (cancelButton) {
                event.preventDefault();
                cancelButton.focus();
              }
            }
          }}
          onCloseAutoFocus={(event) => {
            if (previousFocus.current) {
              event.preventDefault();
              previousFocus.current.focus();
            }
          }}
        >
          {headerAction ? (
            <div className={styles.dialogHeader}>
              <DialogPrimitive.Title className={styles.dialogTitle}>
                {title}
              </DialogPrimitive.Title>
              <div className={styles.dialogHeaderAction}>{headerAction}</div>
            </div>
          ) : (
            <DialogPrimitive.Title className={styles.dialogTitle}>
              {title}
            </DialogPrimitive.Title>
          )}
          {description && (
            <DialogPrimitive.Description
              id={descriptionId}
              className={styles.dialogDescription}
            >
              {description}
            </DialogPrimitive.Description>
          )}
          {children && <div className={styles.dialogBody}>{children}</div>}
          <div ref={actionsRef} className={styles.dialogActions}>
            {cancelAction && (
              <Button variant="secondary" onClick={cancelAction.onClick}>
                {cancelAction.label}
              </Button>
            )}
            <Button
              variant={type === "destructive" ? "destructive" : "primary"}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
