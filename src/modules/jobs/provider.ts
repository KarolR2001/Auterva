import type { MailPayload } from "./outbox";
import type { MailProvider } from "./processor";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export function createResendProvider(apiKey: string, from: string, fetcher: Fetcher = fetch): MailProvider {
  if (!apiKey || !from || /[\r\n]/.test(from)) throw new Error("Invalid mail provider configuration");
  return { async send(mail: MailPayload, idempotencyKey: string) {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [mail.recipient], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (response.ok) {
      const body = await response.json().catch(() => null) as { id?: unknown } | null;
      return typeof body?.id === "string" && body.id.length > 0
        ? { kind: "accepted" as const, providerId: body.id } : { kind: "transient" as const };
    }
    // 409 can also mean a concurrent request with the same provider key. Retry only inside its 24h window.
    return response.status === 409 || response.status === 429 || response.status >= 500
      ? { kind: "transient" as const } : { kind: "permanent" as const };
  } };
}

export function createLocalSinkProvider(): MailProvider {
  return { async send(_mail, idempotencyKey) { return { kind: "accepted", providerId: `sink:${idempotencyKey}` }; } };
}
