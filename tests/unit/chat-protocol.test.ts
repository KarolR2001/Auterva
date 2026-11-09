// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  appendMessages, classifySend, isSessionLoss, parseFrame, prependMessages, readOwnIds, reconnectDelay, type ChatMessage,
} from "../../src/components/chat/chat-protocol";
import { clearAllDrafts, draftKey, loadDraft, saveDraft } from "../../src/components/chat/draft-store";

const msg = (id: string, own: boolean): ChatMessage => ({ id, clientMessageId: own ? `c-${id}` : null, body: id,
  senderRole: own ? "ADMIN_FIRMY" : "SUPERADMIN_AUTERVA", own, createdAt: "2026-11-09T10:00:00Z" });

describe("protokół czatu po stronie klienta (#52)", () => {
  it("deduplikuje po id i zachowuje kolejność", () => {
    const base = [msg("1", true), msg("2", false)];
    expect(appendMessages(base, [msg("2", false)])).toBe(base);
    expect(appendMessages(base, [msg("2", false), msg("3", true)]).map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(prependMessages(base, [msg("0", false), msg("1", true)]).map((m) => m.id)).toEqual(["0", "1", "2"]);
  });
  it("status 'przeczytano' obejmuje tylko własne wiadomości do wskazanej włącznie", () => {
    const list = [msg("1", true), msg("2", false), msg("3", true), msg("4", true)];
    expect([...readOwnIds(list, "3")]).toEqual(["1", "3"]);
    expect(readOwnIds(list, null).size).toBe(0);
    expect(readOwnIds(list, "nieznana").size).toBe(0);
  });
  it("ignoruje ramki spoza kontraktu", () => {
    expect(parseFrame("nie json")).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "dziwna" }))).toBeNull();
    expect(parseFrame(new ArrayBuffer(1))).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "typing", conversationId: "c", senderRole: "x", active: true }))?.type).toBe("typing");
  });
  it("opóźnienie ponowienia rośnie wykładniczo do 30 s, 4401 kończy próby", () => {
    expect(reconnectDelay(0, 0)).toBe(1000);
    expect(reconnectDelay(3, 0)).toBe(8000);
    expect(reconnectDelay(20, 0)).toBe(30000);
    expect(reconnectDelay(20, 1)).toBeLessThanOrEqual(37500);
    expect(isSessionLoss(4401)).toBe(true);
    expect(isSessionLoss(1006)).toBe(false);
    expect(isSessionLoss(4503)).toBe(false);
  });
  it("tylko 5xx i brak odpowiedzi są niepewne", () => {
    expect(classifySend(null, null, null).kind).toBe("uncertain");
    expect(classifySend(502, null, null).kind).toBe("uncertain");
    expect(classifySend(400, "INVALID_MESSAGE", null).kind).toBe("failed");
    expect(classifySend(422, "MESSAGE_TOO_LONG", null).message).toMatch(/4 000/);
    expect(classifySend(429, "RATE_LIMITED", "12").retryAfter).toBe(12);
  });
});

describe("szkic czatu (D-08)", () => {
  beforeEach(() => window.localStorage.clear());
  it("jest osobny dla konta i rozmowy i nie przechodzi do innych", () => {
    saveDraft("konto-a", "rozmowa-1", "tekst A");
    expect(loadDraft("konto-a", "rozmowa-1")).toBe("tekst A");
    expect(loadDraft("konto-b", "rozmowa-1")).toBe("");
    expect(loadDraft("konto-a", "rozmowa-2")).toBe("");
    expect(draftKey("a", "b")).toBe("auterva:chat-draft:a:b");
  });
  it("pusty szkic jest usuwany, a wylogowanie czyści wszystkie szkice i nic innego", () => {
    saveDraft("a", "1", "x");
    saveDraft("b", "2", "y");
    window.localStorage.setItem("inne", "zostaje");
    saveDraft("a", "1", "");
    expect(window.localStorage.getItem(draftKey("a", "1"))).toBeNull();
    clearAllDrafts();
    expect(loadDraft("b", "2")).toBe("");
    expect(window.localStorage.getItem("inne")).toBe("zostaje");
  });
  it("niedostępny storage nie rzuca", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    try {
      expect(() => { saveDraft("a", "1", "x"); loadDraft("a", "1"); clearAllDrafts(); }).not.toThrow();
    } finally { Object.defineProperty(window, "localStorage", original); }
  });
});
