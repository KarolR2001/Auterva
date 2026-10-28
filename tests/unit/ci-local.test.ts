import { spawnSync } from "node:child_process";
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
function setup(v: Versions = {}, pnpmBody = "exit 1") {
  const root = mkdtempSync(join(tmpdir(), "ci-local-"));
  roots.push(root);
  const repo = join(root, "repo"), bin = join(root, "bin");
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(repo, ".github/workflows/ci.yml"), 'env:\n      GITLEAKS_VERSION: "8.30.1"\n');
  writeFileSync(join(repo, "package.json"), '{\n  "engines": {\n    "node": "24.20.0"\n  }\n}\n');
  writeFileSync(join(repo, ".gitignore"), ".local/\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  stub(bin, "gitleaks", `echo ${v.gitleaks ?? "8.30.1"}`);
  stub(bin, "node", `if [ "$1" = --version ]; then echo v${v.node ?? "24.20.0"}; else exec "${process.execPath}" "$@"; fi`);
  stub(bin, "pg_dump", `echo "pg_dump (PostgreSQL) ${v.pgdump ?? "18.1"}"`);
  if (v.docker !== false) stub(bin, "docker", v.buildx === false ? 'test "$1" != buildx' : "exit 0");
  stub(bin, "pnpm", pnpmBody);
  const run = (...args: string[]) => spawnSync("/bin/bash", [script, ...args], {
    cwd: repo, encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, TMPDIR: root, NODE_ENV: "test" },
  });
  return { root, repo, bin, run, out: join(root, "out.txt") };
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

test("SIGTERM stops a running step at once, removes the quality worktree and leaves no step process", () => {
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
  expect(() => process.kill(stubPid, 0)).toThrow(); // ESRCH: the step process is gone
}, 30000);
