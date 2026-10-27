import { EventEmitter } from "node:events";
import WebSocket from "ws";

export type Frame = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type OpenOptions = { cookie?: string; origin?: string; host?: string; after?: string; path?: string; query?: string };

function url(port: number, organizationId: string, options: OpenOptions) {
  const query = options.query ?? `organizationId=${organizationId}${options.after ? `&after=${encodeURIComponent(options.after)}` : ""}`;
  return `ws://127.0.0.1:${port}${options.path ?? "/ws"}?${query}`;
}

function headers(options: OpenOptions) {
  return { ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.origin ? { origin: options.origin } : {}),
    ...(options.host ? { host: options.host } : {}) };
}

/** HTTP status of a refused handshake (never an open socket). */
export function refusedStatus(port: number, organizationId: string, options: OpenOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(port, organizationId, options), { headers: headers(options) });
    ws.on("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); ws.terminate(); });
    ws.on("open", () => { ws.terminate(); reject(new Error("Handshake was accepted")); });
    ws.on("error", () => undefined);
  });
}

/** Test client that keeps every frame so ordering and absence can be asserted. */
export class TestSocket {
  readonly frames: Frame[] = [];
  closeCode: number | null = null;
  readonly closed: Promise<number>;
  private readCount = 0;
  private readonly events = new EventEmitter();

  private constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.once("close", (code) => { this.closeCode = code; this.events.emit("frame"); resolve(code); }));
    ws.on("message", (raw) => { this.frames.push(JSON.parse(raw.toString())); this.events.emit("frame"); });
    ws.on("error", () => undefined);
  }

  static async open(port: number, organizationId: string, options: OpenOptions) {
    const ws = new WebSocket(url(port, organizationId, options), { headers: headers(options) });
    const socket = new TestSocket(ws);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); ws.once("unexpected-response", (_r, response) => reject(new Error(`HTTP ${response.statusCode}`))); });
    return socket;
  }

  send(value: unknown) { this.ws.send(typeof value === "string" ? value : JSON.stringify(value)); }

  /** Next unread frame matching the predicate (earlier non-matching frames are skipped). */
  async take(predicate: (frame: Frame) => boolean, ms = 5_000): Promise<Frame> {
    const deadline = Date.now() + ms;
    for (;;) {
      for (let index = this.readCount; index < this.frames.length; index += 1) {
        if (predicate(this.frames[index])) { this.readCount = index + 1; return this.frames[index]; }
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`No matching frame; got ${JSON.stringify(this.frames.slice(this.readCount).map((f) => f.type))}`);
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, left); this.events.once("frame", () => { clearTimeout(timer); resolve(); }); });
    }
  }

  takeType(type: string, ms?: number) { return this.take((frame) => frame.type === type, ms); }

  /** All unread frames matching the predicate after waiting `ms`, consumed. */
  async drain(predicate: (frame: Frame) => boolean, ms: number): Promise<Frame[]> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    const matched = this.frames.slice(this.readCount).filter(predicate);
    this.readCount = this.frames.length;
    return matched;
  }

  async waitClose(ms = 5_000): Promise<number> {
    return Promise.race([this.closed, new Promise<number>((_, reject) => setTimeout(() => reject(new Error("Socket was not closed")), ms))]);
  }
}
