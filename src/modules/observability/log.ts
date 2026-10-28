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

/** Runs `work` with this context object (merged over the parent's); later mutations of the object stay visible. */
export function runWithLogContext<T>(context: LogContext, work: () => T): T {
  return store.run(Object.assign(context, { ...store.getStore(), ...definedOnly(context) }), work);
}
const definedOnly = (context: LogContext) => Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined));
export function currentLogContext(): LogContext { return store.getStore() ?? {}; }

/**
 * Web only: gives the current request chain one mutable context object so that an actor resolved later in an awaited
 * helper is visible to the handler's own error logging. Must be called in the synchronous prefix of the helper
 * (enterWith in a callee after an await would not reach the caller). Other processes use runWithLogContext explicitly,
 * because a long-lived server loop must never inherit one connection's actor.
 */
export function ensureLogContext(): LogContext {
  const existing = store.getStore();
  if (existing) return existing;
  if (component !== "web") return {};
  const created: LogContext = {};
  store.enterWith(created);
  return created;
}

export function bindLogActor(context: LogContext, actor: { userId: string; role: string; organizationId: string | null }): void {
  context.actorId = actor.userId;
  context.actorRole = actor.role;
  if (actor.organizationId) context.organizationId = actor.organizationId;
}

function threshold(): number {
  const configured = process.env.AUTERVA_LOG_LEVEL as LogLevel | undefined;
  return levels[configured ?? "info"] ?? levels.info;
}

/** One JSON object per line. Context fields are written after redaction and can't be overridden by free fields. */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  // Entirely guarded: a throwing getter or serializer inside a field must never break the request path.
  try {
    if (levels[level] < threshold()) return;
    const context = currentLogContext();
    const safe = redactFields({ ...fields });
    const record = { ...safe, time: clock().toISOString(), level, component, event,
      requestId: context.requestId ?? safe.requestId, actorId: context.actorId ?? safe.actorId,
      actorRole: context.actorRole ?? safe.actorRole, organizationId: context.organizationId ?? safe.organizationId,
      operation: context.operation ?? safe.operation };
    sink(JSON.stringify(record), level);
  } catch { /* logging never breaks the request */ }
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
