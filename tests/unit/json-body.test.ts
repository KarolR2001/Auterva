import { expect, test } from "vitest";
import { bodyExceeds, readJsonBody, readJsonObject } from "../../src/modules/tenancy/json-body";

const json = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://x.test/", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
const chunked = (parts: string[]) => new ReadableStream<Uint8Array>({ start(controller) {
  for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });

test("a body at the limit parses and one byte more is refused, declared or streamed", async () => {
  const pad = (size: number) => `{"a":1}${" ".repeat(size - 7)}`;
  expect(await readJsonBody(json(pad(100)), 100)).toEqual({ a: 1 });
  expect(await readJsonBody(json(pad(101)), 100)).toBeUndefined();
  // A declared length above the limit is refused before the body is read.
  expect(await readJsonBody(json("{}", { "content-length": "101" }), 100)).toBeUndefined();
  expect(await readJsonBody(json("{}", { "content-length": "-1" }), 100)).toBeUndefined();
  expect(await readJsonBody(json("{}", { "content-length": "1e3" }), 100)).toBeUndefined();
  // No declared length (chunked): counted while it streams, never buffered whole.
  const streamed = new Request("http://x.test/", { method: "POST", body: chunked(["{\"a\":", "1", " ".repeat(200), "}"]),
    headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  expect(await readJsonBody(streamed, 100)).toBeUndefined();
});

test("wrong content type, invalid UTF-8, invalid JSON and non-objects are all the same refusal", async () => {
  expect(await readJsonBody(new Request("http://x.test/", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }))).toBeUndefined();
  expect(await readJsonBody(new Request("http://x.test/", { method: "POST", body: "{}" }))).toBeUndefined();
  expect(await readJsonBody(json(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])))).toBeUndefined();
  expect(await readJsonBody(json("{not json"))).toBeUndefined();
  expect(await readJsonObject(json("[1]"))).toBeNull();
  expect(await readJsonObject(json("null"))).toBeNull();
  expect(await readJsonObject(json("7"))).toBeNull();
  expect(await readJsonObject(json('{"ok":true}'))).toEqual({ ok: true });
  expect(await readJsonBody(new Request("http://x.test/", { method: "POST", headers: { "content-type": "Application/JSON; charset=utf-8" }, body: "{}" }))).toEqual({});
});

test("bodyExceeds inspects a clone and leaves the request readable", async () => {
  const request = json('{"a":1}');
  expect(await bodyExceeds(request, 100)).toBe(false);
  expect(await request.json()).toEqual({ a: 1 });
  expect(await bodyExceeds(json("x".repeat(101)), 100)).toBe(true);
});
