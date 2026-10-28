import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Status file written by the operator-side backup script (#60) and read by the monitor (#58). It holds timestamps,
// a success flag and a machine error code only: no keys, paths of backup sets, or manifest content.
export type BackupStatus = { newestCompleteAt: string | null; lastRunAt?: string; lastRunOk?: boolean; lastErrorCode?: string | null };

export async function updateBackupStatus(file: string | undefined, patch: Partial<BackupStatus>): Promise<void> {
  if (!file) return;
  let current: BackupStatus = { newestCompleteAt: null };
  try { current = JSON.parse(await readFile(file, "utf8")) as BackupStatus; } catch { /* first run */ }
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ ...current, ...patch }), { mode: 0o600 });
  await rename(temp, file);
}
