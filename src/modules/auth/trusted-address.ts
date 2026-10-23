import { isIP } from "node:net";

// Only a server adapter may pass this value. Never read X-Forwarded-For or
// another client-supplied header here. #13 supplies the verified ingress.
export function trustedClientAddress(value: string | undefined, mode = process.env.NODE_ENV): string {
  if (value && isIP(value)) return value;
  if (mode === "production") throw new Error("Missing trusted client address");
  return "unknown";
}
