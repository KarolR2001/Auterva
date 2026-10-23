import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./ui.module.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tertiary" | "destructive";
  size?: "sm" | "md" | "lg";
  width?: "hug" | "fill";
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  iconPosition?: "leading" | "trailing";
};

export function Button({
  variant = "primary",
  size = "md",
  width = "hug",
  loading = false,
  loadingLabel = "Ładowanie",
  icon,
  iconPosition = "leading",
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        styles.button,
        styles[`button_${variant}`],
        styles[`button_${size}`],
        loading && styles.button_loading,
        width === "fill" && styles.button_fill,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? (
        <>
          <span className={styles.buttonOriginal}>
            {icon && iconPosition === "leading" && (
              <span aria-hidden="true" className={styles.buttonIcon}>
                {icon}
              </span>
            )}
            <span className={styles.buttonLabel}>{children}</span>
            {icon && iconPosition === "trailing" && (
              <span aria-hidden="true" className={styles.buttonIcon}>
                {icon}
              </span>
            )}
          </span>
          <span className={styles.buttonLoading}>
            <LoaderCircle
              aria-hidden="true"
              size={16}
              className={styles.spinner}
            />
            <span className={styles.buttonLoadingText}>{loadingLabel}</span>
          </span>
        </>
      ) : (
        <>
          {icon && iconPosition === "leading" && (
            <span aria-hidden="true" className={styles.buttonIcon}>
              {icon}
            </span>
          )}
          {children}
          {icon && iconPosition === "trailing" && (
            <span aria-hidden="true" className={styles.buttonIcon}>
              {icon}
            </span>
          )}
        </>
      )}
    </button>
  );
}
