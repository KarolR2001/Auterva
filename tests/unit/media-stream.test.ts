import { expect, test } from "vitest";
import { maxImageBytes } from "../../src/modules/media/storage";
import { readUploadBody } from "../../src/modules/media/stream";

function streamed(chunks: Uint8Array[], signal?: AbortSignal) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  });
  return new Request("https://media.example.test/upload", { method: "POST", body, signal,
    duplex: "half" } as RequestInit & { duplex: string });
}

test("chunked exact 10 MB passes and one extra byte is rejected before storage", async () => {
  const full = Buffer.alloc(maxImageBytes, 0x42);
  expect((await readUploadBody(streamed([full.subarray(0, 4_000_000), full.subarray(4_000_000)]))).length)
    .toBe(maxImageBytes);
  await expect(readUploadBody(streamed([full, Buffer.from([1])]))).rejects.toThrow("MEDIA_INVALID_SIZE");
});

test("aborted pending stream stops promptly", async () => {
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ pull() { /* deliberately stalled */ } },
    { highWaterMark: 0 });
  const request = new Request("https://media.example.test/upload", { method: "POST", body,
    signal: controller.signal, duplex: "half" } as RequestInit & { duplex: string });
  const reading = readUploadBody(request);
  setTimeout(() => controller.abort(), 20);
  await expect(Promise.race([
    reading,
    new Promise((_, reject) => setTimeout(() => reject(new Error("not aborted promptly")), 500)),
  ])).rejects.toThrow("MEDIA_UPLOAD_ABORTED");
});
