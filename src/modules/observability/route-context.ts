import { runWithLogContext } from "./log";

/**
 * Wraps a route handler so that every request has its own log context object from the first line of the handler.
 * Authorization helpers only fill that object (actor, role, company); they never create or switch contexts, so
 * concurrent requests and anything after the handler (pool callbacks, timers) cannot see another request's actor.
 */
export function routeContext<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  return (...args: A) => runWithLogContext({}, () => handler(...args));
}
