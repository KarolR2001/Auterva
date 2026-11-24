import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

// #44: contact, inquiry context and company documents of the public site. The browser resolves *.example.test to
// the trusted ingress; nothing here reads a session. PUB_SHOTS=<dir> saves screenshots for the Penpot comparison.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

function rawGet(port: number, host: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("contact with vehicle and dates, copy, missing channel, documents per company, disabled site", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [a, b, c, d, car] = Array.from({ length: 5 }, () => randomUUID());
  const host = { a: `ct-e2e-a-${a}.example.test`, b: `ct-e2e-b-${b}.example.test`, c: `ct-e2e-c-${c}.example.test`, d: `ct-e2e-d-${d}.example.test` };
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const csp: string[] = [];
  page.on("console", (message) => { if (/content security policy/i.test(message.text())) csp.push(message.text()); });
  const dir = process.env.PUB_SHOTS;
  const shoot = async (name: string) => {
    if (!dir) return;
    for (const [label, width, height] of [["m", 390, 844], ["d", 1440, 1024]] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `${dir}/${name}-${label}.png`, fullPage: true });
    }
  };
  try {
    const settings = {
      a: { phone: "+48 600 000 111", whatsapp: "+48 600 000 222", email: "a@example.test", contactChannel: "WHATSAPP", contactHours: "Pn–Pt 9:00–17:00",
        addressLine: "ul. Testowa 1", postalCode: "00-001", city: "Warszawa", country: "Polska", mapLatitude: "52.229700", mapLongitude: "21.012200",
        privacyText: "Polityka A <b>tekst</b>\nDruga linia", termsUrl: "https://firma-a.example/regulamin.pdf" },
      b: { email: "b@example.test", privacyUrl: "https://firma-b.example/polityka" },
      c: {},
      d: { phone: "+48 600 000 444", email: "d@example.test", privacyText: "Polityka D" },
    };
    for (const [key, id, name] of [["a", a, "Firma Kontakt A"], ["b", b, "Firma Kontakt B"], ["c", c, "Firma Kontakt C"], ["d", d, "Firma Kontakt D"]] as const) {
      await db.organization.create({ data: { id, slug: `ct-e2e-${id}`, name, firstAdminRegisteredAt: key === "d" ? new Date(now.getTime() - 40 * 86_400_000) : now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: key === "d" ? new Date(now.getTime() - 40 * 86_400_000) : now,
        trialEndsAt: new Date(now.getTime() + (key === "d" ? -26 * 24 : 336) * 3_600_000) } });
      await db.siteSettings.create({ data: { organizationId: id, publicName: name, ...settings[key] } });
      await db.hostMapping.create({ data: { hostname: host[key], organizationId: id, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    }
    await db.vehicle.create({ data: { id: car, organizationId: a, slug: `kamper-${car}`, name: "Kamper & Co", status: "PUBLISHED",
      availableFrom: sqlDate(today), shortDescription: "Krótki opis" } });
    const origin = (key: keyof typeof host) => `http://${host[key]}:${port}`;
    const before = { vehicles: await db.vehicle.count(), blocks: await db.availabilityBlock.count() };

    // 1. Context: the vehicle and the dates reach the message and every link, correctly encoded.
    await page.goto(`${origin("a")}/kontakt/?vehicle=kamper-${car}&from=${day(3)}&to=${day(5)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Porozmawiajmy o właściwym samochodzie" })).toBeVisible();
    await expect(page.getByText("Kamper & Co").first()).toBeVisible();
    const phone = page.getByRole("link", { name: "Zadzwoń" });
    await expect(phone).toHaveAttribute("href", "tel:+48600000111");
    const wa = await page.getByRole("link", { name: "Otwórz WhatsApp" }).getAttribute("href");
    const waUrl = new URL(wa!);
    expect(waUrl.origin + waUrl.pathname).toBe("https://wa.me/48600000222");
    expect(waUrl.searchParams.get("text")).toContain("Kamper & Co");
    expect(waUrl.searchParams.get("text")).toContain(day(3));
    expect(wa).not.toContain("& Co");
    const mail = new URL((await page.getByRole("link", { name: "Napisz e-mail" }).getAttribute("href"))!);
    expect(mail.pathname).toBe("a@example.test");
    expect(mail.searchParams.get("body")).toContain(day(5));
    await expect(page.getByText("Preferowany kanał")).toBeVisible();
    await expect(page.getByText("Pn–Pt 9:00–17:00")).toBeVisible();
    await expect(page.locator("address").getByText("ul. Testowa 1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Otwórz w mapach" })).toHaveAttribute("href", /openstreetmap\.org\/\?mlat=52\.2297&mlon=21\.0122/);
    await shoot("pub-04-contact");

    // 2. Copy works without a handler for the channel; the page shows no booking promise and records nothing.
    await page.getByRole("button", { name: "Kopiuj: Telefon +48 600 000 111" }).click();
    await expect(page.getByText("Skopiowano", { exact: true })).toBeVisible();
    await expect(page.getByText(/Sprawdzenie nie jest rezerwacją/)).toBeVisible();
    expect(await rawGet(port, host.a, "/kontakt/")).toMatchObject({ status: 200 });
    expect({ vehicles: await db.vehicle.count(), blocks: await db.availabilityBlock.count() }).toEqual(before);

    // 3. An unknown vehicle or past dates are ignored, never shown; the foreign company's data never appears.
    const plain = (await rawGet(port, host.a, `/kontakt/?vehicle=nie-ma&from=2020-01-01&to=2020-01-02`)).body;
    expect(plain).not.toContain("Twoje zapytanie");
    expect(plain).not.toContain("b@example.test");
    await page.goto(`${origin("b")}/kontakt/`);
    await expect(page.getByText("b@example.test").first()).toBeVisible();
    await expect(page.getByText("+48 600 000 111")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Zadzwoń" })).toHaveCount(0);

    // 4. No channel at all: an explicit state, no empty action.
    await page.goto(`${origin("c")}/kontakt/`);
    await expect(page.getByText("Firma nie podała jeszcze kanału kontaktu")).toBeVisible();
    await expect(page.locator('main a[href^="tel:"], main a[href^="mailto:"], main a[href*="wa.me"]')).toHaveCount(0);

    // 5. Documents belong to their company: text escaped, link, and the explicit missing state.
    await page.goto(`${origin("a")}/polityka-prywatnosci/`);
    await expect(page.getByRole("heading", { level: 1, name: "Polityka prywatności" })).toBeVisible();
    await expect(page.getByText("Polityka A <b>tekst</b>", { exact: false })).toBeVisible();
    await expect(page.locator("main b")).toHaveCount(0);
    await shoot("pub-05-privacy");
    await page.goto(`${origin("a")}/regulamin/`);
    await expect(page.getByRole("link", { name: /Otwórz: Regulamin/ })).toHaveAttribute("href", "https://firma-a.example/regulamin.pdf");
    await expect(page.getByRole("link", { name: "Skontaktuj się z firmą" })).toHaveAttribute("href", "/kontakt/");
    // Terms are optional: company B has none, so the screen is a 404 and the contact page does not link to it.
    expect((await rawGet(port, host.b, "/regulamin/")).status).toBe(404);
    await page.goto(`${origin("b")}/kontakt/`);
    await expect(page.getByRole("link", { name: "Regulamin" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Polityka prywatności" }).first()).toBeVisible();
    await page.goto(`${origin("a")}/kontakt/`);
    await expect(page.getByRole("main").getByRole("link", { name: "Regulamin" })).toHaveAttribute("href", "/regulamin/");
    await page.goto(`${origin("b")}/polityka-prywatnosci/`);
    await expect(page.getByRole("link", { name: /Otwórz: Polityka prywatności/ })).toHaveAttribute("href", "https://firma-b.example/polityka");
    expect((await rawGet(port, host.b, "/polityka-prywatnosci/")).body).not.toContain("Polityka A");
    await shoot("pub-06-terms");

    // 6. Keyboard: skip link, then the contact controls are reachable in order.
    await page.goto(`${origin("a")}/kontakt/`);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Przejdź do treści" })).toBeFocused();
    await page.getByRole("link", { name: "Zadzwoń" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /Kopiuj: Telefon/ })).toBeFocused();

    // 7. A company whose period has ended: contact page and documents go dark like the rest of the site (C-N057).
    for (const path of ["/kontakt/", "/polityka-prywatnosci/", "/regulamin/", "/"]) {
      const reply = await rawGet(port, host.d, path);
      expect(reply.status).toBe(404);
      expect(reply.body).not.toContain("Firma Kontakt D");
      expect(reply.body).not.toContain("d@example.test");
      expect(reply.body).not.toContain("Polityka D");
    }
    expect(csp).toEqual([]);
  } finally {
    await db.vehicle.deleteMany({ where: { id: car } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(host) } } });
    await db.siteSettings.deleteMany({ where: { organizationId: { in: [a, b, c, d] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [a, b, c, d] } } });
    await db.organization.deleteMany({ where: { id: { in: [a, b, c, d] } } });
    await db.$disconnect();
  }
});
