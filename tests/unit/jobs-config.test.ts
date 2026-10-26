import { expect, test } from "vitest";
import { getWorkerMailContext } from "../../src/modules/jobs/config";

const key = "1".repeat(64);
test("non-production worker fails closed without explicit controlled recipients", () => {
  expect(() => getWorkerMailContext({ MAIL_PAYLOAD_KEY: key, MAIL_ENVIRONMENT: "development", MAIL_PROVIDER: "sink" })).toThrow();
  expect(() => getWorkerMailContext({ MAIL_PAYLOAD_KEY: key, MAIL_ENVIRONMENT: "development", MAIL_PROVIDER: "sink",
    MAIL_ALLOWED_RECIPIENTS: "qa@example.test" })).not.toThrow();
});

test("production cannot use local sink or missing provider credentials", () => {
  expect(() => getWorkerMailContext({ MAIL_PAYLOAD_KEY: key, MAIL_ENVIRONMENT: "production", MAIL_PROVIDER: "sink" })).toThrow();
  expect(() => getWorkerMailContext({ MAIL_PAYLOAD_KEY: key, MAIL_ENVIRONMENT: "production", MAIL_PROVIDER: "resend" })).toThrow();
});
