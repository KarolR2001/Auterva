import { randomUUID } from "node:crypto";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #411: the gap-refetch error alert is pinned above the composer, so on a phone it is visible without scrolling the list.
for (const width of [320, 390]) {
  test(`czat: alert błędu dociągania luki jest widoczny bez przewijania przy ${width} px`, async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("Missing trusted ingress URL");
    await page.setViewportSize({ width, height: 700 });
    const db = createPrismaClient(process.env.DATABASE_URL ?? "");
    const port = new URL(baseURL).port;
    const tag = randomUUID().slice(0, 8);
    const org = randomUUID();
    const user = randomUUID();
    const host = `chat-alert-${tag}.example.test`;
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
      session = await verifiedFixtureSession(db, user);

      await page.routeWebSocket(/\/ws\?/, (route) => { sockets.push({ url: new URL(route.url()), route }); });
      const origin = `http://${host}:${port}`;
      const [name, ...rest] = session.cookie.split("=");
      await context.addCookies([{ name, value: rest.join("="), url: origin }]);
      await page.goto(`${origin}/admin/czat/`);
      await expect(page.getByText("wiadomość 40", { exact: true })).toBeVisible();
      await expect.poll(() => sockets.length).toBe(1);
      const state = { ownMessageId: null, ownSeq: 0, peerMessageId: null, peerSeq: 0, unread: 0 };
      const ready = (route: WebSocketRoute, backlog: string) => route.send(JSON.stringify({ type: "ready", protocol: 1, role: "ADMIN_FIRMY",
        conversationId: conversation.id, cursor: "head", backlog, state }));
      ready(sockets[0].route, "none");

      // The gap fetch fails: the history after the own cursor answers 503.
      await page.route(/\/messages\/\?.*after=/, (route) => route.fulfill({ status: 503, body: "" }));
      await sockets[0].route.close({ code: 4503, reason: "SHUTDOWN" });
      await expect.poll(() => sockets.length, { timeout: 10_000 }).toBe(2);
      ready(sockets[1].route, "refetch");

      const alert = page.getByTestId("chat-gap-alert");
      await expect(alert).toContainText("Nie udało się wczytać wiadomości z czasu rozłączenia.");
      // Visible in the viewport right away, with the retry action, without scrolling anything, above the composer.
      await expect(alert).toBeInViewport({ ratio: 1 });
      const retry = alert.getByRole("button", { name: "Spróbuj ponownie" });
      await expect(retry).toBeInViewport({ ratio: 1 });
      const composer = page.getByLabel(/Napisz wiadomość do/);
      const [alertBox, composerBox] = await Promise.all([alert.boundingBox(), composer.boundingBox()]);
      expect(alertBox && composerBox && alertBox.y + alertBox.height <= composerBox.y).toBe(true);
      await expect(composer).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Keyboard: the retry action is a normal button and recovers the gap.
      await page.unroute(/\/messages\/\?.*after=/);
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect(alert).toHaveCount(0);
    } finally {
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
