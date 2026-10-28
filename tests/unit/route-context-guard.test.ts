import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
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
  const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const isMethod = (name: string) => new RegExp(`^(${methods})$`).test(name);
  const bindingNames = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text]
    : name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
  const wrapped = (value: ts.Expression | undefined) => value && ts.isCallExpression(value)
    && ts.isIdentifier(value.expression) && value.expression.text === "routeContext";
  const bad: string[] = [];
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) bad.push("(unrecognized export)");
      else for (const element of statement.exportClause.elements) if (isMethod(element.name.text)) bad.push(element.name.text);
      continue;
    }
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && isMethod(statement.name.text)) bad.push(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) {
          if (isMethod(name) && (!ts.isIdentifier(declaration.name) || !wrapped(declaration.initializer))) bad.push(name);
        }
      }
    }
  }
  return bad;
}
const exported = (source: string) => [...source.matchAll(new RegExp(`export\\s+(?:const|let|var|(?:async\\s+)?function)\\s+(${methods})\\b`, "g"))].length;

// Health routes answer for the process itself and must not depend on request context (#58); every other route gets
// its own log context from the first line, so no handler can log with another request's actor.
const includedRoute = (path: string) => !relative(root, path).startsWith(join("api", "health") + "/");
const files = routeFiles(root).filter(includedRoute);

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
  expect(unwrappedExports("export const GET = routeContext(serve), POST = unsafe;")).toEqual(["POST"]);
  expect(unwrappedExports("export const GET = routeContext(serve); export const { POST } = handlers;")).toEqual(["POST"]);
});

test("only the health directory is excluded from route-context checks", () => {
  expect(includedRoute(join(root, "api/health/live/route.ts"))).toBe(false);
  expect(includedRoute(join(root, "api/healthcare/route.ts"))).toBe(true);
});
