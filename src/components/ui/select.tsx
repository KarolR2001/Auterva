import type { SelectHTMLAttributes } from "react";

import styles from "./ui.module.css";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export function Select({ invalid, className, ...props }: SelectProps) {
  return (
    <select
      {...props}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={[styles.textInput, className].filter(Boolean).join(" ")}
    />
  );
}
