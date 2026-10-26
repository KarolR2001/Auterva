import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxImageBytes } from "./storage";

const timeoutMs = 30_000;
// Measured peak RSS at the D-04 bound (12 000 x 12 000, files under 10 MB): about 0.9-1.0 GiB for
// lossy/alpha WebP and 4:4:4 progressive JPEG, 0.9 GiB for 8-bit RGBA interlaced PNG.
const maxRssKb = 2 * 1024 * 1024;
const maxQueued = 4;
let running = false;
const waiting: Array<() => void> = [];

/** One decoder process at a time per Node process; a short queue, then MEDIA_BUSY (503). */
async function exclusive<T>(task: () => Promise<T>): Promise<T> {
  if (running) {
    if (waiting.length >= maxQueued) throw new Error("MEDIA_BUSY");
    await new Promise<void>((resolve) => waiting.push(resolve)); // slot is handed over, `running` stays true
  } else running = true;
  try { return await task(); }
  finally {
    const next = waiting.shift();
    if (next) next(); else running = false;
  }
}

function rssKb(pid: number): Promise<number> {
  return new Promise((resolve) => execFile("ps", ["-o", "rss=", "-p", String(pid)], { timeout: 1_000 },
    (error, stdout) => resolve(error ? 0 : Number(stdout.trim()) || 0)));
}

export type DecodedMedia = { mime: "image/jpeg" | "image/png" | "image/webp";
  width: number; height: number; large: Buffer; thumb: Buffer };

export function decodeMedia(bytes: Buffer): Promise<DecodedMedia> {
  return exclusive(() => decodeIsolated(bytes));
}

// The decoder handles untrusted bytes: it never inherits application secrets.
const minimalEnv: Record<string, string | undefined> = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir() };

async function decodeIsolated(bytes: Buffer): Promise<DecodedMedia> {
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error("MEDIA_INVALID_SIZE");
  const dir = await mkdtemp(join(tmpdir(), "auterva-media-"));
  try {
    await writeFile(join(dir, "input"), bytes, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=128",
        join(process.cwd(), "scripts/media-decode.mjs"), join(dir, "input"), dir],
      { stdio: ["ignore", "ignore", "pipe"], env: minimalEnv as NodeJS.ProcessEnv });
      let errorText = "";
      child.stderr.on("data", (chunk: Buffer) => { errorText = `${errorText}${chunk}`.slice(0, 128); });
      let killedForMemory = false;
      let killedForTime = false;
      const memoryCheck = setInterval(() => {
        if (!child.pid) return;
        void rssKb(child.pid).then((rss) => {
          if (rss > maxRssKb) { killedForMemory = true; child.kill("SIGKILL"); }
        });
      }, 100);
      const timeout = setTimeout(() => { killedForTime = true; child.kill("SIGKILL"); }, timeoutMs);
      child.once("error", (error) => { clearTimeout(timeout); clearInterval(memoryCheck); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timeout); clearInterval(memoryCheck);
        if (code === 0) resolve();
        else reject(new Error(killedForMemory ? "MEDIA_MEMORY_LIMIT" : killedForTime ? "MEDIA_DECODE_TIMEOUT"
          : errorText.trim() || "MEDIA_DECODE_FAILED"));
      });
    });
    const parsed: unknown = JSON.parse(await readFile(join(dir, "result.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || !("mime" in parsed) || !("width" in parsed) || !("height" in parsed)
      || !["image/jpeg", "image/png", "image/webp"].includes(String(parsed.mime))
      || !Number.isInteger(parsed.width) || !Number.isInteger(parsed.height)) throw new Error("MEDIA_DECODE_FAILED");
    const large = await readFile(join(dir, "large.webp"));
    const thumb = await readFile(join(dir, "thumb.webp"));
    if (large.length > maxImageBytes || thumb.length > maxImageBytes) throw new Error("MEDIA_INVALID_SIZE");
    return { mime: parsed.mime as DecodedMedia["mime"], width: parsed.width as number,
      height: parsed.height as number, large, thumb };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
