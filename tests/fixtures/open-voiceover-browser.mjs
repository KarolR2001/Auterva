import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = new URL(process.argv[2] ?? "http://127.0.0.1:3339/ui-check");
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !["/ui-check", "/ui-check/"].includes(target.pathname)
) {
  throw new Error("Podaj lokalny adres trasy /ui-check.");
}

const profile = await mkdtemp(join(tmpdir(), "auterva-voiceover-"));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 390, height: 844 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  const response = await page.goto(target.href);
  if (response?.status() !== 200) {
    throw new Error(`Fixture nie jest dostępna: HTTP ${response?.status()}.`);
  }
  console.log(
    "Otwarta izolowana przeglądarka z fixture. Zamknij okno lub naciśnij Ctrl-C.",
  );
  await new Promise((resolve) => {
    browser.once("close", resolve);
    process.once("SIGINT", resolve);
  });
} finally {
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
