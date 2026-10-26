import { AsyncLocalStorage } from "node:async_hooks";

// Next bundles the custom server and Route Handlers separately. A process-wide
// Symbol keeps both imports on the same AsyncLocalStorage instance.
const slot = Symbol.for("auterva.ingress.verifiedSocketAddress");
const globals = globalThis as unknown as Record<symbol, AsyncLocalStorage<string> | undefined>;
const addressContext = globals[slot] ?? (globals[slot] = new AsyncLocalStorage<string>());

export function runWithTrustedClientAddress<T>(address: string, action: () => T): T {
  return addressContext.run(address, action);
}

export function currentTrustedClientAddress(): string | undefined {
  return addressContext.getStore();
}
