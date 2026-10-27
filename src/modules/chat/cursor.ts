import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../../lib/env";
import { ChatError } from "./errors";

type Position = { kind: "msg"; conversationId: string; seq: number }
  | { kind: "conv"; at: string; id: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sign(payload: string) {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(`chat-cursor:${payload}`).digest("base64url");
}

/** Opaque, signed and bound to its listing: a client can neither forge a position nor reuse it elsewhere. */
export function encodeCursor(position: Position): string {
  const payload = position.kind === "msg"
    ? `m|${position.conversationId}|${position.seq}` : `c|${position.at}|${position.id}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function decodeCursor(value: string): Position {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra !== undefined || value.length > 300) throw new ChatError("CHAT_INVALID_CURSOR");
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ChatError("CHAT_INVALID_CURSOR");
  const parts = payload.split("|");
  if (parts[0] === "m" && parts.length === 3 && uuid.test(parts[1]) && /^[1-9]\d{0,9}$/.test(parts[2])) {
    return { kind: "msg", conversationId: parts[1], seq: Number(parts[2]) };
  }
  if (parts[0] === "c" && parts.length === 3 && uuid.test(parts[2])
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parts[1]) && !Number.isNaN(Date.parse(parts[1]))) {
    return { kind: "conv", at: parts[1], id: parts[2] };
  }
  throw new ChatError("CHAT_INVALID_CURSOR");
}
