import { afterEach, expect, test } from "vitest";
import sharp from "sharp";
import { decodeMedia } from "../../src/modules/media/decode";
import { defaultRssKb, rssProbe } from "../../src/modules/media/rss";

const realProbe = rssProbe.read;
const realTmp = process.env.TMPDIR;
afterEach(() => {
  rssProbe.read = realProbe;
  if (realTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = realTmp;
});

async function slowImage() {
  const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#808080",
    noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
  return sharp(small).resize(9_000, 9_000, { kernel: "nearest" }).png({ compressionLevel: 9 }).toBuffer();
}

test("the real RSS probe measures the current process (procfs or ps)", async () => {
  expect(await defaultRssKb(process.pid)).toBeGreaterThan(10_000);
  expect(await defaultRssKb(2 ** 22 + 12_345)).toBeNull();
});

test("no RSS measurement refuses to decode instead of running without the limit", async () => {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).png().toBuffer();
  rssProbe.read = async () => null;
  await expect(decodeMedia(bytes)).rejects.toThrow("MEDIA_DECODER_UNAVAILABLE");
});

test("measurement that fails while the decoder runs kills it and is non-final", async () => {
  const bytes = await slowImage();
  let calls = 0;
  rssProbe.read = async () => (calls++ === 0 ? 1_000 : null);
  await expect(decodeMedia(bytes)).rejects.toThrow("MEDIA_DECODER_UNAVAILABLE");
}, 60_000);

test("a decoder killed by a foreign signal (OOM-killer) is an environment error, not a verdict on the image", async () => {
  const bytes = await slowImage();
  let calls = 0;
  rssProbe.read = async (pid) => { if (calls++ > 0) process.kill(pid, "SIGKILL"); return 1_000; };
  await expect(decodeMedia(bytes)).rejects.toThrow("MEDIA_DECODER_UNAVAILABLE");
}, 60_000);

test("an over-limit RSS is still the deterministic MEDIA_MEMORY_LIMIT", async () => {
  const bytes = await slowImage();
  let calls = 0;
  rssProbe.read = async () => (calls++ === 0 ? 1_000 : 3 * 1024 * 1024);
  await expect(decodeMedia(bytes)).rejects.toThrow("MEDIA_MEMORY_LIMIT");
}, 60_000);

test("I/O failure of the temp directory (e.g. ENOSPC) is retryable", async () => {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).png().toBuffer();
  process.env.TMPDIR = "/nonexistent-auterva-tmp";
  await expect(decodeMedia(bytes)).rejects.toThrow("MEDIA_DECODER_UNAVAILABLE");
});

test.each(["jpeg", "png", "webp"] as const)("isolated decoder accepts real %s pixels and creates bounded webp variants", async (format) => {
  const bytes = await sharp({ create: { width: 2400, height: 1600, channels: 3,
    background: "#246abc" } }).toFormat(format).toBuffer();
  const result = await decodeMedia(bytes);
  expect(result.mime).toBe(format === "jpeg" ? "image/jpeg" : `image/${format}`);
  expect(result).toMatchObject({ width: 2400, height: 1600 });
  expect((await sharp(result.large).metadata()).width).toBe(1600);
  expect((await sharp(result.thumb).metadata()).width).toBe(480);
});

test("isolated decoder rejects SVG, corrupt bytes and an extra pixel dimension", async () => {
  await expect(decodeMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))
    .rejects.toThrow("MEDIA_UNSUPPORTED_TYPE");
  await expect(decodeMedia(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])))
    .rejects.toThrow();
  const oversized = await sharp({ create: { width: 12_001, height: 1, channels: 3,
    background: "#000000" } }).png().toBuffer();
  await expect(decodeMedia(oversized)).rejects.toThrow("MEDIA_INVALID_IMAGE");
});

// D-04 bound: 12 000 x 12 000 must decode (files under 10 MB; block pattern keeps them compressible).
async function bound(format: "jpeg-baseline" | "jpeg-progressive" | "png16-interlaced" | "png-interlaced" | "png" | "webp") {
  const small = await sharp({ create: { width: format === "png16-interlaced" ? 40 : 200,
    height: format === "png16-interlaced" ? 40 : 200, channels: format === "png16-interlaced" ? 4 : 3,
    background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
  const image = sharp(small).resize(12_000, 12_000, { kernel: "nearest" });
  const bytes = format === "png16-interlaced"
    ? await image.toColourspace("rgb16").png({ progressive: true, compressionLevel: 9 }).toBuffer() : format === "jpeg-baseline" ? await image.jpeg({ quality: 70 }).toBuffer()
    : format === "jpeg-progressive" ? await image.jpeg({ quality: 70, progressive: true }).toBuffer()
    : format === "png-interlaced" ? await image.png({ progressive: true, compressionLevel: 9 }).toBuffer()
    : format === "png" ? await image.png({ compressionLevel: 9 }).toBuffer()
    : await image.webp({ quality: 40, effort: 2 }).toBuffer();
  expect(bytes.length).toBeLessThanOrEqual(10_000_000);
  return bytes;
}

test.each(["jpeg-baseline", "jpeg-progressive", "png16-interlaced", "png-interlaced", "png", "webp"] as const)(
  "isolated decoder accepts a 12 000 x 12 000 %s image", async (format) => {
    const result = await decodeMedia(await bound(format));
    expect(result).toMatchObject({ width: 12_000, height: 12_000 });
    expect((await sharp(result.large).metadata()).width).toBe(1600);
  }, 120_000);

test("stored dimensions follow EXIF orientation, like the rotated variants", async () => {
  const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#cc6633" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await decodeMedia(bytes);
  expect(result).toMatchObject({ width: 400, height: 600 });
  expect(await sharp(result.large).metadata()).toMatchObject({ width: 400, height: 600 });
});
