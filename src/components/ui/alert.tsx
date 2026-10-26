import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./ui.module.css";

type AlertProps = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
};

const icons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function Alert({
  tone,
  title,
  children,
  action,
  onDismiss,
}: AlertProps) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={[styles.alert, styles[`alert_${tone}`]].join(" ")}
    >
      <Icon aria-hidden="true" size={20} className={styles.alertIcon} />
      <div className={styles.alertContent}>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
        {action && (
          <button
            type="button"
            className={styles.alertAction}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          className={styles.alertDismiss}
          aria-label={`Zamknij komunikat: ${title}`}
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={20} />
        </button>
      )}
    </div>
  );
}
