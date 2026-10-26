import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand,
  S3Client } from "@aws-sdk/client-s3";

export const maxImageBytes = 10_000_000;
const storageTimeoutMs = 10_000;
const requestOptions = () => ({ abortSignal: AbortSignal.timeout(storageTimeoutMs) });

function required(value: string | undefined, key: string): string {
  if (!value) throw new Error(`MEDIA_STORAGE_${key}_MISSING`);
  return value;
}

export function createMediaStorage(input = process.env) {
  const endpoint = required(input.S3_ENDPOINT, "ENDPOINT");
  const bucket = required(input.S3_BUCKET, "BUCKET");
  const client = new S3Client({ endpoint, region: input.S3_REGION ?? "auto", forcePathStyle: true,
    credentials: { accessKeyId: required(input.S3_ACCESS_KEY_ID, "ACCESS_KEY"),
      secretAccessKey: required(input.S3_SECRET_ACCESS_KEY, "SECRET_KEY") } });
  return { client, bucket };
}

export type MediaStorage = ReturnType<typeof createMediaStorage>;

export async function readLimited(storage: MediaStorage, key: string): Promise<Buffer> {
  const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }), requestOptions());
  const stream = result.Body as Readable | undefined;
  if (!result.Body || !result.ContentLength || result.ContentLength > maxImageBytes) {
    stream?.destroy();
    throw new Error("MEDIA_INVALID_SIZE");
  }
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream!) {
    length += chunk.byteLength;
    if (length > maxImageBytes) {
      stream!.destroy();
      throw new Error("MEDIA_INVALID_SIZE");
    }
    parts.push(Buffer.from(chunk));
  }
  if (length !== result.ContentLength) throw new Error("MEDIA_TRUNCATED_OBJECT");
  return Buffer.concat(parts, length);
}

export async function stageBytes(storage: MediaStorage, key: string, bytes: Buffer, mime: string): Promise<void> {
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error("MEDIA_INVALID_SIZE");
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key,
    Body: bytes, ContentLength: bytes.length, ContentType: mime, CacheControl: "private, no-store" }),
  requestOptions());
}

export async function putImmutable(storage: MediaStorage, key: string, bytes: Buffer,
  mime: string): Promise<string> {
  const digest = createHash("sha256").update(bytes).digest("hex");
  try {
    await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key,
      Body: bytes, ContentLength: bytes.length, ContentType: mime, CacheControl: "private, no-store",
      Metadata: { sha256: digest }, IfNoneMatch: "*" }), requestOptions());
  } catch (error) {
    const code = error instanceof Error ? error.name : "";
    if (code !== "PreconditionFailed" && code !== "ConditionalRequestConflict") throw error;
    const existing = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }),
      requestOptions());
    if (existing.ContentLength !== bytes.length || existing.Metadata?.sha256 !== digest)
      throw new Error("MEDIA_IMMUTABLE_CONFLICT");
  }
  return digest;
}

export async function removeObject(storage: MediaStorage, key: string): Promise<void> {
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }), requestOptions());
}
