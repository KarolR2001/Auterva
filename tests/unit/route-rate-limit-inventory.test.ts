// #399 (part of #57): inventory of request limits. Every route file must reach a limiter (takeRateLimit,
// takeAuthenticatedApiLimit, reserveAuthAttempt) through its static import graph, or be an explicit, justified exception.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test } from "vitest";

const src = join(process.cwd(), "src");
const LIMITERS = /\b(takeRateLimit|takeRateLimitWithin|takeAuthenticatedApiLimit|reserveAuthAttempt)\(/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(src, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  return null;
}

const sources = new Map<string, string>();
const read = (file: string) => sources.get(file) ?? (sources.set(file, readFileSync(file, "utf8")), sources.get(file)!);
const imports = new Map<string, string[]>();
const importsOf = (file: string) => imports.get(file) ?? (imports.set(file, parseImports(file)), imports.get(file)!);
const parseImports = (file: string) => [...read(file).matchAll(/(?:import|export)\s[^"';]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)]
  .map((match) => resolveImport(file, match[1] ?? match[2])).filter((path): path is string => path !== null);

function reachesLimiter(entry: string): string | null {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (LIMITERS.test(read(file))) return relative(src, file);
    queue.push(...importsOf(file));
  }
  return null;
}

// Routes with no request limit on purpose. Each entry needs a reason; a new route must not be added here silently.
const EXCEPTIONS: Record<string, string> = {
  "api/health/route.ts": "liveness alias: no database, no input, answers for the process",
  "api/health/live/route.ts": "liveness probe: no database, no input",
  "api/health/ready/route.ts": "readiness probe: fixed cheap check, no tenant input; protected by ingress allowlist (#58)",
  "api/health/metrics/route.ts": "bearer-token protected metrics (#58); constant-time token check before any work",
  "api/vitals/route.ts": "anonymous beacon (#340): 64 KiB cap, schema-validated, aggregated in memory, nothing stored per request",
  "robots.txt/route.ts": "static text, no database",
  "sitemap.xml/route.ts": "host-bound sitemap, cache-controlled; no input",
  ".well-known/auterva-domain-check/route.ts": "constant answer for a registered custom host; no company data",
};

test("every route file reaches a request limiter or is a documented exception", () => {
  const unlimited: string[] = [];
  const files = routeFiles(join(src, "app")).map((file) => relative(join(src, "app"), file));
  for (const rel of files) if (!(rel in EXCEPTIONS) && !reachesLimiter(join(src, "app", rel))) unlimited.push(rel);
  expect(unlimited).toEqual([]);
  expect(files.length).toBeGreaterThan(90);
  // No stale exception.
  for (const rel of Object.keys(EXCEPTIONS)) expect(files, rel).toContain(rel);
}, 60_000);
