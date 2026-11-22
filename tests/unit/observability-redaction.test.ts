import { afterEach, expect, test } from "vitest";
import { bindLogActor, currentLogContext, log, logEvent, logFailure, runWithLogContext, setLogSink, withoutLogContext } from "../../src/modules/observability/log";
import { routeContext } from "../../src/modules/observability/route-context";
import { redactFields, safeErrorCode, scrubString } from "../../src/modules/observability/redact";

let restore = () => {};
afterEach(() => restore());
function capture() {
  const lines: string[] = [];
  restore = setLogSink((line) => lines.push(line));
  return lines;
}

const secrets = {
  chat: "Dzień dobry, proszę o fakturę za wynajem BMW",
  password: "Correct-Horse-Battery-9",
  // Built at run time so secret scanners do not mistake these test inputs for real keys.
  token: `${"tok"}_${"7f3a".repeat(10)}`,
  cookie: `better-auth.session_token=${"abcd1234".repeat(4)}`,
  key: "a".repeat(64),
  email: "jan.kowalski@firma.example.test",
  audit: "Zmieniono cenę z 100 na 200",
};

test("one JSON object per line with the correlation fields and no free text", () => {
  const lines = capture();
  runWithLogContext({ requestId: "11111111-1111-4111-8111-111111111111", actorId: "actor-1", actorRole: "ADMIN_FIRMY", organizationId: "org-1" }, () =>
    log.info("fleet.update", { operation: "fleet.update", outcome: "success", durationMs: 12 }));
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("\n");
  expect(JSON.parse(lines[0])).toMatchObject({ level: "info", event: "fleet.update", requestId: "11111111-1111-4111-8111-111111111111",
    actorId: "actor-1", actorRole: "ADMIN_FIRMY", organizationId: "org-1", operation: "fleet.update", outcome: "success", durationMs: 12 });
  expect(JSON.parse(lines[0]).time).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
});

test("chat text, credentials, cookies, keys, e-mail addresses and audit content never reach a log line", () => {
  const lines = capture();
  log.info("chat.send", {
    message: secrets.chat, text: secrets.chat, body: { content: secrets.chat }, password: secrets.password,
    token: secrets.token, authorization: `Bearer ${secrets.token}`, cookie: secrets.cookie, headers: { cookie: secrets.cookie },
    encryptionKey: secrets.key, recipient: secrets.email, auditContent: secrets.audit, payload: { x: secrets.audit },
    // free-text values under harmless names are scrubbed by value
    note2: `contact ${secrets.email} with ${secrets.key} using Bearer ${secrets.token}`,
    detail: `postgresql://user:${secrets.password}@db.internal:5432/auterva`,
  });
  const line = lines[0];
  for (const secret of Object.values(secrets)) expect(line).not.toContain(secret);
  expect(line).not.toContain("Bearer tok_");
  expect(line).not.toContain("db.internal");
  expect(line).toContain("[redacted]");
});

test("errors are logged by name and machine code, never by message", () => {
  const lines = capture();
  logFailure("job.failed", new Error(`failed for ${secrets.email} password ${secrets.password}`), { operation: "jobs" });
  logFailure("job.failed", new Error("MAIL_TRANSIENT"), { operation: "jobs" });
  expect(lines[0]).not.toContain(secrets.email);
  expect(lines[0]).not.toContain(secrets.password);
  expect(JSON.parse(lines[0])).toMatchObject({ errorName: "Error", errorCode: "UNKNOWN", outcome: "failure" });
  expect(JSON.parse(lines[1])).toMatchObject({ errorCode: "MAIL_TRANSIENT" });
  expect(safeErrorCode({ code: "P2002" })).toBe("P2002");
  expect(safeErrorCode({ code: "has spaces and user@example.test" })).toBe("UNKNOWN");
  expect(safeErrorCode(Object.assign(new Error("db"), { code: "P2002" }))).toBe("P2002");
});

test("free fields cannot overwrite the event, level or correlation context", () => {
  const lines = capture();
  runWithLogContext({ requestId: "ctx-id" }, () => log.warn("real", { event: "forged", level: "debug", requestId: "forged-id" }));
  expect(JSON.parse(lines[0])).toMatchObject({ event: "real", level: "warn", requestId: "ctx-id" });
});

test("string scrubbing truncates and masks nested values", () => {
  expect(scrubString(`x ${secrets.email}`)).toBe("x [email]");
  expect(scrubString("a".repeat(500)).length).toBeLessThan(250);
  expect(redactFields({ nested: { deep: { deeper: { deepest: { value: secrets.email } } } } })).toEqual({ nested: { deep: { deeper: { deepest: "[truncated]" } } } });
});

test("invitation-token paths are masked (W6)", () => {
  expect(scrubString("Request body exceeded 10MB for /api/auth/invitation/abc123-secret-token/")).toBe("Request body exceeded 10MB for /api/auth/invitation/[token]/");
});

test("key=, token= and secret= are masked without ?/& before them, but plain words are not (#180)", () => {
  expect(scrubString("failed with key=abc123 and then token=xyz789 secret=s3cr3t!")).toBe("failed with key=[redacted] and then token=[redacted] secret=[redacted]");
  expect(scrubString("dsn api_key=abc123 access-token=def456 KEY=UPPER")).toBe("dsn api_key=[redacted] access-token=[redacted] KEY=[redacted]");
  expect(scrubString('{"x":"key=abc123"}')).toBe('{"x":"key=[redacted]"}');
  expect(scrubString("/x?a=1&key=abc123&page=2")).toBe("/x?a=1&key=[redacted]&page=2");
  // No false hits: the name must start a word and be followed directly by "=".
  const plain = "monkey=banana hotkey=F5 the key was rotated; token bucket full; secretary=Ann keyboard=us turkey = roast";
  expect(scrubString(plain)).toBe(plain);
});

test("a throwing getter or unserialisable field never breaks the caller (N1)", () => {
  const lines = capture();
  const hostile = { get boom(): string { throw new Error("getter"); } };
  expect(() => logEvent("error", "x", { hostile, ok: "kept" })).not.toThrow();
  expect(lines[0]).toContain("kept");
  const circular: Record<string, unknown> = {}; circular.self = circular;
  expect(() => logEvent("error", "x", { circular })).not.toThrow();
  expect(lines.length).toBeGreaterThanOrEqual(1);
});

test("stack, cause, meta and data fields, binary values, query secrets and reset links are masked (N1)", () => {
  const lines = capture();
  const sessionId = `Ab1${"x".repeat(29)}`;
  log.error("x", { stack: "at secret.ts:1", cause: new Error("inner"), meta: { a: 1 }, data: { b: 2 }, buffer: Buffer.from("secret-bytes"),
    typed: new Uint8Array([1, 2, 3]), link: "/api/x?token=abc123&page=2&code=987654", reset: "/reset-password/opaque-reset-value/confirm",
    verify: "/verify-email/opaque-verify-value", session: `sid ${sessionId} end` });
  const line = lines[0];
  for (const leak of ["at secret.ts", "inner", "secret-bytes", "abc123", "987654", "opaque-reset-value", "opaque-verify-value", sessionId]) expect(line).not.toContain(leak);
  expect(line).toContain("[binary]");
  expect(line).toContain("page=2");
});

test("each routeContext-wrapped handler has its own actor and company, also when run from one frame in parallel (R1)", async () => {
  const lines = capture();
  async function requireActor(user: string, org: string) {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
    bindLogActor(currentLogContext(), { userId: user, role: "ADMIN_FIRMY", organizationId: org });
  }
  const handler = routeContext(async (user: string, org: string) => {
    await requireActor(user, org);
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
    log.error("http.internal_error", { requestId: `r-${user}`, operation: "fleet", status: 500 });
  });
  await Promise.all(["a", "b", "c", "d"].map((u) => handler(u, `org-${u}`)));
  const parsed = lines.map((line) => JSON.parse(line));
  expect(parsed).toHaveLength(4);
  for (const line of parsed) {
    const user = String(line.requestId).slice(2);
    expect(line).toMatchObject({ actorId: user, organizationId: `org-${user}` });
  }
  log.error("after", {}); // outside any handler: nothing leaked
  expect(JSON.parse(lines[4]).actorId).toBeUndefined();
});

test("withoutLogContext strips the request context (pool callbacks)", async () => {
  const lines = capture();
  await routeContext(async () => {
    bindLogActor(currentLogContext(), { userId: "u", role: "ADMIN_FIRMY", organizationId: "o" });
    withoutLogContext(() => log.error("db.pool_error", {}));
  })();
  expect(JSON.parse(lines[0]).actorId).toBeUndefined();
});

test("explicit contexts do not leak between runs (workers, realtime)", () => {
  const lines = capture();
  runWithLogContext({ organizationId: "org-a" }, () => log.info("a"));
  log.info("b");
  expect(JSON.parse(lines[0]).organizationId).toBe("org-a");
  expect(JSON.parse(lines[1]).organizationId).toBeUndefined();
});

test("#401: TOTP secrets, otpauth URIs, recovery codes, calendar feed addresses and chat frames never reach a log line", () => {
  const lines = capture();
  const totp = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const recovery = "7HQ2-9KDM-X4PZ-3WRT";
  const feedToken = "feed" + "Z9x".repeat(14);
  log.info("auth.mfa", {
    totpSecret: totp, recoveryCodes: [recovery], otp: "123456", setupUri: `otpauth://totp/Auterva:jan@firma.example.test?secret=${totp}&issuer=Auterva`,
    detail: `enrolment secret ${totp} for jan@firma.example.test`,
    feedUrl: `https://acme.example.test/api/calendar/feed/${feedToken}.ics`, path: `/api/calendar/feed/${feedToken}`,
    frame: { type: "chat.send", text: secrets.chat, clientMessageId: "m-1" }, ws: JSON.stringify({ type: "chat.send", text: secrets.chat }),
  });
  logFailure("ws.message_failed", new Error(`bad frame ${secrets.chat}`), { operation: "ws.message", outcome: "failure" });
  const all = lines.join("\n");
  for (const secret of [totp, recovery, "123456", feedToken, "jan@firma.example.test", secrets.chat]) expect(all, secret).not.toContain(secret);
  for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
});
