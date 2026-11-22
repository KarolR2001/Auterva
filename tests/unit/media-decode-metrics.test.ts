import { afterEach, expect, test } from "vitest";
import { decodeMedia } from "../../src/modules/media/decode";
import { rssProbe } from "../../src/modules/media/rss";
import { metrics, names } from "../../src/modules/observability/metrics";

const original = rssProbe.read;
afterEach(() => { rssProbe.read = original; });

test("decode outcomes are counted by closed result label, series exist at 0 before the first failure", async () => {
  expect(metrics.value(names.mediaDecodes, { result: "unavailable" })).toBe(0);
  expect(metrics.render()).toContain('auterva_media_decodes_total{result="busy"} 0');
  rssProbe.read = async () => null; // fail-closed: no RSS measurement
  await expect(decodeMedia(Buffer.from([1, 2, 3]))).rejects.toThrow("MEDIA_DECODER_UNAVAILABLE");
  expect(metrics.value(names.mediaDecodes, { result: "unavailable" })).toBe(1);
  await expect(decodeMedia(Buffer.alloc(0))).rejects.toThrow("MEDIA_INVALID_SIZE");
  expect(metrics.value(names.mediaDecodes, { result: "invalid" })).toBe(1);
  expect(metrics.render()).not.toMatch(/auterva_media_decodes_total\{[^}]*MEDIA_/);
});
