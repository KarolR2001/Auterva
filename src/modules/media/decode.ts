import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rssProbe } from "./rss";
import { maxImageBytes } from "./storage";

const timeoutMs = 30_000;
// Measured peak RSS of the decoder at the D-04 bound (12 000 x 12 000, files under 10 MB): about
// 0.9-1.0 GiB for lossy/alpha WebP and 4:4:4 progressive JPEG, 0.9 GiB for 8-bit RGBA interlaced PNG and
// about 1.5 GiB worst case (16-bit RGBA interlaced PNG). The 2 GiB limit is enforced by sampling RSS and
// is fail-closed: when RSS cannot be measured the decode is refused (MEDIA_DECODER_UNAVAILABLE), never
// run unlimited. Operational requirements: docs/contracts/media-upload-processing.md.
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

const maxMeasureFailures = 2;

/** Environment/I-O failures are retryable: they say nothing about the image itself. */
function environmentError(error: unknown): Error {
  if (error instanceof Error && /^MEDIA_/.test(error.message)) return error;
  return new Error("MEDIA_DECODER_UNAVAILABLE", { cause: error });
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
  // Fail closed before any untrusted byte is processed: the limit needs a working measurement.
  if (await rssProbe.read(process.pid).catch(() => null) === null) throw new Error("MEDIA_DECODER_UNAVAILABLE");
  let dir: string;
  try { dir = await mkdtemp(join(tmpdir(), "auterva-media-")); } catch (error) { throw environmentError(error); }
  try {
    await writeFile(join(dir, "input"), bytes, { mode: 0o600 }).catch((error: unknown) => { throw environmentError(error); });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=128",
        join(process.cwd(), "scripts/media-decode.mjs"), join(dir, "input"), dir],
      { stdio: ["ignore", "ignore", "pipe"], env: minimalEnv as NodeJS.ProcessEnv });
      let errorText = "";
      child.stderr.on("data", (chunk: Buffer) => { errorText = `${errorText}${chunk}`.slice(0, 128); });
      let killedForMemory = false;
      let killedForTime = false;
      let killedUnmeasurable = false;
      let finished = false;
      let failures = 0;
      let sampler: NodeJS.Timeout | undefined;
      const alive = () => child.exitCode === null && child.signalCode === null;
      const sample = () => {
        if (finished || !child.pid) return;
        void rssProbe.read(child.pid).catch(() => null).then((rss) => {
          if (finished || !alive()) return;
          if (rss === null) {
            if (++failures >= maxMeasureFailures) { killedUnmeasurable = true; child.kill("SIGKILL"); return; }
          } else {
            failures = 0;
            if (rss > maxRssKb) { killedForMemory = true; child.kill("SIGKILL"); return; }
          }
          sampler = setTimeout(sample, 100);
        });
      };
      sampler = setTimeout(sample, 100);
      const stop = () => { finished = true; clearTimeout(timeout); clearTimeout(sampler); };
      const timeout = setTimeout(() => { killedForTime = true; child.kill("SIGKILL"); }, timeoutMs);
      child.once("error", (error) => { stop(); reject(environmentError(error)); });
      child.once("exit", (code, signal) => {
        stop();
        if (code === 0) resolve();
        else if (killedForMemory) reject(new Error("MEDIA_MEMORY_LIMIT"));
        else if (killedForTime) reject(new Error("MEDIA_DECODE_TIMEOUT"));
        else if (killedUnmeasurable || signal) reject(new Error("MEDIA_DECODER_UNAVAILABLE")); // e.g. OOM-killer
        else if (code === 1) reject(new Error(errorText.trim() || "MEDIA_DECODE_FAILED"));
        else reject(new Error("MEDIA_DECODER_UNAVAILABLE")); // abort/runtime failure, not a verdict on the image
      });
    });
    const parsed: unknown = await readFile(join(dir, "result.json"), "utf8").then(
      (text) => JSON.parse(text) as unknown, (error: unknown) => { throw environmentError(error); });
    if (!parsed || typeof parsed !== "object" || !("mime" in parsed) || !("width" in parsed) || !("height" in parsed)
      || !["image/jpeg", "image/png", "image/webp"].includes(String(parsed.mime))
      || !Number.isInteger(parsed.width) || !Number.isInteger(parsed.height)) throw new Error("MEDIA_DECODE_FAILED");
    const [large, thumb] = await Promise.all([readFile(join(dir, "large.webp")), readFile(join(dir, "thumb.webp"))])
      .catch((error: unknown) => { throw environmentError(error); });
    if (large.length > maxImageBytes || thumb.length > maxImageBytes) throw new Error("MEDIA_INVALID_SIZE");
    return { mime: parsed.mime as DecodedMedia["mime"], width: parsed.width as number,
      height: parsed.height as number, large, thumb };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
