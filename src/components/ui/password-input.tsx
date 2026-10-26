"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

import { TextInput } from "./text-input";
import styles from "./ui.module.css";

type Visibility = "hidden" | "shown";

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "autoComplete"
> & {
  id: string;
  label: string;
  visibility: Visibility;
  autoComplete: "current-password" | "new-password";
  error?: string;
  hint?: string;
  onVisibilityChange: (visibility: Visibility) => void;
};

export function PasswordInput({
  id,
  label,
  visibility,
  autoComplete,
  error,
  hint,
  onVisibilityChange,
  className,
  ...props
}: PasswordInputProps) {
  const [capsLock, setCapsLock] = useState(false);
  const shown = visibility === "shown";
  const supportId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const capsId = `${id}-caps-lock`;
  const describedBy =
    [props["aria-describedby"], supportId, capsLock && capsId]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={styles.formField}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.passwordControl}>
        <TextInput
          {...props}
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          onKeyDown={(event) => {
            setCapsLock(event.getModifierState("CapsLock"));
            props.onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            setCapsLock(event.getModifierState("CapsLock"));
            props.onKeyUp?.(event);
          }}
          aria-describedby={describedBy}
          aria-invalid={error ? true : props["aria-invalid"]}
          className={[styles.passwordInput, className]
            .filter(Boolean)
            .join(" ")}
        />
        <button
          type="button"
          className={styles.passwordToggle}
          aria-label={shown ? "Ukryj hasło" : "Pokaż hasło"}
          aria-pressed={shown}
          disabled={props.disabled}
          onClick={() => onVisibilityChange(shown ? "hidden" : "shown")}
        >
          {shown ? (
            <EyeOff aria-hidden="true" size={20} />
          ) : (
            <Eye aria-hidden="true" size={20} />
          )}
        </button>
      </div>
      {error ? (
        <p id={supportId} className={styles.fieldError}>
          {error}
        </p>
      ) : hint ? (
        <p id={supportId} className={styles.fieldHint}>
          {hint}
        </p>
      ) : null}
      {capsLock && (
        <p id={capsId} className={styles.fieldHint} role="status">
          Caps Lock jest włączony
        </p>
      )}
    </div>
  );
}
