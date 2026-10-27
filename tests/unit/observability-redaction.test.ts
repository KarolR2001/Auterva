import { afterEach, expect, test } from "vitest";
import { log, logFailure, runWithLogContext, setLogSink } from "../../src/modules/observability/log";
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
  token: "tok_7f3a9c1d5e8b2a4f6c0d1e3b5a7c9d2f4e6a8b0c",
  cookie: "better-auth.session_token=abcdef1234567890abcdef1234567890",
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
