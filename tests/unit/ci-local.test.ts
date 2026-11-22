import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, utimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test, vi } from "vitest";

/**
 * Every test here runs the real script in a child bash (git, node, several subprocesses; seconds under load) or waits on
 * real processes, so the default 5 s is shorter than the work itself on a busy machine (#264). File-level default for
 * current and future tests; the inner waits stay bounded, no assertion is weakened.
 */
vi.setConfig({ testTimeout: 60_000 });
const TEST_TIMEOUT_MS = 60_000;

// ci-local derives every port from its LOCAL_PORT_BASE and refuses to start when a process outside the worktree listens
// on one (precheck_ports). A fixed base would make these tests depend on what other agents listen on (#277), so each
// test picks a frame whose ports are all free right now: base..+14 (fixture, E2E) and +101..+107 (SeaweedFS gRPC).
const frameOffsets = [...Array.from({ length: 15 }, (_, i) => i), ...Array.from({ length: 7 }, (_, i) => 101 + i)];
function listeningPorts(): Set<number> {
  const out = spawnSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-Fn"], { encoding: "utf8" }).stdout ?? "";
  return new Set([...out.matchAll(/^n.*:(\d+)$/gm)].map((m) => Number(m[1])));
}
const takenFrames = new Set<number>();
function freeBase(): number {
  const used = listeningPorts();
  for (let attempt = 0; attempt < 500; attempt++) {
    const base = 20000 + Math.floor(Math.random() * 350) * 120;
    if (takenFrames.has(base) || frameOffsets.some((o) => used.has(base + o))) continue;
    takenFrames.add(base);
    return base;
  }
  throw new Error("no free port frame found for the ci-local tests");
}

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
  // A runner may ship a real docker in /usr/bin (GitHub Actions does), which would defeat docker:false; then the system
  // directories are mirrored by symlinks without docker.
  let systemPath = "/usr/bin:/bin:/usr/sbin";
  if (v.docker === false) {
    const sys = join(root, "sys");
    mkdirSync(sys);
    for (const dir of systemPath.split(":")) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (name !== "docker" && !existsSync(join(sys, name))) symlinkSync(join(dir, name), join(sys, name));
      }
    }
    systemPath = sys;
  }
  const env: NodeJS.ProcessEnv = { PATH: `${bin}:${systemPath}`, HOME: root, TMPDIR: root, NODE_ENV: "test" as const, ...extra.env };
  const base = freeBase();
  // "27400" in a call stands for this setup's own free frame.
  const mapped = (args: string[]) => args.map((a) => (a === "27400" ? String(base) : a));
  const run = (...args: string[]) => spawnSync("/bin/bash", [script, ...mapped(args)], { cwd: repo, encoding: "utf8", env });
  // Async variant: stdin stays an open, silent pipe (like a terminal that never sends EOF).
  const runAsync = (...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child: ChildProcessWithoutNullStreams = spawn("/bin/bash", [script, ...mapped(args)], { cwd: repo, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const slots = join(repo, ".git", "e2e.slots");
  return { root, repo, bin, base, run, runAsync, slots, out: join(root, "out.txt") };
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
}, TEST_TIMEOUT_MS);

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
}, TEST_TIMEOUT_MS);

test("accepts matching tool versions and reaches the install step", () => {
  const t = setup();
  const r = t.run("27400", t.out);
  expect(r.status).toBe(1);
  expect(readFileSync(t.out, "utf8")).toMatch(/tools\tnode v24\.20\.0; gitleaks 8\.30\.1; pg_dump 18\.1/);
}, TEST_TIMEOUT_MS);

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
}, TEST_TIMEOUT_MS);

const live = () => spawn("/bin/sleep", ["60"], { stdio: "ignore" });
const e2eLine = (out: string) => readFileSync(out, "utf8").split("\n").find((line) => line.startsWith("Build and E2E")) ?? "";

const slotDir = (t: ReturnType<typeof setup>, n: number) => join(t.slots, String(n));
function takeSlot(t: ReturnType<typeof setup>, n: number, pid: number | null, owner?: string) {
  mkdirSync(slotDir(t, n), { recursive: true });
  if (pid !== null) writeFileSync(join(slotDir(t, n), "pid"), String(pid));
  if (owner) writeFileSync(join(slotDir(t, n), "owner"), owner);
}
const lockEnv = (timeout: string, extra: Record<string, string> = {}) => ({ AUTERVA_E2E_LOCK_TIMEOUT: timeout, AUTERVA_E2E_LOCK_POLL: "1", ...extra });

test("two runs share the machine: with a free slot left E2E does not wait, and the slot is released afterwards", async () => {
  const t = setup({}, "exit 0", { env: lockEnv("5", { AUTERVA_E2E_SLOTS: "2" }) });
  const holder = live();
  try {
    takeSlot(t, 0, holder.pid!, "other run");
    const r = await t.runAsync("27400", t.out);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(new RegExp(`took E2E slot 1 of 2 \\(ports ${t.base + 12} ${t.base + 13} ${t.base + 14}\\)`));
    expect(r.stderr).not.toMatch(/waiting for an E2E slot/);
    expect(e2eLine(t.out)).toMatch(/PASS/);
    expect(existsSync(slotDir(t, 1))).toBe(false); // ours is released
    expect(readFileSync(join(slotDir(t, 0), "pid"), "utf8").trim()).toBe(String(holder.pid)); // the other run's slot is untouched
  } finally { holder.kill(); }
}, 60000);

test("E2E waits when every slot is held by a live run, then proceeds once one is released", async () => {
  const t = setup({}, "exit 0", { env: lockEnv("30", { AUTERVA_E2E_SLOTS: "2" }) });
  const a = live(), b = live();
  try {
    takeSlot(t, 0, a.pid!); takeSlot(t, 1, b.pid!);
    const started = Date.now();
    const running = t.runAsync("27400", t.out);
    const waitLog = join(t.repo, ".local/ci-local/e2e-lock.log");
    const until = Date.now() + 40000;
    while (Date.now() < until && !(existsSync(waitLog) && /waiting for an E2E slot/.test(readFileSync(waitLog, "utf8")))) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1500)); // it keeps waiting while both holders are alive
    expect(existsSync(slotDir(t, 0)) && existsSync(slotDir(t, 1))).toBe(true);
    rmSync(slotDir(t, 1), { recursive: true });
    const r = await running;
    expect(r.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(r.stderr).toMatch(/waiting for an E2E slot of 2 \(held by: 0:process \d+ 1:process \d+\)/);
    expect(e2eLine(t.out)).toMatch(/PASS/);
    expect(existsSync(slotDir(t, 1))).toBe(false);
  } finally { a.kill(); b.kill(); }
}, 60000);

test("E2E reports a clear FAIL when no slot frees up in time and leaves the holders alone", async () => {
  const t = setup({}, "exit 0", { env: lockEnv("2", { AUTERVA_E2E_SLOTS: "1" }) });
  const holder = live();
  try {
    takeSlot(t, 0, holder.pid!);
    const r = await t.runAsync("27400", t.out);
    expect(r.status).toBe(1);
    expect(e2eLine(t.out)).toMatch(/FAIL \(E2E slot or ports not available/);
    expect(r.stderr).toMatch(/timed out after 2s waiting for an E2E slot \(held by: 0:process \d+\)/);
    expect(readFileSync(join(slotDir(t, 0), "pid"), "utf8").trim()).toBe(String(holder.pid));
    expect(readFileSync(t.out, "utf8")).toMatch(/Secret scan\tPASS/); // later steps still run
  } finally { holder.kill(); }
}, 60000);

test("E2E takes over a slot whose owner no longer exists", async () => {
  const t = setup({}, "exit 0", { env: lockEnv("5", { AUTERVA_E2E_SLOTS: "1" }) });
  const finished = spawnSync("/usr/bin/true");
  takeSlot(t, 0, finished.pid!);
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(new RegExp(`taking over stale E2E slot 0 of finished process ${finished.pid}`));
  expect(e2eLine(t.out)).toMatch(/PASS/);
  expect(existsSync(slotDir(t, 0))).toBe(false);
}, 60000);

test("a fresh hand-made slot (owner name, no pid) is waited on, never moved aside; one older than 40 minutes is taken over", async () => {
  const fresh = setup({}, "exit 0", { env: lockEnv("3", { AUTERVA_E2E_SLOTS: "1" }) });
  takeSlot(fresh, 0, null, "agent-A");
  let missing = 0, polling = true;
  const poll = (async () => { while (polling) { if (!existsSync(join(slotDir(fresh, 0), "owner"))) missing++; await new Promise((r) => setTimeout(r, 10)); } })();
  const failed = await fresh.runAsync("27400", fresh.out);
  polling = false; await poll;
  expect(failed.status).toBe(1);
  expect(failed.stderr).toMatch(/timed out after 3s waiting for an E2E slot \(held by: 0:manual owner agent-A\)/);
  expect(missing).toBe(0);
  expect(readFileSync(join(slotDir(fresh, 0), "owner"), "utf8").trim()).toBe("agent-A");

  const old = setup({}, "exit 0", { env: lockEnv("5", { AUTERVA_E2E_SLOTS: "1" }) });
  takeSlot(old, 0, null, "agent-A");
  const past = new Date(Date.now() - 41 * 60 * 1000);
  utimesSync(slotDir(old, 0), past, past);
  const ok = await old.runAsync("27400", old.out);
  expect(ok.status).toBe(0);
  expect(ok.stderr).toMatch(/taking over abandoned manual E2E slot 0/);
  expect(existsSync(slotDir(old, 0))).toBe(false);
}, 60000);

test("a fresh e2e-priority file reserves the last slot for priority runs only", async () => {
  const env = lockEnv("3", { AUTERVA_E2E_SLOTS: "2" });
  const holder = live();
  try {
    const normal = setup({}, "exit 0", { env });
    takeSlot(normal, 0, holder.pid!);
    writeFileSync(join(normal.repo, ".git", "e2e-priority"), "cand: test\n");
    const blocked = await normal.runAsync("27400", normal.out);
    expect(blocked.status).toBe(1); // slot 1 is reserved: a normal run only has slot 0, which is held
    expect(blocked.stderr).toMatch(/timed out after 3s waiting for an E2E slot/);

    const priority = setup({}, "exit 0", { env: { ...env, AUTERVA_E2E_PRIORITY: "1" } });
    takeSlot(priority, 0, holder.pid!);
    writeFileSync(join(priority.repo, ".git", "e2e-priority"), "cand: test\n");
    const ok = await priority.runAsync("27400", priority.out);
    expect(ok.status).toBe(0);
    expect(ok.stderr).toMatch(/took E2E slot 1 of 2/);

    const stale = setup({}, "exit 0", { env });
    takeSlot(stale, 0, holder.pid!);
    writeFileSync(join(stale.repo, ".git", "e2e-priority"), "cand: old\n");
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(join(stale.repo, ".git", "e2e-priority"), past, past);
    const free = await stale.runAsync("27400", stale.out);
    expect(free.status).toBe(0); // an old priority file reserves nothing
    expect(free.stderr).toMatch(/took E2E slot 1 of 2/);
  } finally { holder.kill(); }
}, 90000);

test("E2E ports are derived from the worktree base and handed to Playwright", async () => {
  const t = setup({}, 'if [ "$1" = test:e2e ]; then echo "$E2E_PORT $E2E_DEV_PORT $E2E_TRUSTED_PORT" > "$TMPDIR/ports"; fi; exit 0',
    { env: lockEnv("5") });
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(0);
  expect(readFileSync(join(t.root, "ports"), "utf8").trim()).toBe(`${t.base + 12} ${t.base + 13} ${t.base + 14}`);
  const high = await setup({}, "exit 0").runAsync("65530", join(tmpdir(), "ci-local-unused2.txt"));
  expect(high.status).toBe(2);
  expect(high.stderr).toMatch(/leaves no room for the E2E ports/);
}, 60000);

test("prisma generate runs explicitly before lint in the clean worktree and once in the main tree", async () => {
  // pnpm skips postinstall when the lockfile is unchanged, so a new schema must not depend on it.
  const t = setup({}, 'echo "$PWD $*" >> "$TMPDIR/pnpm.log"; exit 0', { env: { AUTERVA_E2E_LOCK_TIMEOUT: "5", AUTERVA_E2E_LOCK_POLL: "1" } });
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(0);
  const lines = readFileSync(join(t.root, "pnpm.log"), "utf8").trim().split("\n");
  const idx = (re: RegExp) => lines.findIndex((l) => re.test(l));
  const mainGen = idx(/repo exec prisma generate$/);
  expect(mainGen).toBeGreaterThan(idx(/repo install /) - 1);
  const qGen = idx(/quality exec prisma generate$/);
  expect(qGen).toBeGreaterThan(-1);
  expect(qGen).toBeLessThan(idx(/quality lint$/));
  expect(qGen).toBeGreaterThan(idx(/quality install /));
}, 60000);

test("a terminated run releases its slot and stops servers an E2E child left behind, even one that ignores SIGTERM", async () => {
  // In the E2E step the stub starts a detached listener on E2E_PORT (an orphan no process group would catch), then terminates the main script.
  const t = setup({}, `if [ "$1" = exec ] && [ "$2" = tsx ] && [ -d .git/e2e.slots ]; then
  "${process.execPath}" -e 'require("node:child_process").spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); require(\\"node:net\\").createServer().listen(Number(process.env.E2E_PORT), \\"127.0.0.1\\"); setInterval(()=>{}, 1000)"], { detached: true, stdio: "ignore" }).unref()'
  for i in 1 2 3 4 5 6 7 8 9 10; do lsof -iTCP:"$E2E_PORT" -sTCP:LISTEN -n >/dev/null 2>&1 && break; sleep 0.5; done
  echo "$$" > "${"$"}{TMPDIR}/stubpid"; kill -TERM "$(ps -o ppid= -p "$PPID" | tr -d ' ')"; sleep 30
fi
exit 0`);
  const port = t.base + 12;
  const started = Date.now();
  const r = await t.runAsync("27400", t.out);
  expect(r.status).toBe(143);
  expect(Date.now() - started).toBeLessThan(30000);
  expect(existsSync(join(t.root, "stubpid"))).toBe(true); // the slot existed and the orphan was started when the stub ran
  expect(existsSync(slotDir(t, 0))).toBe(false);
  const listening = spawnSync("lsof", [`-iTCP:${port}`, "-sTCP:LISTEN", "-n", "-t"], { encoding: "utf8" });
  for (const pid of listening.stdout.split("\n").filter(Boolean)) process.kill(Number(pid), "SIGKILL"); // never leak a failing run's orphan
  expect(listening.stdout.trim()).toBe(""); // nothing left on the derived E2E port
}, 60000);

test("a fixture or E2E port held by a process of another worktree is refused up front with port and PID, and that process is left alone", async () => {
  const t = setup({}, "exit 0", { env: lockEnv("3") });
  const foreign = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${t.base + 13}, "127.0.0.1"); setInterval(() => {}, 1000)`],
    { cwd: tmpdir(), stdio: "ignore" });
  try {
    for (let i = 0; i < 50 && spawnSync("lsof", [`-iTCP:${t.base + 13}`, "-sTCP:LISTEN", "-n", "-t"]).status !== 0; i++) await new Promise((r) => setTimeout(r, 100));
    const r = await t.runAsync("27400", t.out);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(new RegExp(`port ${t.base + 13} \\(LOCAL_PORT_BASE ${t.base} \\+ 13\\) is held by process ${foreign.pid} .*not by this worktree`));
    expect(() => process.kill(foreign.pid!, 0)).not.toThrow(); // never killed by the run
    expect(readFileSync(t.out, "utf8")).not.toMatch(/Lint, typecheck/); // refused before any step
  } finally { foreign.kill("SIGKILL"); }
}, 60000);

test("E2E waits for foreign listeners on its own ports and fails clearly if they stay", async () => {
  const busyStub = (t: ReturnType<typeof setup>) => stub(t.bin, "lsof", `[ -f "${"$"}{TMPDIR}/ports-busy" ]`);
  const env = lockEnv("3");
  const stays = setup({}, "exit 0", { env });
  busyStub(stays);
  writeFileSync(join(stays.root, "ports-busy"), "");
  const failed = await stays.runAsync("27400", stays.out);
  expect(failed.stderr).toMatch(new RegExp(`timed out after 3s waiting for E2E ports to free up \\(busy: ${stays.base + 12} ${stays.base + 13} ${stays.base + 14}\\)`));
  expect(e2eLine(stays.out)).toMatch(/FAIL \(E2E slot or ports not available/);
  expect(existsSync(slotDir(stays, 0))).toBe(false); // the slot is released when the ports never freed up

  const frees = setup({}, "exit 0", { env: lockEnv("60") });
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
  expect(existsSync(slotDir(frees, 0))).toBe(false);
}, 60000);

test("a caller that already holds a global E2E lock (AUTERVA_E2E_LOCK_HELD=1) takes no slot", async () => {
  const t = setup({}, "exit 0", { env: lockEnv("2", { AUTERVA_E2E_LOCK_HELD: "1", AUTERVA_E2E_SLOTS: "1" }) });
  const holder = live();
  try {
    takeSlot(t, 0, holder.pid!);
    mkdirSync(join(t.repo, ".git", "e2e.lock"));
    writeFileSync(join(t.repo, ".git", "e2e.lock", "owner"), "caller");
    const r = await t.runAsync("27400", t.out);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/AUTERVA_E2E_LOCK_HELD=1\); not taking a slot/);
    expect(e2eLine(t.out)).toMatch(/PASS/);
    expect(existsSync(join(t.repo, ".git", "e2e.lock"))).toBe(true); // the caller's lock is never touched
  } finally { holder.kill(); }
}, 60000);

