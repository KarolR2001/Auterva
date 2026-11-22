import { randomUUID } from "node:crypto";
import { runWithLogContext } from "./log";
import { reportInternalError } from "./http-observe";

/** Next signals redirects, 404s and aborts by throwing digest-tagged errors; they are control flow, not failures. */
const isNextControlFlow = (error: unknown) =>
  typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string"
  && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT)/.test((error as { digest: string }).digest);

function internalErrorResponse(error: unknown): Response {
  // #399: an exception no handler caught would otherwise reach Next's own error logger with the driver message and stack.
  // It is reported by class and code only (redacted logger) and answered with a fixed, message-free body.
  const requestId = reportInternalError(error, randomUUID(), "route");
  return Response.json({ code: "INTERNAL_ERROR" }, { status: 500, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

/**
 * Wraps a route handler so that every request has its own log context object from the first line of the handler.
 * Authorization helpers only fill that object (actor, role, company); they never create or switch contexts, so
 * concurrent requests and anything after the handler (pool callbacks, timers) cannot see another request's actor.
 * An exception that escapes the handler becomes a neutral 500 (see internalErrorResponse).
 */
export function routeContext<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  return (...args: A) => runWithLogContext({}, () => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          if (isNextControlFlow(error)) throw error;
          return internalErrorResponse(error);
        }) as R;
      }
      return result;
    } catch (error) {
      if (isNextControlFlow(error)) throw error;
      return internalErrorResponse(error) as R;
    }
  });
}
