import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { csvCell, toCsv } from "../../src/modules/company-export/csv";
import { createZip } from "../../src/modules/company-export/zip";
import { decryptArtifact, encryptArtifact, exportArtifactKey } from "../../src/modules/company-export/artifact";

// #328: the CSV guard against spreadsheet formulas, the ZIP container and the file encryption.
test("CSV: text a spreadsheet would read as a formula gets an apostrophe; numbers, booleans and empty cells do not", () => {
  for (const text of ["=1+1", "+48 600", "-5", "@SUM(A1)", "\tx", "\rx", "  =cmd", "=HYPERLINK(\"u\")"]) {
    expect(csvCell(text), JSON.stringify(text)).toMatch(/^"?'/);
  }
  expect(csvCell("=HYPERLINK(\"u\")")).toBe(`"'=HYPERLINK(""u"")"`);
  expect(csvCell("zwykły tekst")).toBe("zwykły tekst");
  expect(csvCell("a-b=c+d@e")).toBe("a-b=c+d@e");
  expect(csvCell(-5)).toBe("-5");
  expect(csvCell(true)).toBe("true");
  expect(csvCell(null)).toBe("");
  expect(csvCell(undefined)).toBe("");
  expect(csvCell("a;b")).toBe(`"a;b"`);
  expect(csvCell("linia\r\nlinia")).toBe(`"linia\r\nlinia"`);
  expect(csvCell("2026-07-01")).toBe("2026-07-01");
});

test("CSV: UTF-8 BOM, semicolon separator and CRLF rows", () => {
  const bytes = toCsv(["a", "b"], [["x", "=y"], [1, null]]);
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(bytes.toString("utf8").slice(1)).toBe("a;b\r\nx;'=y\r\n1;\r\n");
});

test("ZIP: a standard unzip tool accepts the archive and returns the exact bytes", () => {
  const zip = createZip([{ name: "a.json", data: Buffer.from('{"zażółć":"gęślą"}\n') }, { name: "b.csv", data: Buffer.from("x;y\r\n".repeat(500)) }],
    new Date("2026-11-10T12:00:00Z"));
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  try {
    writeFileSync(join(dir, "t.zip"), zip);
    const probe = spawnSync("unzip", ["-t", join(dir, "t.zip")], { encoding: "utf8" });
    if (probe.error) return; // no unzip on this machine; the integration test parses the central directory itself
    expect(probe.status, probe.stdout + probe.stderr).toBe(0);
    expect(spawnSync("unzip", ["-p", join(dir, "t.zip"), "a.json"], { encoding: "utf8" }).stdout).toBe('{"zażółć":"gęślą"}\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  expect(() => createZip([{ name: "../x", data: Buffer.alloc(1) }], new Date())).toThrow("ZIP_INVALID_NAME");
});

test("encryption: round trip, and a wrong key, wrong artifact key, flipped byte or wrong digest never decrypt", () => {
  const key = Buffer.alloc(32, 7);
  const aad = exportArtifactKey("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  const { bytes, digest } = encryptArtifact(Buffer.from("tajne"), key, aad);
  expect(decryptArtifact(bytes, key, aad, digest).toString()).toBe("tajne");
  expect(bytes.includes(Buffer.from("tajne"))).toBe(false);
  expect(() => decryptArtifact(bytes, Buffer.alloc(32, 8), aad, digest)).toThrow();
  expect(() => decryptArtifact(bytes, key, aad.replace("1111", "3333"), digest)).toThrow();
  expect(() => decryptArtifact(bytes, key, aad, "0".repeat(64))).toThrow("EXPORT_INTEGRITY_FAILED");
  expect(() => decryptArtifact(bytes, key, aad, null)).toThrow("EXPORT_INTEGRITY_FAILED");
  const flipped = Buffer.from(bytes);
  flipped[flipped.length - 1] ^= 1;
  expect(() => decryptArtifact(flipped, key, aad, digest)).toThrow("EXPORT_INTEGRITY_FAILED");
  // Even with a recomputed digest the GCM tag refuses the altered ciphertext.
  expect(() => decryptArtifact(flipped, key, aad, createHash("sha256").update(flipped).digest("hex"))).toThrow();
});
