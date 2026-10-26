import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

/** Resident set size of a process in KiB, or null when it cannot be measured (the caller fails closed). */
export async function defaultRssKb(pid: number): Promise<number | null> {
  try { // Linux: no external tool needed
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s*kB/m.exec(status);
    if (match) return Number(match[1]);
  } catch { /* no procfs (macOS) or the process is gone: try ps */ }
  return new Promise((resolve) => execFile("ps", ["-o", "rss=", "-p", String(pid)], { timeout: 1_000 },
    (error, stdout) => {
      const value = Number(stdout.trim());
      resolve(error || !Number.isFinite(value) || value <= 0 ? null : value);
    }));
}

/** Replaceable only by tests: production always measures through defaultRssKb. */
export const rssProbe: { read: (pid: number) => Promise<number | null> } = { read: defaultRssKb };
