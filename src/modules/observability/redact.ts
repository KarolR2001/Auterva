// Redaction for structured logs (#58). Structural fields (structuralKeys) always pass; every other field goes through
// a name deny-list, then value scrubbing (e-mail, tokens, URLs, binary). Chat text, tokens, cookies, passwords, e-mail addresses in
// free text, keys and audit content never reach a log line.

const sensitiveKey = /stack|cause|meta|data|pass(word|phrase)?|secret|token|cookie|authorization|auth(or)?|bearer|credential|api[-_]?key|private|signature|session|otp|totp|mfa|recovery|backup[-_]?code|payload|body|content|text|message|note|audit|recipient|email|mail|phone|address|reference|query|url|dsn|connection/i;

// Fields that are safe by construction even though a name might look sensitive (e.g. "messageStatus" is not used).
const structuralKeys = new Set([
  "event", "level", "time", "component", "requestId", "actorId", "actorRole", "organizationId", "operation",
  "outcome", "durationMs", "status", "statusClass", "errorCode", "errorName", "method", "route", "routeType",
  "kind", "count", "attempt", "target", "check", "alert", "severity", "state", "digest", "jobId", "jobKind",
  "reason", "port", "rule",
]);

const patterns: Array<[RegExp, string]> = [
  // Secrets carried in a query string or in the path of reset/verification links.
  [/([?&;](?:token|code|secret|key|password|signature|state|sig|otp)=)[^&\s"']*/gi, "$1[redacted]"],
  // key=, token= and secret= are masked wherever they start a name, also in free text without ?/& before them.
  // A letter or digit before the name (monkey=, hotkey=) is not a match; `_`/`-` is (api_key=, access-token=).
  [/(?<![A-Za-z0-9])((?:token|secret|key)=)[^&\s"']*/gi, "$1[redacted]"],
  [/(\/(?:reset-password|verify-email|verify|activate)\/)[^/\s?#]+/gi, "$1[token]"],
  // W6 (OWASP_CONTROLS §6): a path carrying an invitation token must never be logged verbatim.
  [/\/api\/auth\/invitation\/[^/\s?#]+/gi, "/api/auth/invitation/[token]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, "[jwt]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, "[url-with-credentials]"],
  [/\b(?:postgres(?:ql)?|mysql|s3|https?):\/\/[^\s]+/gi, "[url]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[hex]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[token]"],
  // Opaque session identifiers: exactly 32 URL-safe characters mixing letters and digits.
  [/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32}\b/g, "[token]"],
];

const maxString = 200;
const maxDepth = 3;

export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of patterns) out = out.replace(pattern, replacement);
  return out.length > maxString ? `${out.slice(0, maxString)}…` : out;
}

export function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (!structuralKeys.has(key) && sensitiveKey.test(key)) return "[redacted]";
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[binary]";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return { errorName: value.name, errorCode: safeErrorCode(value) };
  if (depth >= maxDepth) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(key, item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const childKey of Object.keys(source).slice(0, 30)) {
      try { result[childKey] = redactValue(childKey, source[childKey], depth + 1); } catch { result[childKey] = "[unreadable]"; }
    }
    return result;
  }
  return "[unsupported]";
}

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) result[key] = redactValue(key, value);
  return result;
}

/** Error messages can carry user input; only stable machine codes (UPPER_SNAKE) are kept. */
export function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/^[A-Z][A-Z0-9_]{2,63}$/.test(raw)) return raw;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code;
  return "UNKNOWN";
}
