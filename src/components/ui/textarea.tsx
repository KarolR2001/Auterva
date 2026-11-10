import type { TextareaHTMLAttributes } from "react";

import styles from "./ui.module.css";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export function Textarea({ invalid, className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      rows={rows}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={[styles.textInput, styles.textarea, className].filter(Boolean).join(" ")}
    />
  );
}
