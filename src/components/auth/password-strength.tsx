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
const items: Array<[keyof PasswordCriteria, string]> = [
  ["minLength", "Co najmniej 12 znaków"],
  ["letterCase", "Małe i wielkie litery"],
  ["number", "Cyfra"],
  ["specialCharacter", "Znak specjalny"],
];

// DS-AUT-004: label, bar and checklist all carry the result; colour is never the only signal.
export function PasswordStrength({
  level,
  criteria,
  id,
}: {
  level: PasswordStrengthLevel;
  criteria: PasswordCriteria;
  id: string;
}) {
  return (
    <div className={styles.strength} id={id} data-level={level}>
      {/* The live region announces only the level, not the checklist after every keystroke. */}
      <p className={styles.strengthLabel} aria-live="polite">
        Siła hasła: {labels[level]}
      </p>
      <div className={styles.strengthTrack} aria-hidden="true">
        <div className={styles.strengthBar} style={{ width: `${widths[level]}%` }} />
      </div>
      <ul className={styles.strengthList}>
        {items.map(([key, text]) => (
          <li key={key} data-met={criteria[key]}>
            {criteria[key] ? (
              <Check aria-hidden="true" size={16} />
            ) : (
              <Circle aria-hidden="true" size={16} />
            )}
            <span>
              {text}
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
