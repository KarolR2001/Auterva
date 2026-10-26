import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { auditRetentionCutoff } from "./retention";
import { safeAuditView } from "./read";

const dayMs = 24 * 60 * 60_000;
const artifactName = (id: string) => `${id}.bin`;

function validateLocalStore(directory: string): string {
  if (process.env.NODE_ENV === "production") throw new Error("AUDIT_EXPORT_PROVIDER_NOT_CONFIGURED");
  const localRoot = resolve(".local");
  const target = resolve(directory);
  if (!target.startsWith(`${localRoot}${sep}`)) throw new Error("AUDIT_EXPORT_LOCAL_DIRECTORY_REQUIRED");
  return target;
}

async function ensurePrivateStore(directory: string): Promise<string> {
  const path = validateLocalStore(directory);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const state = await lstat(path);
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0) {
    throw new Error("AUDIT_EXPORT_DIRECTORY_NOT_PRIVATE");
  }
  return path;
}

async function removeIfPresent(path: string): Promise<void> {
  try { await unlink(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function validateKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("AUDIT_EXPORT_KEY_REQUIRED");
}

export type ExportAuditInput = {
  from: Date; to: Date; now: Date; key: Buffer; directory: string;
  beforeWrite?: (id: string) => Promise<void>;
  afterWrite?: (id: string) => Promise<void>;
  clock?: () => Date;
};

/** Local fixture adapter only. Production storage and restore are gated by #58/#60. */
export async function exportAuditRange(db: PrismaClient, input: ExportAuditInput) {
  validateKey(input.key);
  const directory = await ensurePrivateStore(input.directory);
  const { from, to, now } = input;
  if (![from, to, now].every((value) => Number.isFinite(value.getTime())) || from >= to || to > now
    || from < auditRetentionCutoff(now) || to.getTime() - from.getTime() > 7 * dayMs) {
    throw new Error("AUDIT_EXPORT_OUTSIDE_RETENTION");
  }
  const rows = await db.auditLog.findMany({ where: { createdAt: { gte: from, lt: to } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1001,
    select: { id: true, eventKey: true, organizationId: true, actorId: true, actorRole: true,
      action: true, entityType: true, entityId: true, safeChanges: true, requestId: true, createdAt: true } });
  if (rows.length > 1000) throw new Error("AUDIT_EXPORT_TOO_LARGE");
  const earliestExpiry = rows.length ? rows[0].createdAt.getTime() + 365 * dayMs : now.getTime() + dayMs;
  const expiresAt = new Date(Math.min(now.getTime() + dayMs, earliestExpiry));
  if (expiresAt <= now) throw new Error("AUDIT_EXPORT_EXPIRED");
  const id = randomUUID();
  const name = artifactName(id);
  const pending = await db.auditOperatorExport.create({ data: { id, artifactName: name,
    fromAt: from, toAt: to, count: rows.length, expiresAt, createdAt: now, status: "PENDING" } });
  const finalPath = resolve(directory, name);
  const partialPath = `${finalPath}.part`;
  try {
    const records = rows.map(({ eventKey, ...row }) => ({ ...row,
      safeChanges: eventKey ? safeAuditView(row.safeChanges) : null }));
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", input.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(records), "utf8"), cipher.final()]);
    const bytes = Buffer.concat([Buffer.from("AUR1"), nonce, cipher.getAuthTag(), ciphertext]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await input.beforeWrite?.(id);
    await writeFile(partialPath, bytes, { flag: "wx", mode: 0o600 });
    await chmod(partialPath, 0o600);
    await rename(partialPath, finalPath);
    await input.afterWrite?.(id);
    const finishedAt = input.clock?.() ?? new Date();
    if (!Number.isFinite(finishedAt.getTime()) || finishedAt >= expiresAt) throw new Error("AUDIT_EXPORT_EXPIRED");
    const updated = await db.auditOperatorExport.updateMany({ where: { id, status: "PENDING" },
      data: { status: "READY", digest, completedAt: finishedAt } });
    if (updated.count !== 1) throw new Error("AUDIT_EXPORT_STATE_CHANGED");
    return { ...pending, status: "READY", digest, completedAt: finishedAt };
  } catch (error) {
    await removeIfPresent(partialPath);
    await removeIfPresent(finalPath);
    await db.auditOperatorExport.updateMany({ where: { id, status: "PENDING" },
      data: { status: "FAILED", errorCode: "AUDIT_EXPORT_INCOMPLETE" } });
    throw error;
  }
}

export async function readAuditExport(db: PrismaClient, id: string, input: {
  now: Date; key: Buffer; directory: string;
}): Promise<unknown[]> {
  validateKey(input.key);
  if (!Number.isFinite(input.now.getTime())) throw new Error("Invalid audit export clock");
  const directory = await ensurePrivateStore(input.directory);
  const receipt = await db.auditOperatorExport.findUnique({ where: { id } });
  if (!receipt || receipt.status !== "READY" || receipt.expiresAt <= input.now) throw new Error("AUDIT_EXPORT_EXPIRED");
  if (receipt.artifactName !== artifactName(id)) throw new Error("AUDIT_EXPORT_INVALID_ARTIFACT");
  const bytes = await readFile(resolve(directory, receipt.artifactName));
  if (createHash("sha256").update(bytes).digest("hex") !== receipt.digest || bytes.subarray(0, 4).toString() !== "AUR1") {
    throw new Error("AUDIT_EXPORT_INTEGRITY_FAILED");
  }
  const decipher = createDecipheriv("aes-256-gcm", input.key, bytes.subarray(4, 16));
  decipher.setAuthTag(bytes.subarray(16, 32));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as unknown[];
}

/** A deleted receipt can never become READY. Repeated scans collect files from a late or killed writer. */
export async function sweepExpiredAuditExports(db: PrismaClient, input: {
  now: Date; directory: string; afterCandidatesRead?: () => Promise<void>;
}): Promise<number> {
  if (!Number.isFinite(input.now.getTime())) throw new Error("Invalid audit export clock");
  const directory = await ensurePrivateStore(input.directory);
  const abandonedBefore = new Date(input.now.getTime() - 5 * 60_000);
  const rows = await db.auditOperatorExport.findMany({ where: { status: { in: ["PENDING", "FAILED", "READY"] },
    OR: [{ expiresAt: { lte: input.now } }, { status: { in: ["PENDING", "FAILED"] }, createdAt: { lte: abandonedBefore } }] },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 100 });
  await input.afterCandidatesRead?.();
  let deleted = 0;
  for (const row of rows) {
    if (row.artifactName !== artifactName(row.id)) throw new Error("AUDIT_EXPORT_INVALID_ARTIFACT");
    const updated = await db.auditOperatorExport.updateMany({ where: { id: row.id, status: row.status },
      data: { status: "DELETED", deletedAt: input.now } });
    if (updated.count !== 1) continue;
    const finalPath = resolve(directory, row.artifactName);
    await removeIfPresent(`${finalPath}.part`);
    await removeIfPresent(finalPath);
    deleted++;
  }
  // DB and filesystem have no shared commit. A process may die after the state change,
  // or an old writer may create bytes after it. Scan every run, including DELETED rows.
  const names = (await readdir(directory)).filter((name) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin(?:\.part)?$/.test(name));
  const namesById = new Map<string, string[]>();
  for (const name of names) {
    const id = name.slice(0, 36);
    namesById.set(id, [...(namesById.get(id) ?? []), name]);
  }
  const ids = [...namesById.keys()];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    const receipts = await db.auditOperatorExport.findMany({ where: { id: { in: chunk }, status: "DELETED" },
      select: { id: true } });
    for (const receipt of receipts) {
      for (const name of namesById.get(receipt.id) ?? []) await removeIfPresent(resolve(directory, name));
    }
  }
  return deleted;
}
