import styles from "./auth.module.css";

/**
 * F02-04 / F02-07 / F02-07A: the Auterva mark (the "A" of the panel icon) in front of the word mark.
 * The word carries the name; the mark is decoration.
 */
export function AuthBrand() {
  return (
    <p className={`${styles.brand} ${styles.brandMarked}`}>
      <svg className={styles.brandMark} viewBox="14 14 20 20" aria-hidden="true" focusable="false">
        <path fillRule="evenodd" d="M14 34 22.1 14h3.8L34 34h-4.6l-1.8-4.5h-7.2L18.6 34H14Zm10-13.9-2.1 5.7h4.2L24 20.1Z" />
      </svg>
      AUTERVA
    </p>
  );
}
