import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";

// Runs scripts/ci-local.sh in a throwaway repository with stub tools in PATH. No gate is executed:
// the stub pnpm either fails the install step or ends the run, so the script never reaches real jobs.
const script = resolve(__dirname, "../../scripts/ci-local.sh");
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd, encoding: "utf8" });
const stub = (bin: string, name: string, body: string) => {
  writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};

type Versions = { gitleaks?: string; node?: string; pgdump?: string; buildx?: boolean; docker?: boolean };
type Extra = { gitleaksGit?: string; mktempFails?: boolean; env?: Record<string, string> };
function setup(v: Versions = {}, pnpmBody = "exit 1", extra: Extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "ci-local-"));
  roots.push(root);
  const repo = join(root, "repo"), bin = join(root, "bin");
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(repo, ".github/workflows/ci.yml"), 'env:\n      GITLEAKS_VERSION: "8.30.1"\n');
  writeFileSync(join(repo, "package.json"), '{\n  "engines": {\n    "node": "24.20.0"\n  }\n}\n');
  writeFileSync(join(repo, ".gitignore"), ".local/\n");
  mkdirSync(join(repo, "scripts"));
  writeFileSync(join(repo, "scripts/local-fixture.sh"), "#!/bin/bash\nexit 0\n");
  chmodSync(join(repo, "scripts/local-fixture.sh"), 0o755);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  stub(bin, "gitleaks", `if [ "$1" = git ]; then ${extra.gitleaksGit ?? "exit 0"}; fi; echo ${v.gitleaks ?? "8.30.1"}`);
  if (extra.mktempFails) stub(bin, "mktemp", "exit 1");
  stub(bin, "node", `if [ "$1" = --version ]; then echo v${v.node ?? "24.20.0"}; else exec "${process.execPath}" "$@"; fi`);
  stub(bin, "pg_dump", `echo "pg_dump (PostgreSQL) ${v.pgdump ?? "18.1"}"`);
  if (v.docker !== false) stub(bin, "docker", v.buildx === false ? 'test "$1" != buildx' : "exit 0");
  stub(bin, "pnpm", pnpmBody);
  const env: NodeJS.ProcessEnv = { PATH: `${bin}:/usr/bin:/bin`, HOME: root, TMPDIR: root, NODE_ENV: "test" as const, ...extra.env };
  const run = (...args: string[]) => spawnSync("/bin/bash", [script, ...args], { cwd: repo, encoding: "utf8", env });
  // Async variant: stdin stays an open, silent pipe (like a terminal that never sends EOF).
  const runAsync = (...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child: ChildProcessWithoutNullStreams = spawn("/bin/bash", [script, ...args], { cwd: repo, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const lock = join(repo, ".git", "e2e.lock");
  return { root, repo, bin, run, runAsync, lock, out: join(root, "out.txt") };
}

test("refuses to start on a dirty tree (tracked, staged or untracked) but ignores ignored files", () => {
  const t = setup();
  mkdirSync(join(t.repo, ".local"));
  writeFileSync(join(t.repo, ".local/ignored"), "x");
  expect(t.run("27400", t.out).status).toBe(1); // proceeds to the stub install, which fails
  writeFileSync(join(t.repo, "untracked.txt"), "x");
  const r = t.run("27400", t.out);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/working tree is not clean/);
  rmSync(join(t.repo, "untracked.txt"));
  writeFileSync(join(t.repo, "package.json"), "{}\n");
  expect(t.run("27400", t.out).status).toBe(2);
});

test.each([
  [{ gitleaks: "8.29.0" }, /gitleaks 8\.29\.0 found, but 8\.30\.1/],
  [{ node: "24.19.0" }, /node 24\.19\.0 found, but 24\.20\.0/],
  [{ pgdump: "17.5" }, /pg_dump 17\.5 found, but major version 18/],
  [{ docker: false }, /docker is missing/],
  [{ buildx: false }, /docker buildx is missing/],
] as [Versions, RegExp][])("refuses start for tool mismatch %j", (v, message) => {
  const r = setup(v).run("27400", join(tmpdir(), "ci-local-unused.txt"));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(message);
});

test("rejects a semver range in engines.node explicitly", () => {
  const t = setup();
  writeFileSync(join(t.repo, "package.json"), '{"engines":{"node":">=24"}}\n');
  git(t.repo, "commit", "-qam", "range");
  const r = t.run("27400", t.out);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/semver range/);
});

test("accepts matching tool versions and reaches the install step", () => {
  const t = setup();
  const r = t.run("27400", t.out);
  expect(r.status).toBe(1);
  expect(readFileSync(t.out, "utf8")).toMatch(/tools\tnode v24\.20\.0; gitleaks 8\.30\.1; pg_dump 18\.1/);
});

test("SIGTERM stops a running step at once, removes the quality worktree and leaves no step process", async () => {
  // The stub pnpm records its PID, terminates the main script (stub -> subshell -> step subshell -> script)
  // and then would sleep for 30 s; the run must end within seconds and the stub must be gone.
  const t = setup({}, `if [ "$1" = install ] && [ "$(basename "$PWD")" = quality ]; then
  echo "$PWD" > "${"$"}{TMPDIR}/qpath"; echo "$$" > "${"$"}{TMPDIR}/stubpid"
  p="$PPID"; for _ in 1 2; do p="$(ps -o ppid= -p "$p" | tr -d ' ')"; done; kill -TERM "$p"; sleep 30
fi
exit 0`);
  const started = Date.now();
  const r = t.run("27400", t.out);
  const qpath = readFileSync(join(t.root, "qpath"), "utf8").trim();
  const stubPid = Number(readFileSync(join(t.root, "stubpid"), "utf8"));
  expect(qpath).toMatch(/quality$/);
  expect(r.status).toBe(143);
  expect(Date.now() - started).toBeLessThan(15000);
  expect(existsSync(qpath)).toBe(false);
  expect(git(t.repo, "worktree", "list").stdout.trim().split("\n")).toHaveLength(1);
  // ESRCH: the step process is gone (it may be a zombie for a moment, so poll up to ~2 s).
  const alive = () => { try { process.kill(stubPid, 0); return true; } catch { return false; } };
  const deadline = Date.now() + 2000;
  while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  expect(alive()).toBe(false);
}, 30000);

test("a step that reads stdin does not hang or stop the run", async () => {
  const t = setup({}, "exit 0", { gitleaksGit: "cat >/dev/null" });
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(0);
  expect(readFileSync(t.out, "utf8")).toMatch(/Secret scan\tPASS/);
}, 30000);

test("refuses to start when mktemp fails instead of using an empty path", () => {
  const r = setup({}, "exit 0", { mktempFails: true }).run("27400", join(tmpdir(), "ci-local-unused.txt"));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/cannot create a temporary directory/);
});

const live = () => spawn("/bin/sleep", ["60"], { stdio: "ignore" });
const e2eLine = (out: string) => readFileSync(out, "utf8").split("\n").find((line) => line.startsWith("Build and E2E")) ?? "";

test("E2E waits for a lock held by a live run, then proceeds once it is released and cleans up", async () => {
  const t = setup({}, "exit 0", { env: { AUTERVA_E2E_LOCK_TIMEOUT: "30", AUTERVA_E2E_LOCK_POLL: "1" } });
  const holder = live();
  try {
    mkdirSync(t.lock);
    writeFileSync(join(t.lock, "pid"), String(holder.pid));
    const started = Date.now();
    const running = t.runAsync("27400", t.out);
    // Release only once the run reports that it is waiting (independent of start-up time).
    const waitLog = join(t.repo, ".local/ci-local/e2e-lock.log");
    const until = Date.now() + 40000;
    while (Date.now() < until && !(existsSync(waitLog) && /waiting for the E2E lock/.test(readFileSync(waitLog, "utf8")))) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1500)); // it keeps waiting while the holder is alive
    expect(existsSync(t.lock)).toBe(true); // still the holder's lock, not taken
    expect(readFileSync(join(t.lock, "pid"), "utf8").trim()).toBe(String(holder.pid));
    rmSync(t.lock, { recursive: true });
    const r = await running;
    expect(r.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(r.stderr).toMatch(/waiting for the E2E lock .* held by process/);
    expect(e2eLine(t.out)).toMatch(/PASS/);
    expect(existsSync(t.lock)).toBe(false);
  } finally { holder.kill(); }
}, 60000);

test("E2E reports a clear FAIL when the lock does not free up in time, and leaves the holder's lock alone", async () => {
  const t = setup({}, "exit 0", { env: { AUTERVA_E2E_LOCK_TIMEOUT: "2", AUTERVA_E2E_LOCK_POLL: "1" } });
  const holder = live();
  try {
    mkdirSync(t.lock);
    writeFileSync(join(t.lock, "pid"), String(holder.pid));
    const r = await t.runAsync("27400", t.out);
    expect(r.status).toBe(1);
    expect(e2eLine(t.out)).toMatch(/FAIL \(E2E lock or ports not available/);
    expect(r.stderr).toMatch(/timed out after 2s waiting for the E2E lock held by process/);
    expect(readFileSync(join(t.lock, "pid"), "utf8").trim()).toBe(String(holder.pid));
    expect(readFileSync(t.out, "utf8")).toMatch(/Secret scan\tPASS/); // later steps still run
  } finally { holder.kill(); }
}, 60000);

test("E2E takes over a stale lock whose owner no longer exists", async () => {
  const t = setup({}, "exit 0", { env: { AUTERVA_E2E_LOCK_TIMEOUT: "5", AUTERVA_E2E_LOCK_POLL: "1" } });
  const finished = spawnSync("/usr/bin/true");
  mkdirSync(t.lock);
  writeFileSync(join(t.lock, "pid"), String(finished.pid));
  const started = Date.now();
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(new RegExp(`taking over stale E2E lock of finished process ${finished.pid}`));
  expect(e2eLine(t.out)).toMatch(/PASS/);
  expect(Date.now() - started).toBeLessThan(25000);
  expect(existsSync(t.lock)).toBe(false);
}, 60000);

test("a terminated run releases the E2E lock it holds", async () => {
  // In the E2E step (the only place where the lock exists) the stub pnpm terminates the main script and then sleeps.
  const t = setup({}, `if [ "$1" = exec ] && [ "$2" = tsx ] && [ -d .git/e2e.lock ]; then
  echo "$$" > "${"$"}{TMPDIR}/stubpid"; kill -TERM "$(ps -o ppid= -p "$PPID" | tr -d ' ')"; sleep 30
fi
exit 0`);
  const started = Date.now();
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(143);
  expect(Date.now() - started).toBeLessThan(20000);
  expect(existsSync(join(t.root, "stubpid"))).toBe(true); // the lock existed when the stub ran
  expect(existsSync(t.lock)).toBe(false);
}, 60000);

test("E2E waits for foreign listeners on the fixed ports and fails clearly if they stay", async () => {
  const busyStub = (t: ReturnType<typeof setup>) => stub(t.bin, "lsof", `[ -f "${"$"}{TMPDIR}/ports-busy" ]`);
  const env = { AUTERVA_E2E_LOCK_TIMEOUT: "3", AUTERVA_E2E_LOCK_POLL: "1" };
  const stays = setup({}, "exit 0", { env });
  busyStub(stays);
  writeFileSync(join(stays.root, "ports-busy"), "");
  const failed = await stays.runAsync("27400", stays.out);
  expect(failed.stderr).toMatch(/timed out after 3s waiting for E2E ports to free up \(busy: 3305 3306 3307\)/);
  expect(e2eLine(stays.out)).toMatch(/FAIL \(E2E lock or ports not available/);
  expect(existsSync(stays.lock)).toBe(false); // the lock is released when the ports never freed up

  const frees = setup({}, "exit 0", { env: { AUTERVA_E2E_LOCK_TIMEOUT: "60", AUTERVA_E2E_LOCK_POLL: "1" } });
  busyStub(frees);
  writeFileSync(join(frees.root, "ports-busy"), "");
  const running = frees.runAsync("27400", frees.out);
  // Free the ports only once the run reports that it is waiting (deterministic, independent of start-up time).
  const waitLog = join(frees.repo, ".local/ci-local/e2e-lock.log");
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !(existsSync(waitLog) && /waiting for E2E ports/.test(readFileSync(waitLog, "utf8")))) {
    await new Promise((r) => setTimeout(r, 100));
  }
  rmSync(join(frees.root, "ports-busy"));
  const ok = await running;
  expect(ok.stderr).toMatch(/waiting for E2E ports held by another process/);
  expect(e2eLine(frees.out)).toMatch(/PASS/);
  expect(existsSync(frees.lock)).toBe(false);
}, 60000);

test("E2E does not wait on a lock the caller says it already holds, and leaves it in place", async () => {
  const t = setup({}, "exit 0", { env: { AUTERVA_E2E_LOCK_HELD: "1", AUTERVA_E2E_LOCK_TIMEOUT: "2", AUTERVA_E2E_LOCK_POLL: "1" } });
  mkdirSync(t.lock);
  writeFileSync(join(t.lock, "owner"), "caller");
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(0);
  expect(e2eLine(t.out)).toMatch(/PASS/);
  expect(existsSync(t.lock)).toBe(true); // not released by ci-local
  expect(readFileSync(join(t.lock, "owner"), "utf8").trim()).toBe("caller");
}, 60000);
