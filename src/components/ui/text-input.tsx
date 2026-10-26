import type { InputHTMLAttributes } from "react";

import styles from "./ui.module.css";

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  invalid?: boolean;
};

export function TextInput({
  invalid,
  className,
  type = "text",
  ...props
}: TextInputProps) {
  return (
    <input
      {...props}
      type={type}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={[styles.textInput, className].filter(Boolean).join(" ")}
    />
  );
}
