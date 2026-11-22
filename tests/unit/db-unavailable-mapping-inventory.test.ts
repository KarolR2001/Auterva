// #437: inventory of the handlers' 500 mappers. Wherever an unexpected error is reported as a 500
// (reportInternalError), the same error must first be offered to the common "database unavailable" mapping
// (transientDbResponse), so an outage is the same retryable 503 in every handler as in the proxy.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "vitest";

const src = join(process.cwd(), "src");
// Explicit, justified exceptions (path relative to src, POSIX separators).
const EXCEPTIONS: Record<string, string> = {
  "modules/observability/http-observe.ts": "defines both helpers",
  "proxy.ts": "maps the host lookup itself with isDbUnavailableError (API and page variants of the same 503)",
  "modules/observability/web-vitals-http.ts": "no database I/O: the report is validated and counted in memory",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const calls = (text: string, name: string) => [...text.matchAll(new RegExp(`\\b${name}\\(`, "g"))].length;

test("every 500 mapper offers its error to the common database-unavailable mapping first", () => {
  const missing: string[] = [];
  let mappers = 0;
  for (const file of sourceFiles(src)) {
    const name = relative(src, file).split(sep).join("/");
    const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const reported = calls(text, "reportInternalError");
    if (!reported || name in EXCEPTIONS) continue;
    mappers += 1;
    if (calls(text, "transientDbResponse") < reported) missing.push(name);
  }
  expect(missing).toEqual([]);
  // The scan must actually see the mappers, otherwise it proves nothing.
  expect(mappers).toBeGreaterThan(20);
});

test("the proxy and the unhandled-error hook use the same predicate", () => {
  expect(readFileSync(join(src, "proxy.ts"), "utf8")).toMatch(/isDbUnavailableError\(error\)/);
  expect(readFileSync(join(src, "instrumentation.ts"), "utf8")).toMatch(/isDbUnavailableError\(error\)/);
  for (const name of Object.keys(EXCEPTIONS)) expect(statSync(join(src, name)).isFile(), name).toBe(true);
});
