// Server policy (#12/#18, account-operations): 12-256 characters. The other criteria are guidance only
// and never block submit, so the UI cannot reject a password the server would accept.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export type PasswordStrengthLevel = "weak" | "medium" | "strong";
export const PASSWORD_LONG = 16;

export type PasswordCriteria = {
  minLength: boolean;
  letterCase: boolean;
  number: boolean;
  specialCharacter: boolean;
};

export function evaluatePassword(value: string): {
  valid: boolean;
  level: PasswordStrengthLevel;
  tooShort: boolean;
  criteria: PasswordCriteria;
} {
  const length = [...value].length;
  const criteria: PasswordCriteria = {
    minLength: length >= PASSWORD_MIN,
    letterCase: /\p{Ll}/u.test(value) && /\p{Lu}/u.test(value),
    number: /\d/.test(value),
    specialCharacter: /[^\p{L}\d]/u.test(value),
  };
  // Informational meter (D-45/D-46). Below 12 characters there is no level at all ("too short").
  // From 12 on, each met recommendation (case, digit, special) scores 1 and a length >= 16 adds 1:
  // score 3+ is strong, 2 medium, otherwise weak. It never changes `valid`.
  const score =
    [criteria.letterCase, criteria.number, criteria.specialCharacter].filter(Boolean).length +
    (length >= PASSWORD_LONG ? 1 : 0);
  const level: PasswordStrengthLevel = score >= 3 ? "strong" : score === 2 ? "medium" : "weak";
  return { valid: length >= PASSWORD_MIN && length <= PASSWORD_MAX, level, tooShort: !criteria.minLength, criteria };
}
