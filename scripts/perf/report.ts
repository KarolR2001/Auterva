import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireOwnFixture } from "./target";

/**
 * One command for the whole comparison: pnpm perf:report [-- --seconds 20 --no-reset]
 * 1. resets the local fixture database (only this worktree's guarded cluster; skip with --no-reset), 2. generates P1,
 * 3. runs the "before" variant (index dropped, legacy query) and the "after" variant, 4. adds the second company (P2,
 * proposed in #90) and runs it, 5. writes EXPLAIN plans and docs/performance/results/*.json + SUMMARY.md.
 * Needs the fixture running (scripts/local-fixture.sh start) and MAIL_PAYLOAD_KEY exported (any 64 hex characters).
 */
await requireOwnFixture();
const args = process.argv.slice(2);
const seconds = args.includes("--seconds") ? args[args.indexOf("--seconds") + 1] : "20";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sh = (...command: string[]) => execFileSync("pnpm", ["exec", ...command], { cwd: root, stdio: "inherit" });
if (!args.includes("--no-reset")) sh("tsx", "scripts/seed-local-fixture.ts", "--reset");
sh("tsx", "scripts/perf/generate.ts", "--profile", "p1");
sh("tsx", "scripts/perf/run.ts", "--profile", "p1", "--variant", "before", "--label", "p1-before", "--seconds", seconds);
sh("tsx", "scripts/perf/run.ts", "--profile", "p1", "--variant", "after", "--label", "p1-after", "--seconds", seconds);
sh("tsx", "scripts/perf/explain.ts");
sh("tsx", "scripts/perf/generate.ts", "--profile", "p2");
sh("tsx", "scripts/perf/run.ts", "--profile", "p2", "--variant", "after", "--label", "p2-after", "--seconds", seconds);

type Result = { name: string; note?: string; stats: { n: number; errors: number; p50: number; p95: number; p99: number; rps: number };
  saturation?: Record<string, number>; extra?: Record<string, unknown> };
type Run = { label: string; profile: string; variant: string; seconds: number; stamp: string; node: string; results: Result[] };
const results = resolve(root, "docs", "performance", "results");
mkdirSync(results, { recursive: true });
const load = (label: string): Run => {
  const from = resolve(root, ".local", "perf", `${label}.json`);
  copyFileSync(from, resolve(results, `${label}.json`));
  return JSON.parse(readFileSync(from, "utf8")) as Run;
};
const [before, after, p2] = [load("p1-before"), load("p1-after"), load("p2-after")];
const by = (run: Run) => new Map(run.results.map((result) => [result.name, result]));
let md = `# Wyniki pomiaru (generowane przez pnpm perf:report)\n\nP1: ${before.stamp} / ${after.stamp}; P2: ${p2.stamp}; Node ${after.node}; ${after.seconds} s na scenariusz.\n\n`;
md += "## P1 przed i po (zapytania na serwisie, 16 równoległych wywołań, bez limiterów API)\n\n| Scenariusz | p95 przed (ms) | p95 po (ms) | zapytań/s przed | zapytań/s po |\n|---|---:|---:|---:|---:|\n";
const beforeMap = by(before);
for (const result of after.results.filter((entry) => entry.name.startsWith("sat:"))) {
  const old = beforeMap.get(result.name);
  md += `| ${result.name} | ${old?.stats.p95 ?? "-"} | ${result.stats.p95} | ${old?.stats.rps ?? "-"} | ${result.stats.rps} |\n`;
}
for (const [title, run] of [["P1 po zmianach: ruch przez handlery z realnymi limitami", after], ["P2 (proponowany w #90, niezatwierdzony)", p2]] as const) {
  md += `\n## ${title}\n\n| Scenariusz | n | błędy | p50 | p95 | p99 | CPU proc. % | RSS MB | poł. DB max | CPU DB % max |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const result of run.results.filter((entry) => !entry.name.startsWith("sat:"))) {
    const s = result.saturation;
    md += `| ${result.name} | ${result.stats.n} | ${result.stats.errors} | ${result.stats.p50} | ${result.stats.p95} | ${result.stats.p99} | ${s?.cpuPercentProcess ?? ""} | ${s?.rssMbPeak ?? ""} | ${s?.dbConnectionsMax ?? ""} | ${s?.dbBackendsCpuPercentMax ?? ""} |\n`;
  }
}
writeFileSync(resolve(results, "SUMMARY.md"), md);
process.stdout.write(`Wrote ${resolve(results, "SUMMARY.md")}\n`);
