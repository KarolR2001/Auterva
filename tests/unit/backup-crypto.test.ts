import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { expect, test } from "vitest";
import { BackupCryptoError, canonicalJson, createDecryptor, createEncryptor, manifestMac, parseBackupKey } from "../../src/modules/backup/crypto";

const key = randomBytes(32);

async function run(transform: ReturnType<typeof createEncryptor>, input: Buffer): Promise<Buffer> {
  const parts: Buffer[] = [];
  await pipeline(Readable.from([input]), transform, new Writable({ write(chunk: Buffer, _e, cb) { parts.push(chunk); cb(); } }));
  return Buffer.concat(parts);
}

test("round-trips empty, small and multi-frame data", async () => {
  for (const size of [0, 1, 1024 * 1024, 1024 * 1024 + 1, 3 * 1024 * 1024 + 17]) {
    const plain = randomBytes(size);
    const sealed = await run(createEncryptor(key), plain);
    expect(size === 0 || !sealed.includes(plain.subarray(0, Math.min(size, 32)))).toBe(true);
    expect((await run(createDecryptor(key), sealed)).equals(plain)).toBe(true);
  }
});

test("a wrong key, a flipped bit, truncation and trailing data are refused", async () => {
  const sealed = await run(createEncryptor(key), randomBytes(2.5 * 1024 * 1024));
  await expect(run(createDecryptor(randomBytes(32)), sealed)).rejects.toMatchObject({ code: "BACKUP_AUTH_FAILED" });
  const flipped = Buffer.from(sealed);
  flipped[flipped.length - 40] ^= 1;
  await expect(run(createDecryptor(key), flipped)).rejects.toBeInstanceOf(BackupCryptoError);
  // Dropping the final frame must not look like a shorter valid file.
  const firstFrame = 22 + 4 + 1024 * 1024 + 16;
  await expect(run(createDecryptor(key), sealed.subarray(0, firstFrame))).rejects.toMatchObject({ code: "BACKUP_AUTH_FAILED" });
  await expect(run(createDecryptor(key), Buffer.concat([sealed, Buffer.from([1])]))).rejects.toBeInstanceOf(BackupCryptoError);
  await expect(run(createDecryptor(key), Buffer.from("plain text, not a backup file"))).rejects.toBeInstanceOf(Error);
});

test("key parsing and manifest MAC depend on the exact key and content", () => {
  expect(() => parseBackupKey(undefined)).toThrow("BACKUP_ENCRYPTION_KEY");
  expect(() => parseBackupKey("abc")).toThrow("BACKUP_ENCRYPTION_KEY");
  expect(parseBackupKey(key.toString("hex"))).toEqual(key);
  const json = canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] });
  expect(json).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  expect(manifestMac(key, json)).toBe(manifestMac(key, json));
  expect(manifestMac(key, json)).not.toBe(manifestMac(randomBytes(32), json));
  expect(manifestMac(key, json)).not.toBe(manifestMac(key, canonicalJson({ b: 2, a: [] })));
});
