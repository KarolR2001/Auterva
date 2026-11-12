import { readFileSync } from "node:fs";

/**
 * Aggregates statements from a PostgreSQL log written with log_min_duration_statement = 0 (#402): count, total and
 * mean time per normalised statement, heaviest first. Usage: tsx scripts/perf/pg-log-top.ts <log> [top] [skipBytes]
 */
const [file, topArg, skipArg] = process.argv.slice(2);
const text = readFileSync(file, "utf8").slice(Number(skipArg ?? 0));
const stats = new Map<string, { n: number; total: number; max: number; example: string; params: string }>();
let current: { ms: number; sql: string[]; params: string } | null = null;
const flush = () => {
  if (!current) return;
  const sql = current.sql.join(" ").replace(/\s+/g, " ").trim();
  if (sql && !/^(BEGIN|COMMIT|ROLLBACK|SET |SHOW |DEALLOCATE)/i.test(sql)) {
    const key = sql.replace(/\$\d+/g, "$").slice(0, 400);
    const entry = stats.get(key) ?? { n: 0, total: 0, max: 0, example: sql, params: current.params };
    entry.n += 1; entry.total += current.ms; entry.max = Math.max(entry.max, current.ms);
    if (current.ms >= entry.max) entry.params = current.params;
    stats.set(key, entry);
  }
  current = null;
};
for (const line of text.split("\n")) {
  const head = /LOG:\s+duration: ([\d.]+) ms\s+(?:execute [^:]*|statement): (.*)$/.exec(line);
  if (head) { flush(); current = { ms: Number(head[1]), sql: [head[2]], params: "" }; continue; }
  if (!current) continue;
  const detail = /DETAIL:\s+parameters: (.*)$/.exec(line);
  if (detail) { current.params = detail[1]; continue; }
  if (/^\d{4}-\d{2}-\d{2} /.test(line)) { flush(); continue; }
  if (line.startsWith("\t") || line.startsWith(" ")) current.sql.push(line);
}
flush();
const rows = [...stats.values()].sort((a, b) => b.total - a.total).slice(0, Number(topArg ?? 15));
for (const row of rows) {
  process.stdout.write(`n=${row.n} total=${row.total.toFixed(0)}ms mean=${(row.total / row.n).toFixed(2)}ms max=${row.max.toFixed(1)}ms\n  ${row.example.slice(0, 700)}\n  params: ${row.params.slice(0, 300)}\n\n`);
}
