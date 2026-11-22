import { randomUUID } from "node:crypto";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

// #411: the gap-refetch error notice is pinned above the history, so on a phone it is visible without scrolling anything.
const variants = [
  { who: "admin firmy", superadmin: false, width: 320, height: 640 }, { who: "admin firmy", superadmin: false, width: 390, height: 700 },
  { who: "superadmin", superadmin: true, width: 320, height: 640 }, { who: "superadmin", superadmin: true, width: 390, height: 700 },
];
for (const { who, superadmin, width, height } of variants) {
  test(`czat (${who}): alert błędu dociągania luki jest widoczny bez przewijania przy ${width}x${height}`, async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("Missing trusted ingress URL");
    await page.setViewportSize({ width, height });
    const db = createPrismaClient(process.env.DATABASE_URL ?? "");
    const port = new URL(baseURL).port;
    const tag = randomUUID().slice(0, 8);
    const org = randomUUID();
    const user = randomUUID();
    const host = `chat-alert-${tag}.example.test`;
    const platformHost = `chat-alert-platform-${tag}.example.test`;
    let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
    const sockets: { url: URL; route: WebSocketRoute }[] = [];
    const at = (seq: number) => new Date(Date.UTC(2026, 10, 9, 8, 0, seq));
    const rows = (from: number, to: number, conversationId: string) => Array.from({ length: to - from + 1 }, (_, index) => {
      const seq = from + index;
      return { organizationId: org, conversationId, senderId: user, clientMessageId: randomUUID(), seq, body: `wiadomość ${seq}`, createdAt: at(seq) };
    });
    try {
      await db.organization.create({ data: { id: org, slug: `chat-alert-${tag}`, name: `Czat alert ${tag}`, firstAdminRegisteredAt: new Date() } });
      await db.user.create({ data: { id: user, name: "Czat alert", email: `chat-alert-${tag}@example.test`, role: "ADMIN_FIRMY",
        organizationId: org, emailVerified: true, twoFactorEnabled: true } });
      await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" } });
      const conversation = await db.conversation.create({ data: { organizationId: org, lastSeq: 40, activityAt: at(40) } });
      await db.chatMessage.createMany({ data: rows(1, 40, conversation.id) });
      if (superadmin) {
        await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
        await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
        await resetPlatformApiBudget(db, FIXTURE.users[2]);
        session = await verifiedFixtureSession(db, FIXTURE.users[2]);
      } else session = await verifiedFixtureSession(db, user);

      await page.routeWebSocket(/\/ws\?/, (route) => { sockets.push({ url: new URL(route.url()), route }); });
      const origin = `http://${superadmin ? platformHost : host}:${port}`;
      const [name, ...rest] = session.cookie.split("=");
      await context.addCookies([{ name, value: rest.join("="), url: origin }]);
      await page.goto(superadmin ? `${origin}/wiadomosci/?firma=${org}` : `${origin}/admin/czat/`);
      await expect(page.getByRole("log", { name: "Historia rozmowy" }).getByText("wiadomość 40", { exact: true })).toBeVisible();
      await expect.poll(() => sockets.length).toBe(1);
      const state = { ownMessageId: null, ownSeq: 0, peerMessageId: null, peerSeq: 0, unread: 0 };
      // The first connection resumes from the client's own cursor (real HTTP history); later the server answers with its head.
      const own = sockets[0].url.searchParams.get("after");
      const ready = (route: WebSocketRoute, backlog: string, cursor: string | null) => route.send(JSON.stringify({ type: "ready", protocol: 1, role: superadmin ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY",
        conversationId: conversation.id, cursor, backlog, state }));
      ready(sockets[0].route, "none", own);
      await expect(page.getByText("Łączenie…")).toHaveCount(0);

      // The gap fetch fails: the history after the own cursor answers 503.
      await page.route(/\/messages\/\?.*after=/, (route) => route.fulfill({ status: 503, body: "" }));
      // Two messages arrive while the client is away: the gap the retry has to fill.
      await db.chatMessage.createMany({ data: rows(41, 42, conversation.id) });
      await db.conversation.update({ where: { id: conversation.id }, data: { lastSeq: 42, activityAt: at(42) } });
      await sockets[0].route.close({ code: 4503, reason: "SHUTDOWN" });
      await expect.poll(() => sockets.length, { timeout: 10_000 }).toBe(2);
      ready(sockets[1].route, "refetch", "head-of-the-conversation");

      const alert = page.getByTestId("chat-gap-alert");
      await expect(alert).toContainText("Nie udało się wczytać wiadomości z czasu rozłączenia.");
      // Visible right away with the retry action: nothing was scrolled, both are fully in the viewport and not under the
      // fixed bottom navigation (hit-tested at the centre, which toBeInViewport does not cover).
      const uncovered = (selector: string) => page.evaluate((css) => {
        const element = document.querySelector(css);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !!top && (top === element || element.contains(top));
      }, selector);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(alert).toBeInViewport({ ratio: 1 });
      const retry = alert.getByRole("button", { name: "Spróbuj ponownie" });
      await expect(retry).toBeInViewport({ ratio: 1 });
      expect(await uncovered("[data-testid=chat-gap-alert] button")).toBe(true);
      // Order: notice, history, composer. The history keeps its floor (64 px) and still scrolls; the message field stays
      // visible and usable at these sizes.
      const history = page.getByRole("log", { name: "Historia rozmowy" });
      const composer = page.getByLabel(/Napisz wiadomość do/);
      const [alertBox, listBox, composerBox] = await Promise.all([alert.boundingBox(), history.boundingBox(), composer.boundingBox()]);
      expect(alertBox && listBox && composerBox && alertBox.y + alertBox.height <= listBox.y && listBox.y + listBox.height <= composerBox.y).toBe(true);
      expect(listBox && listBox.height >= 64).toBe(true);
      expect(await history.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await expect(composer).toBeInViewport({ ratio: 1 });
      expect(await uncovered("#chat-composer")).toBe(true);
      // The notice has no role of its own (one announcement, in the status region) and nothing overflows sideways.
      await expect(alert.getByRole("alert")).toHaveCount(0);
      await expect(page.locator("[role=alert]", { hasText: "z czasu rozłączenia" })).toHaveCount(0);
      await expect(page.locator("[role=status]", { hasText: "Nie udało się wczytać wiadomości z czasu rozłączenia." })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The send button is reachable by scrolling the page: it ends above the fixed bottom navigation.
      const send = page.getByRole("button", { name: "Wyślij" });
      await send.scrollIntoViewIfNeeded();
      expect(await uncovered("form button[type=submit]")).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));

      // Keyboard: the retry action is a normal button right before the history in the tab order, with the token focus ring;
      // it fills the gap from the real history, the notice goes away, the result is announced once and the draft stays.
      await composer.fill("szkic 411");
      await page.unroute(/\/messages\/\?.*after=/);
      await history.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(retry).toBeFocused();
      expect(await retry.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
      await page.keyboard.press("Enter");
      await expect(history.getByText("wiadomość 42", { exact: true })).toBeVisible();
      await expect(alert).toHaveCount(0);
      await expect(page.locator("[role=status]", { hasText: "Uzupełniono wiadomości z czasu rozłączenia." })).toHaveCount(1);
      await expect(composer).toHaveValue("szkic 411");
    } finally {
      await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
      await session?.dispose();
      await db.chatMessage.deleteMany({ where: { organizationId: org } });
      await db.conversation.deleteMany({ where: { organizationId: org } });
      await db.user.deleteMany({ where: { id: user } });
      await db.hostMapping.deleteMany({ where: { organizationId: org } });
      await db.organization.deleteMany({ where: { id: org } });
      await db.$disconnect();
    }
  });
}
