import { expect, test } from "vitest";
import sharp from "sharp";
import { decodeMedia } from "../../src/modules/media/decode";

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
