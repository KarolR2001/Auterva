import { expect, test, vi } from "vitest";
import { createResendProvider } from "../../src/modules/jobs/provider";

const mail = { kind: "MAIL_INVITATION" as const, scope: "COMPANY_ADMIN" as const, organizationId: "fixture-org", recipient: "qa@example.test",
  referenceId: "fixture", url: "https://admin.example.test/admin/zaproszenie/token", subject: "Test", text: "Test body" };

test("provider submits stable idempotency key and handles accepted response", async () => {
  const fetcher = vi.fn(async (input: string, init: RequestInit) => {
    expect(input).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    return new Response(JSON.stringify({ id: "email-one" }), { status: 200 });
  });
  const result = await createResendProvider("fixture-key", "Auterva <mail@example.test>", fetcher).send(mail, "job-one");
  expect(result).toEqual({ kind: "accepted", providerId: "email-one" });
  const [url, request] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect(new Headers(request.headers).get("Idempotency-Key")).toBe("job-one");
  expect(JSON.parse(String(request.body))).toMatchObject({ to: ["qa@example.test"], subject: "Test", text: "Test body" });
});

test("uncertain response retries same key; invalid payload is terminal", async () => {
  const retry = createResendProvider("fixture-key", "mail@example.test", async () => new Response("{}", { status: 503 }));
  expect(await retry.send(mail, "job-one")).toEqual({ kind: "transient" });
  const invalid = createResendProvider("fixture-key", "mail@example.test", async () => new Response("{}", { status: 400 }));
  expect(await invalid.send(mail, "job-one")).toEqual({ kind: "permanent" });
});
