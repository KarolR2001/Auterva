import { expect, test } from "vitest";
import { createMediaStorage } from "../../src/modules/media/storage";

const config = { S3_BUCKET: "private-media", S3_ACCESS_KEY_ID: "fixture-access",
  S3_SECRET_ACCESS_KEY: "fixture-secret" };

test("media storage accepts HTTPS and local fixture HTTP only", () => {
  const secure = createMediaStorage({ ...config, S3_ENDPOINT: "https://example.r2.cloudflarestorage.com" });
  secure.client.destroy();
  const local = createMediaStorage({ ...config, S3_ENDPOINT: "http://127.0.0.1:15451",
    AUTERVA_FIXTURE: "1" });
  local.client.destroy();
  expect(() => createMediaStorage({ ...config, S3_ENDPOINT: "http://example.test" })).toThrow();
  expect(() => createMediaStorage({ ...config, S3_ENDPOINT: "http://127.0.0.1:15451" })).toThrow();
  expect(() => createMediaStorage({ ...config, S3_ENDPOINT: "https://user:pass@example.test" })).toThrow();
});
