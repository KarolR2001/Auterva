import { afterEach, describe, expect, it, vi } from "vitest";

import { sendImage } from "../../src/components/media/upload-core";

class FakeXhr {
  static next: { status: number; text: string; retryAfter?: string };
  upload: Record<string, unknown> = {};
  withCredentials = false;
  responseText = "";
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  getResponseHeader() { return FakeXhr.next.retryAfter ?? null; }
  send() { this.status = FakeXhr.next.status; this.responseText = FakeXhr.next.text; this.onload?.(); }
}

afterEach(() => vi.unstubAllGlobals());

async function answer(status: number, text: string, retryAfter?: string) {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  FakeXhr.next = { status, text, retryAfter };
  return sendImage({ url: "/x", file: new File(["a"], "a.jpg", { type: "image/jpeg" }), key: "k" });
}

describe("sendImage: 503 (#307)", () => {
  it("503 MEDIA_BUSY i MEDIA_DECODER_UNAVAILABLE to odrzucenie sprzed zapisu", async () => {
    expect(await answer(503, JSON.stringify({ code: "MEDIA_BUSY" }), "5")).toEqual({ kind: "rejected", status: 503, code: "MEDIA_BUSY", retryAfter: 5 });
    expect(await answer(503, JSON.stringify({ code: "MEDIA_DECODER_UNAVAILABLE" }))).toMatchObject({ kind: "rejected", code: "MEDIA_DECODER_UNAVAILABLE" });
  });

  it("503 bez kodu, z innym kodem lub nie-JSON to wynik niepewny", async () => {
    expect(await answer(503, "")).toEqual({ kind: "uncertain", status: 503 });
    expect(await answer(503, "<html>Bad gateway</html>")).toEqual({ kind: "uncertain", status: 503 });
    expect(await answer(503, JSON.stringify({ code: "OTHER" }))).toEqual({ kind: "uncertain", status: 503 });
  });

  it("pozostałe 5xx nadal niepewne, a 4xx odrzucone", async () => {
    expect(await answer(500, "")).toEqual({ kind: "uncertain", status: 500 });
    expect(await answer(409, JSON.stringify({ code: "MEDIA_UPLOAD_REJECTED" }))).toMatchObject({ kind: "rejected", status: 409 });
  });
});
