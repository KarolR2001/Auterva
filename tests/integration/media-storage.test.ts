import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createMediaStorage, maxImageBytes, putImmutable, readLimited, removeObject, stageBytes } from
  "../../src/modules/media/storage";

function localStorage() {
  const secrets = readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8");
  const entry = Object.fromEntries(secrets.trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  return createMediaStorage({ ...process.env, ...entry });
}

const storage = localStorage();
const keys: string[] = [];
afterAll(async () => { for (const key of keys) await removeObject(storage, key); storage.client.destroy(); });

test("private S3 staging is bounded and immutable final bytes survive staging overwrite", async () => {
  const staging = `staging/fixture/${randomUUID()}`;
  const final = `private/fixture/${randomUUID()}`;
  keys.push(staging, final);
  const approved = Buffer.from("approved image bytes");
  await stageBytes(storage, staging, approved, "image/webp");
  const validated = await readLimited(storage, staging);
  expect(validated).toEqual(approved);
  await stageBytes(storage, staging, Buffer.from("attacker overwrite"), "image/webp");
  const digest = await putImmutable(storage, final, validated, "image/webp");
  expect(await readLimited(storage, final)).toEqual(approved);
  expect(await putImmutable(storage, final, validated, "image/webp")).toBe(digest);
  await expect(putImmutable(storage, final, Buffer.from("different bytes"), "image/webp"))
    .rejects.toThrow("MEDIA_IMMUTABLE_CONFLICT");
  await expect(stageBytes(storage, staging, Buffer.alloc(maxImageBytes + 1), "image/webp"))
    .rejects.toThrow("MEDIA_INVALID_SIZE");
});
