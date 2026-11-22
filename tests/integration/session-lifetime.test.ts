import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { auth, SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

// #414 (D-61): explicit 30-day sliding panel session, refreshed at most once per day. Controlled clock (Date only).
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const DAY = 86_400_000;
const T0 = new Date("2026-11-12T10:00:00.000Z");
const created: string[] = [];

async function newSession(userId: string) {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  created.push(session.id);
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(session.token).digest("base64");
  return { id: session.id, token: session.token,
    headers: new Headers({ cookie: `better-auth.session_token=${session.token}.${encodeURIComponent(signature)}` }) };
}
const read = async (headers: Headers) => auth.api.getSession({ headers, returnHeaders: true });
const expiry = async (id: string) => (await db.session.findUniqueOrThrow({ where: { id } })).expiresAt.getTime();

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.setSystemTime(T0); });
afterAll(async () => {
  vi.useRealTimers();
  await db.session.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

test("configuration is explicit: 30 days, refresh at most daily", () => {
  expect(SESSION_EXPIRES_IN_SECONDS).toBe(30 * 24 * 3600);
  expect(SESSION_UPDATE_AGE_SECONDS).toBe(24 * 3600);
});

for (const [role, userId] of [["admin firmy", FIXTURE.users[0]], ["superadmin", FIXTURE.users[2]]] as const) {
  test(`${role}: new session expires in exactly 30 days, valid before and gone after`, async () => {
    vi.setSystemTime(T0);
    const session = await newSession(userId);
    expect(await expiry(session.id)).toBe(T0.getTime() + 30 * DAY);

    vi.setSystemTime(new Date(T0.getTime() + 30 * DAY - 1_000));
    expect((await read(session.headers)).response?.session.id).toBe(session.id);
    // The read refreshed it; restore the original expiry to test the boundary after 30 days.
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(T0.getTime() + 30 * DAY) } });
    vi.setSystemTime(new Date(T0.getTime() + 30 * DAY + 1_000));
    expect((await read(session.headers)).response).toBeNull();
  });
}

test("no refresh within a day, refresh after a day extends 30 days and sets cookie Max-Age", async () => {
  vi.setSystemTime(T0);
  const session = await newSession(FIXTURE.users[0]);
  const before = await expiry(session.id);

  vi.setSystemTime(new Date(T0.getTime() + DAY - 60_000));
  const early = await read(session.headers);
  expect(early.response?.session.id).toBe(session.id);
  expect(await expiry(session.id)).toBe(before);
  expect(early.headers.get("set-cookie") ?? "").not.toContain("Max-Age=2592000");

  const later = new Date(T0.getTime() + DAY + 60_000);
  vi.setSystemTime(later);
  const refreshed = await read(session.headers);
  expect(refreshed.response?.session.id).toBe(session.id);
  expect(await expiry(session.id)).toBe(later.getTime() + 30 * DAY);
  const cookie = refreshed.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("better-auth.session_token=");
  expect(cookie).toContain("Max-Age=2592000");
  expect(cookie).toContain("HttpOnly");
});

test("a session idle past 30 days stays expired even though it would have been refreshable earlier", async () => {
  vi.setSystemTime(T0);
  const session = await newSession(FIXTURE.users[2]);
  vi.setSystemTime(new Date(T0.getTime() + 31 * DAY));
  expect((await read(session.headers)).response).toBeNull();
});
