import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * Operator backup encryption (#60). Chunked AES-256-GCM: each 1 MiB frame is authenticated with its index and a
 * "last frame" flag, so reordering, truncation and a wrong key are all refused. The key comes only from the
 * environment (BACKUP_ENCRYPTION_KEY, 32 bytes in hex); it is never written to the repository, manifest or logs.
 */
const MAGIC = Buffer.from("AUBK1\n");
const SALT_BYTES = 16;
const TAG_BYTES = 16;
const FRAME_BYTES = 1024 * 1024;
const HEADER_BYTES = MAGIC.length + SALT_BYTES;

export class BackupCryptoError extends Error {
  constructor(readonly code: "BACKUP_KEY_INVALID" | "BACKUP_AUTH_FAILED" | "BACKUP_FORMAT_INVALID", message: string) {
    super(message);
  }
}

export function parseBackupKey(value: string | undefined): Buffer {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new BackupCryptoError("BACKUP_KEY_INVALID", "BACKUP_ENCRYPTION_KEY must be 32 bytes in hex");
  }
  return Buffer.from(value, "hex");
}

function fileKey(key: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", key, salt, "auterva-backup-file", 32));
}

function frameParams(salt: Buffer, index: number, last: boolean) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(index), 4);
  const aad = Buffer.concat([MAGIC, salt, Buffer.from([last ? 1 : 0])]);
  return { nonce, aad };
}

/** Streams plaintext in, writes `header | (u32 length | ciphertext | tag)*`; the final frame is flagged. */
export function createEncryptor(key: Buffer): Transform {
  const salt = randomBytes(SALT_BYTES);
  const derived = fileKey(key, salt);
  let buffered = Buffer.alloc(0);
  let index = 0;
  let started = false;
  const seal = (plain: Buffer, last: boolean) => {
    const { nonce, aad } = frameParams(salt, index++, last);
    const cipher = createCipheriv("aes-256-gcm", derived, nonce);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, body, cipher.getAuthTag()]);
  };
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (!started) { this.push(Buffer.concat([MAGIC, salt])); started = true; }
      buffered = Buffer.concat([buffered, chunk]);
      // Keep at least one byte back so the last frame is always flagged on flush.
      while (buffered.length > FRAME_BYTES) {
        this.push(seal(buffered.subarray(0, FRAME_BYTES), false));
        buffered = buffered.subarray(FRAME_BYTES);
      }
      callback();
    },
    flush(callback: TransformCallback) {
      if (!started) this.push(Buffer.concat([MAGIC, salt]));
      this.push(seal(buffered, true));
      callback();
    },
  });
}

export function createDecryptor(key: Buffer): Transform {
  let buffered = Buffer.alloc(0);
  let salt: Buffer | null = null;
  let derived: Buffer | null = null;
  let index = 0;
  let sawLast = false;
  const fail = (code: BackupCryptoError["code"], message: string) => new BackupCryptoError(code, message);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        if (!salt) {
          if (buffered.length < HEADER_BYTES) return callback();
          if (!buffered.subarray(0, MAGIC.length).equals(MAGIC)) throw fail("BACKUP_FORMAT_INVALID", "Not an Auterva backup file");
          salt = Buffer.from(buffered.subarray(MAGIC.length, HEADER_BYTES));
          derived = fileKey(key, salt);
          buffered = buffered.subarray(HEADER_BYTES);
        }
        for (;;) {
          if (sawLast) {
            if (buffered.length > 0) throw fail("BACKUP_FORMAT_INVALID", "Data after the final frame");
            break;
          }
          if (buffered.length < 4) break;
          const length = buffered.readUInt32BE(0);
          if (length > FRAME_BYTES) throw fail("BACKUP_FORMAT_INVALID", "Frame too large");
          if (buffered.length < 4 + length + TAG_BYTES) break;
          const body = buffered.subarray(4, 4 + length);
          const tag = buffered.subarray(4 + length, 4 + length + TAG_BYTES);
          // The final frame is the only one that may be shorter than FRAME_BYTES; try "not last" first.
          let plain: Buffer | null = null;
          for (const last of [false, true]) {
            const { nonce, aad } = frameParams(salt, index, last);
            try {
              const decipher = createDecipheriv("aes-256-gcm", derived!, nonce);
              decipher.setAAD(aad);
              decipher.setAuthTag(tag);
              plain = Buffer.concat([decipher.update(body), decipher.final()]);
              sawLast = last;
              break;
            } catch { /* try the other flag */ }
          }
          if (!plain) throw fail("BACKUP_AUTH_FAILED", "Backup authentication failed (wrong key or damaged file)");
          index += 1;
          buffered = buffered.subarray(4 + length + TAG_BYTES);
          this.push(plain);
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      if (!sawLast || buffered.length > 0) {
        callback(new BackupCryptoError("BACKUP_AUTH_FAILED", "Backup is truncated or wrong key"));
      } else callback();
    },
  });
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function manifestMac(key: Buffer, canonicalJson: string): string {
  const macKey = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "auterva-backup-manifest", 32));
  return createHmac("sha256", macKey).update(canonicalJson).digest("hex");
}

/** Stable JSON with sorted object keys, so a MAC survives re-serialisation. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
