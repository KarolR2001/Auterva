import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const [input, outputDir] = process.argv.slice(2);
if (!input || !outputDir) process.exit(2);
sharp.cache(false);
sharp.concurrency(1);

try {
  const bytes = await readFile(input);
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!jpeg && !png && !webp) throw new Error("MEDIA_UNSUPPORTED_TYPE");
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: 144_000_000,
    sequentialRead: true, animated: false });
  const meta = await image.metadata();
  const mime = meta.format === "jpeg" ? "image/jpeg" : meta.format === "png" ? "image/png"
    : meta.format === "webp" ? "image/webp" : null;
  if (!mime || !meta.width || !meta.height || meta.width > 12_000 || meta.height > 12_000
    || (meta.pages ?? 1) !== 1 || (meta.pageHeight && meta.pageHeight !== meta.height))
    throw new Error("MEDIA_INVALID_IMAGE");
  for (const [variant, width] of [["large", 1600], ["thumb", 480]]) {
    const transformed = await sharp(bytes, { failOn: "warning", limitInputPixels: 144_000_000,
      sequentialRead: true, animated: false }).rotate().resize({ width,
      withoutEnlargement: true, fit: "inside" }).webp({ quality: 82, effort: 4 }).toBuffer();
    await writeFile(`${outputDir}/${variant}.webp`, transformed, { mode: 0o600 });
  }
  await writeFile(`${outputDir}/result.json`, JSON.stringify({ mime, width: meta.width,
    height: meta.height }), { mode: 0o600 });
} catch (error) {
  const code = error instanceof Error && /^MEDIA_/.test(error.message) ? error.message : "MEDIA_DECODE_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
