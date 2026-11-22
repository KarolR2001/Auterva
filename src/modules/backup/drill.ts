import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { MediaStorage } from "../media/storage";
import { backupAge, createBackup, MAX_BACKUP_AGE_HOURS } from "./backup";
import { restoreCompany } from "./company";
import {
  assertFilesMatchManifest, connect, organizationCounts, type Manifest, type Queryable, quote, readManifest, rowCounts,
  tablesWithOrganization,
} from "./core";
import { restoreFull } from "./restore";

/** D-10 objectives the drill compares against. They are targets: a local result proves the method, not production. */
export const RPO_OBJECTIVE_MS = 24 * 3_600_000;
export const RTO_OBJECTIVE_MS = 4 * 3_600_000;
/** Tables a full restore changes on purpose: sessions and proofs are deleted, one audit entry is appended. */
export const FULL_RESTORE_COUNT_DELTAS: Record<string, "zero" | 1> = { session: "zero", verification: "zero", AuditLog: 1 };

export type DrillCheck = { name: string; ok: boolean; detail?: string };
export type DrillReport = {
  ok: boolean; checks: DrillCheck[]; backupId: string; organizationId: string;
  timings: { backupMs: number; verifyMs: number; fullRestoreMs: number; companyRestoreMs: number; rtoMs: number };
  rpo: { snapshotAt: string; windowMs: number; objectiveMs: number; rowsWrittenAfterSnapshot: number };
  rto: { measuredMs: number; objectiveMs: number };
  counts: { tables: number; rows: number; companies: number; mediaObjects: number; mediaBytes: number };
};

async function listObjects(storage: MediaStorage): Promise<Map<string, { bytes: number; sha256: string }>> {
  const found = new Map<string, { bytes: number; sha256: string }>();
  let token: string | undefined;
  do {
    const page = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket, ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      const body = (await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: object.Key! }))).Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      found.set(object.Key!, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return found;
}

/** One hash per table over every row that does not belong to `exceptOrganization`: a leak or a lost write shows up. */
export async function outsideCompanyFingerprint(db: Queryable, exceptOrganization: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of await tablesWithOrganization(db)) {
    result[table] = String((await db.query(`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h
      FROM ${quote(table)} t WHERE "organizationId" IS DISTINCT FROM $1`, [exceptOrganization])).rows[0].h);
  }
  result.Organization = String((await db.query(`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h
    FROM "Organization" t WHERE id <> $1`, [exceptOrganization])).rows[0].h);
  return result;
}

/** Row counts the restored database must have: the backup's counts plus the intended full-restore deltas. */
export function expectedRestoredCounts(manifest: Manifest): Record<string, number> {
  return Object.fromEntries(Object.entries(manifest.tables).map(([table, count]) => {
    const delta = FULL_RESTORE_COUNT_DELTAS[table];
    return [table, delta === "zero" ? 0 : delta === 1 ? count + 1 : count];
  }));
}

/**
 * Local drill of the whole #60 cycle on throwaway targets: backup, verify, full restore into a new database and
 * bucket, an independent comparison (rows, objects), then a one-company restore inside the restored database after
 * both companies changed, proving the other company is untouched. The source database is only read.
 */
export async function runBackupDrill(input: {
  databaseUrl: string; storage: MediaStorage; key: Buffer; repoDir: string; operatorId: string; outDir: string; commit: string;
  restoreDatabaseUrl: string; restoreStorage: MediaStorage; organizationId?: string; env?: NodeJS.ProcessEnv;
}): Promise<DrillReport> {
  const checks: DrillCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, ...(detail ? { detail } : {}) }); return ok; };
  const timed = async <T>(run: () => Promise<T>): Promise<[T, number]> => { const at = Date.now(); const value = await run(); return [value, Date.now() - at]; };

  const [{ dir, manifest }, backupMs] = await timed(() => createBackup({ databaseUrl: input.databaseUrl, outDir: input.outDir,
    key: input.key, storage: input.storage, commit: input.commit, ...(input.env ? { env: input.env } : {}) }));
  check("backup complete", manifest.complete, `${Object.keys(manifest.tables).length} tables, ${manifest.media.objects.length} media objects`);
  check("manifest records configuration without values", Boolean(manifest.config) && !JSON.stringify(manifest.config).includes("://"),
    `${manifest.config?.present.length ?? 0} names, ${Object.keys(manifest.config?.fingerprints ?? {}).length} fingerprints`);

  const [, verifyMs] = await timed(async () => assertFilesMatchManifest(dir, await readManifest(dir, input.key)));
  check("verify: MAC and checksums", true);
  const age = await backupAge(input.outDir, input.key);
  check(`backup age below ${MAX_BACKUP_AGE_HOURS} h alarm`, Boolean(age) && !age!.stale, `${age?.ageHours.toFixed(4)} h`);

  const organizationId = (input.organizationId ?? Object.keys(manifest.organizations)[0] ?? "").toLowerCase();
  if (!check("company chosen for the one-company restore exists in the backup", Boolean(manifest.organizations[organizationId]), organizationId)) {
    throw new Error("DRILL_COMPANY_NOT_IN_BACKUP");
  }
  const restoreStartedAt = Date.now();
  const full = await restoreFull({ backupDir: dir, key: input.key, targetUrl: input.restoreDatabaseUrl, repoDir: input.repoDir,
    operatorId: input.operatorId, mediaTarget: input.restoreStorage, createBucket: true, ...(input.env ? { env: input.env } : {}) });
  check("full restore passed its own integrity checks", full.ok, full.integrity?.checks.filter((c) => !c.ok).map((c) => c.name).join(", ") || `${full.integrity?.checks.length} checks`);

  const restored = await connect(input.restoreDatabaseUrl);
  const live = await connect(input.databaseUrl);
  try {
    const counts = await rowCounts(restored);
    const expected = expectedRestoredCounts(manifest);
    const wrong = Object.keys(expected).filter((table) => counts[table] !== expected[table]);
    check("independent row counts per table equal the backup (plus intended full-restore changes)", wrong.length === 0,
      wrong.map((table) => `${table}: ${counts[table]} != ${expected[table]}`).join("; ") || `${Object.keys(expected).length} tables`);
    check("no extra tables after restore", Object.keys(counts).every((table) => table in expected));
    const orgs = await organizationCounts(restored);
    const wrongOrgs = Object.entries(manifest.organizations).filter(([id, org]) =>
      Object.entries(org.counts).some(([table, n]) => (FULL_RESTORE_COUNT_DELTAS[table] ? false : orgs[id]?.counts[table] !== n)));
    check("independent row counts per company equal the backup", wrongOrgs.length === 0, wrongOrgs.map(([id]) => id).join(", ") || `${Object.keys(orgs).length} companies`);

    const objects = await listObjects(input.restoreStorage);
    const wantedKeys = manifest.media.objects.map((entry) => entry.key).sort();
    const badObjects = manifest.media.objects.filter((entry) => objects.get(entry.key)?.sha256 !== entry.sha256 || objects.get(entry.key)?.bytes !== entry.bytes);
    check("restored bucket holds exactly the backed up objects, byte-identical", badObjects.length === 0 && [...objects.keys()].sort().join() === wantedKeys.join(),
      `${objects.size} objects, ${badObjects.length} differ`);

    // Both companies change after the backup; restoring A must bring A back and must not touch B or any other company.
    await restored.query(`UPDATE "Vehicle" SET name = name || ' (changed after backup)'`);
    await restored.query(`DELETE FROM "AvailabilityBlock" WHERE "organizationId" = $1`, [organizationId]);
    const outsideBefore = await outsideCompanyFingerprint(restored, organizationId);
    const aVehiclesBefore = Number((await restored.query(`SELECT count(*) AS n FROM "Vehicle" WHERE "organizationId" = $1 AND name LIKE '%(changed after backup)'`, [organizationId])).rows[0].n);
    const [company, companyRestoreMs] = await timed(() => restoreCompany({ backupDir: dir, key: input.key, organizationId,
      targetUrl: input.restoreDatabaseUrl, repoDir: input.repoDir, operatorId: input.operatorId, storage: input.restoreStorage }));
    check("one-company restore passed its integrity checks", company.ok && company.otherCompaniesUnchanged);
    const outsideAfter = await outsideCompanyFingerprint(restored, organizationId);
    const leaked = Object.keys(outsideBefore).filter((table) => outsideBefore[table] !== outsideAfter[table]);
    check("no row outside the restored company changed (all tables with organizationId, plus Organization)", leaked.length === 0, leaked.join(", ") || `${Object.keys(outsideBefore).length} tables`);
    const changedLeft = Number((await restored.query(`SELECT count(*) AS n FROM "Vehicle" WHERE "organizationId" = $1 AND name LIKE '%(changed after backup)'`, [organizationId])).rows[0].n);
    check("restored company is back to the backup state", aVehiclesBefore > 0 ? changedLeft === 0 : true, `${aVehiclesBefore} changed vehicles before, ${changedLeft} after`);
    const afterOrgs = await organizationCounts(restored);
    const wrongAfter = Object.entries(manifest.organizations[organizationId]!.counts).filter(([table, n]) => !FULL_RESTORE_COUNT_DELTAS[table] && afterOrgs[organizationId]?.counts[table] !== n && !["Job", "AuditLog", "OperationReceipt", "ImageUpload"].includes(table));
    check("restored company counts equal the backup (excluding audit, jobs, receipts, uploads that restore keeps by design)", wrongAfter.length === 0, wrongAfter.map(([table]) => table).join(", "));

    const liveCounts = await rowCounts(live);
    const written = Object.keys(manifest.tables).reduce((sum, table) => sum + Math.max(0, (liveCounts[table] ?? 0) - manifest.tables[table]!), 0);
    const rtoMs = verifyMs + full.totalMs;
    const rpoWindowMs = restoreStartedAt - Date.parse(manifest.createdAt);
    check("RPO window within the D-10 objective", rpoWindowMs <= RPO_OBJECTIVE_MS, `${rpoWindowMs} ms of ${RPO_OBJECTIVE_MS}`);
    check("RTO (verify + full restore) within the D-10 objective", rtoMs <= RTO_OBJECTIVE_MS, `${rtoMs} ms of ${RTO_OBJECTIVE_MS}`);
    return {
      ok: checks.every((c) => c.ok), checks, backupId: manifest.id, organizationId,
      timings: { backupMs, verifyMs, fullRestoreMs: full.totalMs, companyRestoreMs, rtoMs },
      rpo: { snapshotAt: manifest.createdAt, windowMs: rpoWindowMs, objectiveMs: RPO_OBJECTIVE_MS, rowsWrittenAfterSnapshot: written },
      rto: { measuredMs: rtoMs, objectiveMs: RTO_OBJECTIVE_MS },
      counts: { tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((a, b) => a + b, 0),
        companies: Object.keys(manifest.organizations).length, mediaObjects: manifest.media.objects.length,
        mediaBytes: manifest.media.objects.reduce((a, o) => a + o.bytes, 0) },
    };
  } finally {
    await restored.end();
    await live.end();
  }
}
