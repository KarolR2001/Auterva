import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type WebSocketRoute } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

// #435: on a phone the conversation header of the superadmin inbox used to push the message field and "Wyślij" under the
// fixed bottom navigation while the page did not scroll. The company name has the form's limit of 120 characters.
const NAME = "Wypożyczalnia Samochodów Dostawczych i Osobowych Kowalski, Nowak i Wspólnicy Spółka z ograniczoną odpowiedzialnością Poł";
const variants = [
  { label: "320x568", width: 320, height: 568, phone: true },
  { label: "320x640", width: 320, height: 640, phone: true },
  { label: "390x700", width: 390, height: 700, phone: true },
  { label: "390x844", width: 390, height: 844, phone: true },
  // Browser zoom cannot be set from the test: 200% in a 1440x900 window is this viewport in CSS pixels.
  { label: "720x450 (zoom 200% okna 1440x900)", width: 720, height: 450, phone: false },
  // Split view (no bottom navigation): the gap-refetch notice must not push the composer out of the inbox box.
  // #452: tablet widths (768-1023 px) have no bottom navigation but still show one pane at a time.
  { label: "768x600", width: 768, height: 600, phone: false, tablet: true },
  { label: "1023x600", width: 1023, height: 600, phone: false, tablet: true },
  { label: "1024x768", width: 1024, height: 768, phone: false, split: true },
];

/** Where the element is and whether it is really on top there: the centre and both horizontal edges are hit-tested, so an
    element that only peeks out from under the fixed navigation does not pass. */
const exposure = (target: Locator) => target.evaluate((element) => {
  const box = element.getBoundingClientRect();
  const nav = document.querySelector('nav[aria-label="Nawigacja mobilna"]');
  const hit = (x: number, y: number) => { const top = document.elementFromPoint(x, y); return !!top && (top === element || element.contains(top)); };
  const x = box.left + box.width / 2;
  return {
    top: Math.round(box.top), bottom: Math.round(box.bottom), navTop: nav && nav.getClientRects().length > 0 ? Math.round(nav.getBoundingClientRect().top) : null,
    centre: hit(x, box.top + box.height / 2), upperEdge: hit(x, box.top + 1), lowerEdge: hit(x, box.bottom - 1),
  };
});
let navigationExpected = true;
async function expectClear(target: Locator, what: string) {
  const seen = await exposure(target);
  if (navigationExpected) expect(seen.navTop, "fixed bottom navigation").not.toBeNull();
  else expect(seen.navTop, "no bottom navigation from 768 px").toBeNull();
  expect.soft({ what, ...seen, aboveNavigation: seen.bottom <= (seen.navTop ?? Infinity), belowTop: seen.top >= 0 })
    .toMatchObject({ what, centre: true, upperEdge: true, lowerEdge: true, aboveNavigation: true, belowTop: true });
}

for (const { label, width, height, phone, split, tablet } of variants as { label: string; width: number; height: number; phone: boolean; split?: boolean; tablet?: boolean }[]) {
  test(`skrzynka superadmina ${label}, nazwa firmy 120 znaków: pole wiadomości i „Wyślij” osiągalne nad dolną nawigacją`, async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("Missing trusted ingress URL");
    navigationExpected = !tablet;
    expect([...NAME]).toHaveLength(120);
    await page.setViewportSize({ width, height });
    const db = createPrismaClient(process.env.DATABASE_URL ?? "");
    const port = new URL(baseURL).port;
    const tag = randomUUID().slice(0, 8);
    const org = randomUUID();
    const user = randomUUID();
    const platformHost = `inbox-narrow-platform-${tag}.example.test`;
    let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
    const sockets: { url: URL; route: WebSocketRoute }[] = [];
    const at = (seq: number) => new Date(Date.UTC(2026, 10, 9, 8, 0, seq));
    const rows = (from: number, to: number, conversationId: string) => Array.from({ length: to - from + 1 }, (_, index) => {
      const seq = from + index;
      return { organizationId: org, conversationId, senderId: user, clientMessageId: randomUUID(), seq, body: `wiadomość ${seq}`, createdAt: at(seq) };
    });
    try {
      await db.organization.create({ data: { id: org, slug: `inbox-narrow-${tag}`, name: NAME, firstAdminRegisteredAt: new Date() } });
      await db.user.create({ data: { id: user, name: "Inbox narrow", email: `inbox-narrow-${tag}@example.test`, role: "ADMIN_FIRMY",
        organizationId: org, emailVerified: true, twoFactorEnabled: true } });
      await db.hostMapping.create({ data: { hostname: `inbox-narrow-${tag}.example.test`, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" } });
      const conversation = await db.conversation.create({ data: { organizationId: org, lastSeq: 40, activityAt: at(40) } });
      await db.chatMessage.createMany({ data: rows(1, 40, conversation.id) });
      await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
      await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
      await resetPlatformApiBudget(db, FIXTURE.users[2]);
      session = await verifiedFixtureSession(db, FIXTURE.users[2]);

      await page.routeWebSocket(/\/ws\?/, (route) => { sockets.push({ url: new URL(route.url()), route }); });
      const origin = `http://${platformHost}:${port}`;
      const [cookie, ...rest] = session.cookie.split("=");
      await context.addCookies([{ name: cookie, value: rest.join("="), url: origin }]);
      await page.goto(`${origin}/wiadomosci/?firma=${org}`);
      const history = page.getByRole("log", { name: "Historia rozmowy" });
      await expect(history.getByText("wiadomość 40", { exact: true })).toBeVisible();
      await expect.poll(() => sockets.length).toBe(1);
      const state = { ownMessageId: null, ownSeq: 0, peerMessageId: null, peerSeq: 0, unread: 0 };
      const ready = (route: WebSocketRoute, backlog: string, cursor: string | null) => route.send(JSON.stringify({ type: "ready", protocol: 1,
        role: "SUPERADMIN_AUTERVA", conversationId: conversation.id, cursor, backlog, state }));
      ready(sockets[0].route, "none", sockets[0].url.searchParams.get("after"));
      await expect(page.getByText("Łączenie…")).toHaveCount(0);

      const pane = page.getByRole("region", { name: "Rozmowa", exact: true });
      const back = pane.getByRole("button", { name: "Wiadomości", exact: true });
      const heading = pane.getByRole("heading", { level: 2, name: NAME, exact: true });
      const card = pane.getByRole("link", { name: `Karta firmy ${NAME}`, exact: true });
      const composer = page.getByRole("textbox", { name: `Napisz wiadomość do ${NAME}`, exact: true });
      const send = page.getByRole("button", { name: "Wyślij", exact: true });
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const toBottom = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const toTop = () => page.evaluate(() => window.scrollTo(0, 0));

      if (split) {
        // #457: the long name takes at most two lines in the narrow conversation column, so the history keeps >= 128 px (8 grid steps).
        const headingSplit = await heading.boundingBox();
        const historySplit = await history.boundingBox();
        expect(headingSplit?.height ?? 0, "split heading height").toBeLessThanOrEqual(60);
        expect(historySplit?.height ?? 0, "split history height").toBeGreaterThanOrEqual(128);
        expect(await heading.evaluate((element) => element.textContent)).toBe(NAME);
        // 1024 px and wider: no navigation; the whole composer stays inside the inbox box also with the gap notice (#411/#435).
        await page.route(/\/messages\/\?.*after=/, (route) => route.fulfill({ status: 503, body: "" }));
        await db.chatMessage.createMany({ data: rows(41, 42, conversation.id) });
        await db.conversation.update({ where: { id: conversation.id }, data: { lastSeq: 42, activityAt: at(42) } });
        await sockets[0].route.close({ code: 4503, reason: "SHUTDOWN" });
        await expect.poll(() => sockets.length, { timeout: 15_000 }).toBe(2);
        ready(sockets[1].route, "refetch", "head-of-the-conversation");
        const notice = page.getByTestId("chat-gap-alert");
        await expect(notice).toContainText("Nie udało się wczytać wiadomości z czasu rozłączenia.");
        const inside = async (target: Locator) => {
          const [box, paneBox] = await Promise.all([target.boundingBox(), page.locator('section[aria-label="Rozmowa"], [aria-label="Rozmowa"]').first().boundingBox()]);
          if (!box || !paneBox) throw new Error("Missing boxes");
          return { bottomInPane: box.y + box.height <= paneBox.y + paneBox.height + 1, rightInPane: box.x + box.width <= paneBox.x + paneBox.width + 1 };
        };
        await expect(composer).toBeVisible();
        await expect(send).toBeVisible();
        expect(await inside(composer)).toEqual({ bottomInPane: true, rightInPane: true });
        expect(await inside(send)).toEqual({ bottomInPane: true, rightInPane: true });
        const hitTop = (target: Locator) => target.evaluate((element) => { const box = element.getBoundingClientRect(); const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return !!top && (top === element || element.contains(top)); });
        await toBottom();
        expect(await hitTop(send)).toBe(true);
        await expect(send).toBeInViewport({ ratio: 1 });
        // The inbox box itself ends inside the viewport (nothing sticks out under it).
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        return;
      }

      // Header: back and the card link share one row, the name follows once, on at most two lines. The heading and the link
      // still carry the whole name for assistive technology (the locators above match the full accessible names).
      await expect(heading).toBeVisible();
      await expect(card).toBeVisible();
      expect(await heading.evaluate((element) => element.textContent)).toBe(NAME);
      const [backBox, cardBox, headingBox, historyBox] = await Promise.all([back.boundingBox(), card.boundingBox(), heading.boundingBox(), history.boundingBox()]);
      if (!backBox || !cardBox || !headingBox || !historyBox) throw new Error("Missing conversation header boxes");
      expect.soft(cardBox.y + cardBox.height).toBeLessThanOrEqual(backBox.y + backBox.height + 1);
      expect.soft(cardBox.x).toBeGreaterThan(backBox.x + backBox.width);
      expect.soft(cardBox.height).toBeGreaterThanOrEqual(44);
      expect.soft(headingBox.height).toBeLessThanOrEqual(60);
      expect.soft(headingBox.y).toBeGreaterThanOrEqual(backBox.y + backBox.height);
      // The history starts right below (the header no longer takes half of the screen), has a usable height and scrolls.
      expect.soft(historyBox.y).toBeLessThanOrEqual(tablet ? 280 : 250);
      expect.soft(historyBox.height).toBeGreaterThanOrEqual(128);
      // #452: on tablets the history keeps the same usable minimum (8 grid steps of 16 px) under the long name, not ~34 px.
      if (tablet) expect.soft(historyBox.height).toBeGreaterThanOrEqual(128);
      expect(await history.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      expect(await sideways()).toBeLessThanOrEqual(0);
      // Phone sizes: the message field is on screen without scrolling.
      if (phone) {
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await expectClear(composer, "pole wiadomości bez przewijania");
      }

      // Gap-refetch error (#411): the notice and its action are on screen without any scrolling, also under this name.
      await page.route(/\/messages\/\?.*after=/, (route) => route.fulfill({ status: 503, body: "" }));
      await db.chatMessage.createMany({ data: rows(41, 42, conversation.id) });
      await db.conversation.update({ where: { id: conversation.id }, data: { lastSeq: 42, activityAt: at(42) } });
      await sockets[0].route.close({ code: 4503, reason: "SHUTDOWN" });
      await expect.poll(() => sockets.length, { timeout: 15_000 }).toBe(2);
      ready(sockets[1].route, "refetch", "head-of-the-conversation");
      const alert = page.getByTestId("chat-gap-alert");
      await expect(alert).toContainText("Nie udało się wczytać wiadomości z czasu rozłączenia.");
      const retry = alert.getByRole("button", { name: "Spróbuj ponownie" });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(alert).toBeInViewport({ ratio: 1 });
      await expect(retry).toBeInViewport({ ratio: 1 });
      await expectClear(alert, "komunikat błędu luki bez przewijania");
      await expectClear(retry, "„Spróbuj ponownie” bez przewijania");
      expect((await history.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(64);
      // The field and the send button stay reachable by scrolling the page to its end.
      await toBottom();
      await expectClear(composer, "pole wiadomości w stanie błędu po przewinięciu");
      await expectClear(send, "„Wyślij” w stanie błędu po przewinięciu");
      expect(await sideways()).toBeLessThanOrEqual(0);
      await toTop();
      await page.unroute(/\/messages\/\?.*after=/);
      await retry.click();
      await expect(history.getByText("wiadomość 42", { exact: true })).toBeVisible();
      await expect(alert).toHaveCount(0);

      // Normal state again: with the page scrolled to its end the field and "Wyślij" are entirely above the navigation
      // (centre and both edges hit-tested), and the button really sends to this company.
      await composer.fill("odpowiedź 435");
      await toBottom();
      await expectClear(composer, "pole wiadomości po przewinięciu");
      await expectClear(send, "„Wyślij” po przewinięciu");
      await send.click();
      await expect(history.getByText("odpowiedź 435", { exact: true })).toBeVisible();
      await expect.poll(() => db.chatMessage.count({ where: { organizationId: org, body: "odpowiedź 435", senderId: FIXTURE.users[2] } })).toBe(1);

      // Keyboard: from the back button Tab walks card link, history, older messages, field, send. Every stop is on screen and
      // not under the navigation (the page scrolls for it); the send button shows the token focus ring.
      await composer.fill("szkic 435");
      await toTop();
      await back.focus();
      const stops: string[] = [];
      for (let step = 0; step < 8 && stops.at(-1) !== "Wyślij"; step += 1) {
        await page.keyboard.press("Tab");
        const focused = page.locator(":focus");
        stops.push(await focused.evaluate((element) => element.getAttribute("role") === "log" ? "historia" : element.id === "chat-composer" ? "pole"
          : element.matches('a[href^="/firmy/"]') ? "karta firmy" : element.textContent?.trim() ?? ""));
        await expectClear(focused, `fokus: ${stops.at(-1)}`);
      }
      expect(stops).toEqual(["karta firmy", "historia", "Wcześniejsze wiadomości", "pole", "Wyślij"]);
      await expect(send).toBeFocused();
      expect(await send.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
      expect(await sideways()).toBeLessThanOrEqual(0);
    } finally {
      await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
      await session?.dispose();
      await db.conversationReadCursor.deleteMany({ where: { organizationId: org } });
      await db.chatMessage.deleteMany({ where: { organizationId: org } });
      await db.conversation.deleteMany({ where: { organizationId: org } });
      await db.user.deleteMany({ where: { id: user } });
      await db.hostMapping.deleteMany({ where: { organizationId: org } });
      await db.organization.deleteMany({ where: { id: org } });
      await db.$disconnect();
    }
  });
}
