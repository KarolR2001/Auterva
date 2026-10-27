import { AsyncLocalStorage } from "node:async_hooks";
import { redactFields, safeErrorCode } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = { requestId?: string; actorId?: string; actorRole?: string; organizationId?: string; operation?: string };
export type LogSink = (line: string, level: LogLevel) => void;

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const store = new AsyncLocalStorage<LogContext>();
let sink: LogSink = (line, level) => { (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`); };
let component = process.env.AUTERVA_COMPONENT ?? "web";
let clock: () => Date = () => new Date();

/** Test seam: replaces the output and returns a restore function. */
export function setLogSink(next: LogSink): () => void {
  const previous = sink;
  sink = next;
  return () => { sink = previous; };
}
export function setLogComponent(name: string) { component = name; }
export function setLogClock(next: () => Date): () => void { const old = clock; clock = next; return () => { clock = old; }; }

export function runWithLogContext<T>(context: LogContext, work: () => T): T {
  return store.run({ ...store.getStore(), ...context }, work);
}
export function currentLogContext(): LogContext { return store.getStore() ?? {}; }

function threshold(): number {
  const configured = process.env.AUTERVA_LOG_LEVEL as LogLevel | undefined;
  return levels[configured ?? "info"] ?? levels.info;
}

/** One JSON object per line. Context fields are written after redaction and can't be overridden by free fields. */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (levels[level] < threshold()) return;
  const context = currentLogContext();
  const safe = redactFields({ ...fields });
  const record = { ...safe, time: clock().toISOString(), level, component, event,
    requestId: context.requestId ?? safe.requestId, actorId: context.actorId ?? safe.actorId,
    actorRole: context.actorRole ?? safe.actorRole, organizationId: context.organizationId ?? safe.organizationId,
    operation: context.operation ?? safe.operation };
  const line = JSON.stringify(record, (_key, value) => value === undefined ? undefined : value);
  try { sink(line, level); } catch { /* logging never breaks the request */ }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => logEvent("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => logEvent("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => logEvent("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => logEvent("error", event, fields),
};

/** Logs a failure with a safe machine code only; the message may hold user input and is never written. */
export function logFailure(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  logEvent("error", event, { ...fields, outcome: "failure", errorName: error instanceof Error ? error.name : "NonError",
    errorCode: safeErrorCode(error) });
}
