import { createLocalSinkProvider, createResendProvider } from "./provider";
import type { WorkerContext } from "./processor";

export function parseMailPayloadKey(value: string | undefined): Buffer {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error("MAIL_PAYLOAD_KEY must be 64 hex characters");
  return Buffer.from(value, "hex");
}

export function getWorkerMailContext(env: Record<string, string | undefined> = process.env): Omit<WorkerContext, "now"> {
  const key = parseMailPayloadKey(env.MAIL_PAYLOAD_KEY);
  const mode = env.MAIL_ENVIRONMENT;
  if (mode !== "development" && mode !== "preview" && mode !== "staging" && mode !== "production")
    throw new Error("MAIL_ENVIRONMENT is required");
  const allowed = (env.MAIL_ALLOWED_RECIPIENTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (mode !== "production" && (allowed.length === 0 || allowed.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))))
    throw new Error("Non-production mail requires an explicit recipient allowlist");
  if (env.MAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("Resend configuration is incomplete");
    return { key, mode, allowedRecipients: new Set(allowed),
      provider: createResendProvider(env.RESEND_API_KEY, env.MAIL_FROM) };
  }
  if (env.MAIL_PROVIDER === "sink" && mode !== "production")
    return { key, mode, allowedRecipients: new Set(allowed), provider: createLocalSinkProvider() };
  throw new Error("Invalid mail provider for environment");
}
