import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// JSON.parse silently keeps the last of two equal keys, which hid a lost "},{" in a merge. This small strict
// parser reports every duplicate key together with its path.
function parseStrict(text: string): { value: unknown; duplicates: string[] } {
  let position = 0;
  const duplicates: string[] = [];
  const fail = (what: string): never => { throw new Error(`Invalid JSON at ${position}: ${what}`); };
  const skip = () => { while (/\s/.test(text[position] ?? "")) position += 1; };
  const string = (): string => {
    const start = position;
    if (text[position] !== '"') fail("string expected");
    position += 1;
    while (text[position] !== '"') {
      if (position >= text.length) fail("unterminated string");
      position += text[position] === "\\" ? 2 : 1;
    }
    position += 1;
    return JSON.parse(text.slice(start, position)) as string;
  };
  const value = (path: string): unknown => {
    skip();
    const c = text[position];
    if (c === "{") {
      position += 1;
      const seen = new Set<string>();
      const out: Record<string, unknown> = {};
      skip();
      if (text[position] === "}") { position += 1; return out; }
      for (;;) {
        skip();
        const key = string();
        if (seen.has(key)) duplicates.push(`${path}.${key}`);
        seen.add(key);
        skip();
        if (text[position] !== ":") fail("':' expected");
        position += 1;
        out[key] = value(`${path}.${key}`);
        skip();
        if (text[position] === ",") { position += 1; continue; }
        if (text[position] === "}") { position += 1; return out; }
        fail("',' or '}' expected");
      }
    }
    if (c === "[") {
      position += 1;
      const out: unknown[] = [];
      skip();
      if (text[position] === "]") { position += 1; return out; }
      for (;;) {
        out.push(value(`${path}[${out.length}]`));
        skip();
        if (text[position] === ",") { position += 1; continue; }
        if (text[position] === "]") { position += 1; return out; }
        fail("',' or ']' expected");
      }
    }
    if (c === '"') return string();
    const literal = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position));
    if (!literal) return fail("value expected");
    position += literal[0].length;
    return JSON.parse(literal[0]) as unknown;
  };
  const result = value("$");
  skip();
  if (position !== text.length) fail("trailing data");
  return { value: result, duplicates };
}

const text = readFileSync(new URL("../../design/traceability.json", import.meta.url), "utf8");

test("the strict parser reports duplicate keys that JSON.parse hides", () => {
  expect(parseStrict('{"a":1,"b":{"c":1,"c":2}}').duplicates).toEqual(["$.b.c"]);
  expect(parseStrict('[{"issue":1,"scope":"x"\n"issue":2}]' .replace('"x"\n', '"x",')).duplicates).toEqual(["$[0].issue"]);
  expect(() => parseStrict('{"a":1,}')).toThrow();
});

test("traceability.json has no duplicate keys in any object", () => {
  expect(parseStrict(text).duplicates).toEqual([]);
});

test("every implementation entry names a distinct issue", () => {
  const parsed = JSON.parse(text) as { implementationRefs: { issue: number }[] };
  const issues = parsed.implementationRefs.map((entry) => entry.issue);
  expect(new Set(issues).size).toBe(issues.length);
  expect(issues.filter((issue) => issue === 50)).toHaveLength(1);
  expect(issues).toContain(30);
});
