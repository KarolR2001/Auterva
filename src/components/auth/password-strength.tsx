import { Check, Circle } from "lucide-react";

import {
  type PasswordCriteria,
  type PasswordStrengthLevel,
} from "./password-policy";
import styles from "./auth.module.css";

const labels: Record<PasswordStrengthLevel, string> = {
  weak: "Słabe",
  medium: "Średnie",
  strong: "Mocne",
};
const widths: Record<PasswordStrengthLevel, number> = {
  weak: 25,
  medium: 75,
  strong: 100,
};
// Only the length is a server rule (12-256 characters, account-operations contract); the rest is advice.
const items: Array<[keyof PasswordCriteria, string, "wymagane" | "zalecane"]> = [
  ["minLength", "Co najmniej 12 znaków", "wymagane"],
  ["letterCase", "Małe i wielkie litery", "zalecane"],
  ["number", "Cyfra", "zalecane"],
  ["specialCharacter", "Znak specjalny", "zalecane"],
];

// DS-AUT-004: label, bar and checklist all carry the result; colour is never the only signal.
export function PasswordStrength({
  level,
  tooShort = false,
  criteria,
  id,
}: {
  level: PasswordStrengthLevel;
  tooShort?: boolean;
  criteria: PasswordCriteria;
  id: string;
}) {
  return (
    <div className={styles.strength} id={id} data-level={tooShort ? "short" : level}>
      {/* The live region announces only the level, not the checklist after every keystroke. */}
      <p className={styles.strengthLabel} aria-live="polite">
        Siła hasła: {tooShort ? "Za krótkie" : labels[level]}
      </p>
      <div className={styles.strengthTrack} aria-hidden="true">
        <div className={styles.strengthBar} style={{ width: `${tooShort ? 0 : widths[level]}%` }} />
      </div>
      <ul className={styles.strengthList}>
        {items.map(([key, text, kind]) => (
          <li key={key} data-met={criteria[key]}>
            {criteria[key] ? (
              <Check aria-hidden="true" size={16} />
            ) : (
              <Circle aria-hidden="true" size={16} />
            )}
            <span>
              {text} <span className={styles.strengthKind}>({kind})</span>
              <span className={styles.visuallyHidden}>
                {criteria[key] ? ": spełnione" : ": oczekuje"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
