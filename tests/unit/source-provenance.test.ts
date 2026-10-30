import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

type Source = { path?: string; sha256?: string };

// A merge of two PRs that both touch a documented file leaves a stale checksum; compare raw file bytes.
test("source-provenance sha256 matches every listed file", () => {
  const { sources } = JSON.parse(readFileSync("docs/source-provenance.json", "utf8")) as { sources: Source[] };
  const mismatches = sources
    .filter((s): s is Required<Source> => Boolean(s.path && s.sha256))
    .map((s) => ({ path: s.path, expected: s.sha256, actual: createHash("sha256").update(readFileSync(s.path)).digest("hex") }))
    .filter((s) => s.expected !== s.actual);
  expect(mismatches).toEqual([]);
});
