import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { MediaStorage } from "@/modules/media/storage";
import { MAX_EXPORT_BYTES } from "./snapshot";

const MAGIC = "AUR1";
const timeout = () => ({ abortSignal: AbortSignal.timeout(30_000) });

/**
 * AES-256-GCM key of the export files. `COMPANY_EXPORT_KEY` (64 hex) wins; otherwise a key is derived with HKDF from
 * the server secret under a fixed purpose label, so the file key is never the session secret itself.
 */
export function companyExportKey(env: Record<string, string | undefined> = process.env): Buffer {
  const explicit = env.COMPANY_EXPORT_KEY;
  if (explicit) {
    if (!/^[a-f0-9]{64}$/i.test(explicit)) throw new Error("COMPANY_EXPORT_KEY must be 32 bytes in hex");
    return Buffer.from(explicit, "hex");
  }
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("COMPANY_EXPORT_KEY_MISSING");
  return Buffer.from(hkdfSync("sha256", secret, "auterva-company-export", "company-export-file-v1", 32));
}

/** Private, company-prefixed key; it is checked against the row's company on every read. */
export function exportArtifactKey(organizationId: string, exportId: string): string {
  return `company-exports/${organizationId}/${exportId}.bin`;
}

export function encryptArtifact(plain: Buffer, key: Buffer, aad: string): { bytes: Buffer; digest: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const bytes = Buffer.concat([Buffer.from(MAGIC), nonce, cipher.getAuthTag(), ciphertext]);
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

/** The artifact key is bound as AAD, so bytes copied under another company's key never decrypt. */
export function decryptArtifact(bytes: Buffer, key: Buffer, aad: string, digest: string | null): Buffer {
  if (!digest || createHash("sha256").update(bytes).digest("hex") !== digest || bytes.subarray(0, 4).toString() !== MAGIC)
    throw new Error("EXPORT_INTEGRITY_FAILED");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(4, 16));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
}

export async function putArtifact(storage: MediaStorage, key: string, bytes: Buffer): Promise<void> {
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: bytes, ContentLength: bytes.length,
    ContentType: "application/octet-stream", CacheControl: "private, no-store" }), timeout());
}

export async function getArtifact(storage: MediaStorage, key: string): Promise<Buffer> {
  const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }), timeout());
  const stream = result.Body as Readable | undefined;
  const limit = MAX_EXPORT_BYTES + 1024;
  if (!stream || !result.ContentLength || result.ContentLength > limit) { stream?.destroy(); throw new Error("EXPORT_STORAGE_INVALID"); }
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.byteLength;
    if (length > limit) { stream.destroy(); throw new Error("EXPORT_STORAGE_INVALID"); }
    parts.push(Buffer.from(chunk));
  }
  if (length !== result.ContentLength) throw new Error("EXPORT_STORAGE_INVALID");
  return Buffer.concat(parts, length);
}

/** Idempotent: a missing object is not an error. */
export async function deleteArtifact(storage: MediaStorage, key: string): Promise<void> {
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }), timeout());
}
