import {
  cloneElement,
  type InputHTMLAttributes,
  type ReactElement,
} from "react";

import styles from "./ui.module.css";

type FormFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  optionalLabel?: string;
  hint?: string;
  error?: string;
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
};

export function FormField({
  id,
  label,
  required,
  optionalLabel,
  hint,
  error,
  children,
}: FormFieldProps) {
  const isRequired = required ?? children.props.required;
  const supportId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const describedBy =
    [children.props["aria-describedby"], supportId].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={styles.formField}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
        {isRequired && <span aria-hidden="true"> *</span>}
        {!isRequired && optionalLabel && (
          <span className={styles.optionalLabel}> {optionalLabel}</span>
        )}
      </label>
      {cloneElement(children, {
        id,
        required: isRequired,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })}
      {error ? (
        <p className={styles.fieldError} id={supportId}>
          {error}
        </p>
      ) : hint ? (
        <p className={styles.fieldHint} id={supportId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
