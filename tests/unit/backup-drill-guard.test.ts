import { describe, expect, test } from "vitest";
import { assertLocalDrillTarget, resolveDrillKey, runThenCleanup } from "../../src/modules/backup/drill-guard";
import { ensurePostgresRunning } from "../../scripts/perf/pg-control";

const local: Record<string, string | undefined> = { AUTERVA_FIXTURE: "1", DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db", S3_ENDPOINT: "http://127.0.0.1:8333" };

describe("assertLocalDrillTarget", () => {
  test("accepts loopback database and endpoint", () => {
    expect(() => assertLocalDrillTarget(local)).not.toThrow();
    expect(() => assertLocalDrillTarget({ ...local, S3_ENDPOINT: "http://localhost:8333" })).not.toThrow();
  });
  test.each([
    ["remote endpoint", { S3_ENDPOINT: "https://s3.eu-central-1.amazonaws.com" }],
    ["missing endpoint", { S3_ENDPOINT: undefined }],
    ["unparsable endpoint", { S3_ENDPOINT: "not a url" }],
    ["remote database", { DATABASE_URL: "postgresql://u:p@db.example.com/db" }],
    ["no fixture flag", { AUTERVA_FIXTURE: undefined }],
    ["production", { NODE_ENV: "production" }],
  ])("refuses %s", (_name, override) => {
    expect(() => assertLocalDrillTarget({ ...local, ...override })).toThrow(/DRILL_REFUSED/);
  });
});

describe("assertLocalDrillTarget loopback bypass attempts", () => {
  test.each([
    "http://127.0.0.1.evil.com:8333", "http://localhost@evil.com", "http://127.0.0.1@evil.com", "http://evil.com#@127.0.0.1",
    "http://0.0.0.0:8333", "http://localhost.:8333", "http://localhost.evil.com", "http://[::ffff:127.0.0.1]:8333", "127.0.0.1:8333", "127.0.0.1",
  ])("refuses S3_ENDPOINT %s", (endpoint) => {
    expect(() => assertLocalDrillTarget({ ...local, S3_ENDPOINT: endpoint })).toThrow(/DRILL_REFUSED/);
  });
  test.each(["http://[::1]:8333", "http://localhost", "http://u:p@127.0.0.1:8333"])("accepts S3_ENDPOINT %s", (endpoint) => {
    expect(() => assertLocalDrillTarget({ ...local, S3_ENDPOINT: endpoint })).not.toThrow();
  });
});

describe("resolveDrillKey", () => {
  test("warns about a random key only with --keep", () => {
    expect(resolveDrillKey({}, true).warning).toMatch(/DRILL_KEEP_RANDOM_KEY/);
    expect(resolveDrillKey({}, false).warning).toBeUndefined();
    expect(resolveDrillKey({}, true).keyHex).toMatch(/^[0-9a-f]{64}$/);
  });
  test("an explicit key is used without warning", () => {
    const key = "ab".repeat(32);
    expect(resolveDrillKey({ BACKUP_ENCRYPTION_KEY: key }, true)).toEqual({ keyHex: key, generated: false });
  });
});

describe("runThenCleanup", () => {
  test("a failing cleanup does not hide the original error", async () => {
    const original = new Error("drill failed");
    const cleanupError = new Error("drop failed");
    const caught = await runThenCleanup(async () => { throw original; }, async () => { throw cleanupError; }).catch((e) => e);
    expect(caught).toBe(original);
    expect((caught as { cleanupError?: unknown }).cleanupError).toBe(cleanupError);
  });
  test("cleanup runs after success, and its failure then surfaces", async () => {
    let cleaned = 0;
    await expect(runThenCleanup(async () => 7, async () => { cleaned += 1; })).resolves.toBe(7);
    expect(cleaned).toBe(1);
    await expect(runThenCleanup(async () => 7, async () => { throw new Error("drop failed"); })).rejects.toThrow("drop failed");
  });
});

describe("ensurePostgresRunning (fault scripts finally)", () => {
  const options = { pgDir: "/pg", fixtureDir: "/fx", port: "55210" };
  test("starts the database when status says it is down", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => { calls.push(args); if (args.includes("status")) throw new Error("exit 3"); };
    expect(ensurePostgresRunning({ ...options, run })).toBe("restarted");
    expect(calls.at(-1)).toContain("start");
    expect(calls.at(-1)).toContain("-w");
  });
  test("does nothing when the database is running", () => {
    const calls: string[][] = [];
    expect(ensurePostgresRunning({ ...options, run: (args) => { calls.push(args); } })).toBe("already-running");
    expect(calls).toHaveLength(1);
  });
});
