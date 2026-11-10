import { describe, expect, it } from "vitest";
import { actionLabels, auditQuery, emptyAuditFilters, entityLabels, summarize, warsawDayStartUtc } from "@/modules/audit/view";
import { auditReadActions, auditReadEntityTypes } from "@/modules/audit/read";
import { formatAuditTime } from "@/components/audit/audit-log";

describe("audit view (ADM-17)", () => {
  it("every label key is accepted by the API and every API action has a label", () => {
    for (const key of Object.keys(actionLabels)) expect(auditReadActions).toContain(key);
    for (const key of Object.keys(entityLabels)) expect(auditReadEntityTypes).toContain(key);
    for (const action of auditReadActions) expect(actionLabels).toHaveProperty(action);
    for (const type of auditReadEntityTypes) expect(entityLabels).toHaveProperty(type);
  });
  it("shows UTC instants in Warsaw local time (summer and winter)", () => {
    expect(formatAuditTime("2026-07-15T10:30:00.000Z")).toBe("15.07.2026, 12:30:00");
    expect(formatAuditTime("2026-01-15T10:30:00.000Z")).toBe("15.01.2026, 11:30:00");
  });
  it("turns Warsaw days into UTC bounds, including the DST change days", () => {
    expect(warsawDayStartUtc("2026-07-15")).toBe("2026-07-14T22:00:00.000Z");
    expect(warsawDayStartUtc("2026-01-15")).toBe("2026-01-14T23:00:00.000Z");
    expect(warsawDayStartUtc("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
    expect(warsawDayStartUtc("2026-03-30")).toBe("2026-03-29T22:00:00.000Z");
    expect(warsawDayStartUtc("2026-02-30")).toBeNull();
  });
  it("builds the query: inclusive end day, cursor, no company key, invalid range refused", () => {
    const ok = auditQuery({ ...emptyAuditFilters, fromDay: "2026-07-15", toDay: "2026-07-15", action: "AUTH_LOGOUT" }, "abc");
    expect(ok).toEqual({ query: "limit=30&from=2026-07-14T22%3A00%3A00.000Z&to=2026-07-15T22%3A00%3A00.000Z&action=AUTH_LOGOUT&cursor=abc" });
    expect(auditQuery({ ...emptyAuditFilters, fromDay: "2026-07-16", toDay: "2026-07-15" }, null)).toHaveProperty("error");
    expect("query" in auditQuery(emptyAuditFilters, null) && auditQuery(emptyAuditFilters, null)).toEqual({ query: "limit=30" });
  });
  it("summarizes filters with names, not ids", () => {
    expect(summarize({ ...emptyAuditFilters, actorRole: "SUPERADMIN_AUTERVA", entityType: "Vehicle" })).toBe("Superadmin Autervy • Pojazd");
  });
});
