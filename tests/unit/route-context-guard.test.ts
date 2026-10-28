import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const root = join(process.cwd(), "src/app");
const methods = "GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

/** Names of HTTP-method exports in a route file that are not `routeContext(...)`. */
export function unwrappedExports(source: string): string[] {
  const bad: string[] = [];
  for (const m of source.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${methods})\\b`, "g"))) bad.push(m[1]);
  for (const m of source.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${methods})\\b\\s*(?::[^=]+)?=(?!\\s*routeContext\\s*\\()`, "g"))) bad.push(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const name of m[1].split(",").map((part) => part.trim().split(/\s+as\s+/).pop() ?? "")) if (new RegExp(`^(${methods})$`).test(name)) bad.push(name);
  }
  return bad;
}
const exported = (source: string) => [...source.matchAll(new RegExp(`export\\s+(?:const|let|var|(?:async\\s+)?function)\\s+(${methods})\\b`, "g"))].length;

// Health routes answer for the process itself and must not depend on request context (#58); every other route gets
// its own log context from the first line, so no handler can log with another request's actor.
const files = routeFiles(root).filter((path) => !relative(root, path).startsWith(join("api", "health")));

test("route discovery finds the application routes", () => {
  expect(files.length).toBeGreaterThan(50);
});

test("every HTTP method export of every route (except /api/health/*) is routeContext(...)", () => {
  const offenders = files.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...unwrappedExports(source), ...(exported(source) === 0 ? ["(no method export)"] : [])].map((name) => `${relative(root, path)}: ${name}`);
  });
  expect(offenders).toEqual([]);
});

test("the guard rejects every unwrapped form", () => {
  expect(unwrappedExports("export async function GET() {}")).toEqual(["GET"]);
  expect(unwrappedExports("export function POST() {}")).toEqual(["POST"]);
  expect(unwrappedExports("export const GET = serve;")).toEqual(["GET"]);
  expect(unwrappedExports("export const DELETE = async () => {};")).toEqual(["DELETE"]);
  expect(unwrappedExports("export { GET, handler as POST } from './x';")).toEqual(["GET", "POST"]);
  expect(unwrappedExports("export const GET = routeContext(serve);\nexport const POST = routeContext(\n  async () => {});")).toEqual([]);
  expect(unwrappedExports("export const runtime = 'nodejs';")).toEqual([]);
});
