// Server policy (#12/#18, account-operations): 12-256 characters. The other criteria are guidance only
// and never block submit, so the UI cannot reject a password the server would accept.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export type PasswordStrengthLevel = "weak" | "medium" | "strong";
export type PasswordCriteria = {
  minLength: boolean;
  letterCase: boolean;
  number: boolean;
  specialCharacter: boolean;
};

export function evaluatePassword(value: string): {
  valid: boolean;
  level: PasswordStrengthLevel;
  criteria: PasswordCriteria;
} {
  const length = [...value].length;
  const criteria: PasswordCriteria = {
    minLength: length >= PASSWORD_MIN,
    letterCase: /\p{Ll}/u.test(value) && /\p{Lu}/u.test(value),
    number: /\d/.test(value),
    specialCharacter: /[^\p{L}\d]/u.test(value),
  };
  const met = Object.values(criteria).filter(Boolean).length;
  const level: PasswordStrengthLevel = !criteria.minLength
    ? "weak"
    : met === 4
      ? "strong"
      : met >= 3
        ? "medium"
        : "weak";
  return { valid: length >= PASSWORD_MIN && length <= PASSWORD_MAX, level, criteria };
}
