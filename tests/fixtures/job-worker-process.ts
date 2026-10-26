import { createPrismaClient } from "../../src/lib/prisma";
import { createResendProvider } from "../../src/modules/jobs/provider";
import { runWorkerLoop } from "../../src/modules/jobs/runner";

const providerUrl = new URL(process.env.TEST_PROVIDER_URL ?? "");
if (providerUrl.protocol !== "http:" || providerUrl.hostname !== "127.0.0.1") throw new Error("Test provider must use loopback");
const key = Buffer.from(process.env.MAIL_PAYLOAD_KEY ?? "", "hex");
if (key.length !== 32) throw new Error("Invalid fixture mail key");
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
const hold = process.env.TEST_HOLD;
const pause = async () => { await new Promise<void>(() => {}); };

try {
  process.send?.({ event: "ready" });
  await runWorkerLoop({ db, signal: controller.signal, leaseMs: 1_000, pollMs: 100,
    context: { key, mode: "development", allowedRecipients: new Set([process.env.TEST_ALLOWED_RECIPIENT ?? ""]),
      provider: createResendProvider("fixture-only", "mail@example.test", (_url, init) => fetch(providerUrl, init)),
      afterProviderResponse: hold === "after_response" ? async () => {
        process.send?.({ event: "provider_response" });
        await pause();
      } : undefined },
    afterClaim: async (claim) => {
      process.send?.({ event: "claimed", id: claim.id });
      if (hold === "after_claim") await pause();
    } });
} finally {
  await db.$disconnect();
}
