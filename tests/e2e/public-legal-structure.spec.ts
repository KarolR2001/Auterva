import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

// #232 (D-36): structure of the company's plain-text document: numbered headings, table of contents, anchors and the
// back link to a vehicle (only a published vehicle of this company).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("legal document: table of contents, anchors, keyboard, back link, widths", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [a, b, pub, draft, foreign] = Array.from({ length: 5 }, () => randomUUID());
  const host = { a: `lg-e2e-a-${a}.example.test`, b: `lg-e2e-b-${b}.example.test` };
  const now = new Date();
  const long = `## ${"Bardzo długi nagłówek ".repeat(12)}\nTreść długiej sekcji ${"słowo ".repeat(80)}`;
  const text = `Wstęp <i>nie HTML</i>\n\n## Administrator danych\nFirma <b>A</b>\nDruga linia\n\n## Cele przetwarzania\nObsługa zapytań\n\n## Pusta sekcja\n\n${long}\n\n${"## Kolejna sekcja\nTekst\n\n".repeat(6)}`;
  try {
    for (const [key, id, name] of [["a", a, "Firma Prawna A"], ["b", b, "Firma Prawna B"]] as const) {
      await db.organization.create({ data: { id, slug: `lg-e2e-${id}`, name, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
      await db.siteSettings.create({ data: { organizationId: id, publicName: name, email: `${key}@example.test`,
        ...(key === "a" ? { privacyText: text, termsText: "## Wynajem\nZasady <b>A</b>" } : { privacyText: "Bez nagłówków" }) } });
      await db.hostMapping.create({ data: { hostname: host[key], organizationId: id, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    }
    const available = sqlDate(availabilityToday());
    await db.vehicle.create({ data: { id: pub, organizationId: a, slug: `kamper-${pub}`, name: "Kamper Prawny", status: "PUBLISHED", availableFrom: available } });
    await db.vehicle.create({ data: { id: draft, organizationId: a, slug: `szkic-${draft}`, name: "Szkic", status: "DRAFT", availableFrom: available } });
    await db.vehicle.create({ data: { id: foreign, organizationId: b, slug: `obcy-${foreign}`, name: "Obcy", status: "PUBLISHED", availableFrom: available } });
    const origin = (key: keyof typeof host) => `http://${host[key]}:${port}`;

    // Table of contents, numbered headings, anchors, escaped text.
    await page.goto(`${origin("a")}/polityka-prywatnosci/`);
    await expect(page.getByText("Informacje prawne", { exact: true })).toBeVisible();
    const toc = page.getByRole("navigation", { name: "Spis treści" });
    await expect(toc.getByRole("link")).toHaveCount(10);
    await expect(page.getByRole("heading", { level: 2, name: "02 Cele przetwarzania" })).toHaveAttribute("id", "sekcja-2");
    await expect(page.locator("main b, main i")).toHaveCount(0);
    await expect(page.getByText("Wstęp <i>nie HTML</i>")).toBeVisible();
    await expect(page.getByText(/Ostatnia aktualizacja/)).toHaveCount(0); // no date field until #325

    // Keyboard: Tab to the TOC link, Enter moves to the section (hash) and the section is in view.
    await toc.getByRole("link", { name: "02 Cele przetwarzania" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#sekcja-2$/);
    await expect(page.getByRole("heading", { level: 2, name: "02 Cele przetwarzania" })).toBeInViewport();

    // No headings: no table of contents.
    await page.goto(`${origin("b")}/polityka-prywatnosci/`);
    await expect(page.getByRole("navigation", { name: "Spis treści" })).toHaveCount(0);
    await expect(page.getByText("Bez nagłówków")).toBeVisible();

    // Back link: only a published vehicle of this company.
    await page.goto(`${origin("a")}/regulamin/?vehicle=kamper-${pub}`);
    await expect(page.getByText("Zasady wynajmu", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Wróć do pojazdu: Kamper Prawny/ })).toHaveAttribute("href", `/pojazdy/kamper-${pub}/`);
    for (const slug of [`szkic-${draft}`, `obcy-${foreign}`, "nie-ma", "javascript:alert(1)", "../x"]) {
      await page.goto(`${origin("a")}/regulamin/?vehicle=${encodeURIComponent(slug)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Regulamin" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Wróć do pojazdu/ })).toHaveCount(0);
    }

    // 320-1920: no horizontal scroll.
    for (const width of [320, 768, 1024, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin("a")}/polityka-prywatnosci/?vehicle=kamper-${pub}`);
      await expect(toc).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow ${width}`).toBeLessThanOrEqual(0);
    }
  } finally {
    await db.vehicle.deleteMany({ where: { id: { in: [pub, draft, foreign] } } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(host) } } });
    await db.siteSettings.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [a, b] } } });
    await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
    await db.$disconnect();
  }
});
