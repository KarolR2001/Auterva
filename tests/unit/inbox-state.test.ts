import { describe, expect, it } from "vitest";

import {
  applyFrame, compareKey, mergeRows, parsePlatformFrame, totalUnread, type ConversationFrame, type InboxRow,
} from "../../src/components/platform/inbox-state";

const row = (organizationId: string, extra: Partial<InboxRow> = {}): InboxRow => ({
  conversationId: `c-${organizationId}`, organizationId, organizationName: `Firma ${organizationId}`, archived: false,
  activityAt: "2026-11-09T10:00:00.000Z", lastSeq: 1, readSeq: 0, version: 1, unread: 1,
  lastMessage: { id: "m", senderRole: "ADMIN_FIRMY", createdAt: "2026-11-09T10:00:00.000Z", preview: "Cześć", truncated: false }, ...extra,
});
const frame = (organizationId: string, extra: Partial<ConversationFrame> = {}): ConversationFrame => ({
  organizationId, conversationId: `c-${organizationId}`, archived: false, unread: 1, lastSeq: 1, readSeq: 0, version: 1,
  activityAt: "2026-11-09T10:00:00.000Z", ...extra,
});

describe("skrzynka superadmina: reguły stanu (#53)", () => {
  it("klucz (version, lastSeq, readSeq) porównuje leksykograficznie, version pierwszy", () => {
    expect(compareKey({ version: 2, lastSeq: 0, readSeq: 0 }, { version: 1, lastSeq: 9, readSeq: 9 })).toBeGreaterThan(0);
    expect(compareKey({ version: 1, lastSeq: 3, readSeq: 0 }, { version: 1, lastSeq: 3, readSeq: 2 })).toBeLessThan(0);
    expect(compareKey({ version: 1, lastSeq: 3, readSeq: 2 }, { version: 1, lastSeq: 3, readSeq: 2 })).toBe(0);
  });

  it("spóźniona odpowiedź HTTP z unread:3 nie nadpisuje ramki z unread:0 po odczycie", () => {
    const afterRead = applyFrame([row("a", { lastSeq: 3, unread: 3 })], frame("a", { lastSeq: 3, readSeq: 3, unread: 0 }), false);
    expect(afterRead.rows[0].unread).toBe(0);
    const late = mergeRows(afterRead.rows, [row("a", { lastSeq: 3, readSeq: 0, unread: 3 })]);
    expect(late[0].unread).toBe(0);
  });

  it("restore firmy: wyższe version wygrywa mimo niższych lastSeq i readSeq", () => {
    const merged = mergeRows([row("a", { version: 1, lastSeq: 9, readSeq: 9, unread: 0 })], [row("a", { version: 2, lastSeq: 4, readSeq: 1, unread: 3 })]);
    expect(merged[0]).toMatchObject({ version: 2, unread: 3 });
  });

  it("spóźniona lista sprzed archiwizacji nie zdejmuje znacznika archiwum", () => {
    const archived = applyFrame([row("a")], frame("a", { archived: true, unread: 0, version: 2 }), true);
    expect(archived.rows[0].archived).toBe(true);
    expect(mergeRows(archived.rows, [row("a", { version: 1 })])[0].archived).toBe(true);
  });

  it("domyślna lista usuwa wiersz po ramce archived:true; nieznana firma każe odświeżyć listę", () => {
    expect(applyFrame([row("a")], frame("a", { archived: true, version: 2 }), false).rows).toHaveLength(0);
    expect(applyFrame([], frame("b"), false)).toMatchObject({ unknown: true });
    expect(applyFrame([], frame("b", { archived: true }), false)).toMatchObject({ unknown: false });
  });

  it("nowa wiadomość (większe lastSeq) wymaga odświeżenia podglądu, zmiana samego kursora nie", () => {
    expect(applyFrame([row("a")], frame("a", { lastSeq: 2 }), false).unknown).toBe(true);
    expect(applyFrame([row("a")], frame("a", { readSeq: 1, unread: 0 }), false).unknown).toBe(false);
  });

  it("kolejność wynika z activityAt, a archiwum nie liczy się do sumy nowych", () => {
    const merged = mergeRows([row("a", { activityAt: "2026-11-09T09:00:00.000Z" })], [row("b", { activityAt: "2026-11-09T11:00:00.000Z" })]);
    expect(merged.map((item) => item.organizationId)).toEqual(["b", "a"]);
    expect(totalUnread([row("a", { unread: 2 }), row("b", { unread: 5, archived: true })])).toBe(2);
  });

  it("parsuje tylko znane ramki kanału platformy", () => {
    expect(parsePlatformFrame(JSON.stringify({ type: "ready", protocol: 1, scope: "platform" }))).toEqual({ type: "ready" });
    expect(parsePlatformFrame(JSON.stringify({ type: "refresh" }))).toEqual({ type: "refresh" });
    expect(parsePlatformFrame(JSON.stringify({ type: "conversation", ...frame("a") }))).toMatchObject({ type: "conversation" });
    expect(parsePlatformFrame(JSON.stringify({ type: "conversation", organizationId: "a" }))).toBeNull();
    expect(parsePlatformFrame("nie json")).toBeNull();
    expect(parsePlatformFrame(JSON.stringify({ type: "message" }))).toBeNull();
  });
});
