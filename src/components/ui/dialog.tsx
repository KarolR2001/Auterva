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
}: DialogProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const descriptionId = useId();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.dialogOverlay} />
        <DialogPrimitive.Content
          className={styles.dialogContent}
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            if (previousFocus.current) {
              event.preventDefault();
              previousFocus.current.focus();
            }
          }}
        >
          <DialogPrimitive.Title className={styles.dialogTitle}>
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description
              id={descriptionId}
              className={styles.dialogDescription}
            >
              {description}
            </DialogPrimitive.Description>
          )}
          {children && <div className={styles.dialogBody}>{children}</div>}
          <div className={styles.dialogActions}>
            {secondaryAction && (
              <Button variant="secondary" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
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
