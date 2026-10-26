import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxImageBytes } from "./storage";

const timeoutMs = 10_000;
const maxRssKb = 384 * 1024;

export type DecodedMedia = { mime: "image/jpeg" | "image/png" | "image/webp";
  width: number; height: number; large: Buffer; thumb: Buffer };

export async function decodeMedia(bytes: Buffer): Promise<DecodedMedia> {
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error("MEDIA_INVALID_SIZE");
  const dir = await mkdtemp(join(tmpdir(), "auterva-media-"));
  try {
    await writeFile(join(dir, "input"), bytes, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=128",
        join(process.cwd(), "scripts/media-decode.mjs"), join(dir, "input"), dir],
      { stdio: ["ignore", "ignore", "pipe"] });
      let errorText = "";
      child.stderr.on("data", (chunk: Buffer) => { errorText = `${errorText}${chunk}`.slice(0, 128); });
      let killedForMemory = false;
      const memoryCheck = setInterval(() => {
        if (!child.pid) return;
        try {
          const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)],
            { encoding: "utf8", timeout: 500 }).trim());
          if (rss > maxRssKb) { killedForMemory = true; child.kill("SIGKILL"); }
        } catch { /* Process already exited. */ }
      }, 50);
      const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.once("error", (error) => { clearTimeout(timeout); clearInterval(memoryCheck); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timeout); clearInterval(memoryCheck);
        if (code === 0) resolve();
        else reject(new Error(killedForMemory ? "MEDIA_MEMORY_LIMIT" : errorText.trim() || "MEDIA_DECODE_TIMEOUT"));
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
