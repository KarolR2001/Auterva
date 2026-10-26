import { expect, test } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/modules/chat/cursor";
import { ChatError } from "../../src/modules/chat/errors";
import { countCodePoints, normalizeChatBody } from "../../src/modules/chat/text";

const code = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof ChatError ? error.code : "other"; } return "none"; };

test("4 000 code points pass and 4 001 are refused, counted after NFC and for astral characters", () => {
  expect(normalizeChatBody("a".repeat(4000))).toHaveLength(4000);
  expect(code(() => normalizeChatBody("a".repeat(4001)))).toBe("MESSAGE_TOO_LONG");
  const emoji = "😀".repeat(4000); // 8 000 UTF-16 units, 4 000 code points
  expect(countCodePoints(emoji)).toBe(4000);
  expect(normalizeChatBody(emoji)).toBe(emoji);
  expect(code(() => normalizeChatBody(`${emoji}😀`))).toBe("MESSAGE_TOO_LONG");
  // e + combining acute is two code points raw, one after NFC: 4 000 of them fit.
  expect(normalizeChatBody("é".repeat(4000))).toBe("é".repeat(4000));
});

test("raw text is kept (no HTML escaping), line breaks are normalised, controls and NUL are refused", () => {
  expect(normalizeChatBody("<script>alert(1)</script> & <b>x</b>")).toBe("<script>alert(1)</script> & <b>x</b>");
  expect(normalizeChatBody("a\r\nb\rc\td")).toBe("a\nb\nc\td");
  for (const bad of ["a\u0000b", "a\u0007b", "a\u001bb", "a\u0085b", "\ud800", "x\udc00y"]) {
    expect(code(() => normalizeChatBody(bad))).toBe("CHAT_INVALID_MESSAGE");
  }
  for (const empty of ["", "   ", "\n\t"]) expect(code(() => normalizeChatBody(empty))).toBe("CHAT_INVALID_MESSAGE");
  for (const notText of [null, 5, {}, undefined]) expect(code(() => normalizeChatBody(notText))).toBe("CHAT_INVALID_INPUT");
});

test("cursors are opaque, signed and bound to their listing", () => {
  process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const cursor = encodeCursor({ kind: "msg", conversationId, seq: 12 });
  expect(cursor).not.toContain("12.");
  expect(decodeCursor(cursor)).toEqual({ kind: "msg", conversationId, seq: 12 });
  const [payload, signature] = cursor.split(".");
  const forged = `${Buffer.from(`m|${conversationId}|13`).toString("base64url")}.${signature}`;
  expect(payload).toBeTruthy();
  for (const bad of [forged, "", "abc", `${cursor}.x`, cursor.slice(0, -2)]) expect(code(() => decodeCursor(bad))).toBe("CHAT_INVALID_CURSOR");
  const conv = encodeCursor({ kind: "conv", at: "2026-10-27T10:00:00.000Z", id: conversationId });
  expect(decodeCursor(conv)).toMatchObject({ kind: "conv", id: conversationId });
});
