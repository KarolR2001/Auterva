// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ContactLink, ContactSheet } from "../../src/components/public/contact-sheet";
import { formatRangeCompact, formatRangeFull, pluralSeats, rangeDays } from "../../src/components/public/range-text";

// OVR-04 (FLOW-MVP-05 M/05): contact with the chosen vehicle and dates; nothing is sent, stored or reserved.
const channels = [
  { kind: "PHONE", value: "+48 600 100 200", href: "tel:+48600100200", preferred: true },
  { kind: "WHATSAPP", value: "+48 600 100 200", href: "https://wa.me/48600100200", preferred: false },
  { kind: "EMAIL", value: "kontakt@alfa.example", href: "mailto:kontakt@alfa.example", preferred: false },
];
const range = { from: "2026-10-20", to: "2026-10-22" };
const href = "/kontakt/?vehicle=kamper&from=2026-10-20&to=2026-10-22";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
});
afterEach(cleanup);

test("a click on the contact link opens the sheet with the vehicle, the range and an editable message", async () => {
  const user = userEvent.setup();
  render(<><ContactLink href={href} range={range}>Skontaktuj się</ContactLink><ContactSheet vehicleName="Kamper rodzinny" channels={channels} /></>);
  const link = screen.getByRole("link", { name: "Skontaktuj się" });
  expect(link.getAttribute("href")).toBe(href);
  await user.click(link);
  const sheet = screen.getByRole("dialog", { name: "Skontaktuj się", hidden: true });
  expect(within(sheet).getByText("Kamper rodzinny")).toBeTruthy();
  expect(within(sheet).getByText("20–22.10.2026 · 3 dni włącznie")).toBeTruthy();
  const message = within(sheet).getByLabelText("Wiadomość do wypożyczalni") as HTMLTextAreaElement;
  expect(message.value).toBe("Dzień dobry, interesuje mnie pojazd Kamper rodzinny w terminie 20.10.2026–22.10.2026. Czy dostępność jest aktualna?");
  const links = within(sheet).getAllByRole("link", { hidden: true });
  expect(links.map((each) => each.textContent)).toEqual(["Zadzwoń+48 600 100 200", "Napisz na WhatsAppZ przygotowaną wiadomością", "Napisz e-mailkontakt@alfa.example"]);
  expect(links[0].getAttribute("href")).toBe("tel:+48600100200");
  fireEvent.change(message, { target: { value: "Inny tekst" } });
  expect(links[1].getAttribute("href")).toBe("https://wa.me/48600100200?text=Inny%20tekst");
  expect(links[2].getAttribute("href")).toBe("mailto:kontakt@alfa.example?subject=Zapytanie%3A%20Kamper%20rodzinny&body=Inny%20tekst");
  expect(within(sheet).getByText("Termin i warunki potwierdzisz z wypożyczalnią. Samo zapytanie nie rezerwuje pojazdu.")).toBeTruthy();
  await user.click(within(sheet).getByRole("button", { name: "Zamknij", hidden: true }));
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
});

test("without channels (or with a modifier key) the link stays a plain link to the contact page", () => {
  render(<><ContactLink href={href} range={range}>Skontaktuj się</ContactLink><ContactSheet vehicleName="Kamper" channels={[]} /></>);
  const link = screen.getByRole("link", { name: "Skontaktuj się" });
  const plain = fireEvent.click(link);
  expect(plain).toBe(true); // not prevented: the browser follows the link
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  cleanup();
  render(<><ContactLink href={href} range={range}>Skontaktuj się</ContactLink><ContactSheet vehicleName="Kamper" channels={channels} /></>);
  expect(fireEvent.click(screen.getByRole("link", { name: "Skontaktuj się" }), { ctrlKey: true })).toBe(true);
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
});

test("the alternative inquiry and an inquiry without dates use their own question", async () => {
  const user = userEvent.setup();
  render(<><ContactLink href={href} range={range} alternative>Alt</ContactLink><ContactLink href="/kontakt/?vehicle=kamper" range={null}>Bez dat</ContactLink>
    <ContactSheet vehicleName="Kamper" channels={channels} /></>);
  await user.click(screen.getByRole("link", { name: "Alt" }));
  expect((screen.getByLabelText("Wiadomość do wypożyczalni") as HTMLTextAreaElement).value).toMatch(/w terminie 20\.10\.2026–22\.10\.2026\. Czy możecie zaproponować inny termin lub pojazd\?$/);
  await user.click(screen.getByRole("button", { name: "Zamknij", hidden: true }));
  await user.click(screen.getByRole("link", { name: "Bez dat" }));
  expect((screen.getByLabelText("Wiadomość do wypożyczalni") as HTMLTextAreaElement).value).toBe("Dzień dobry, interesuje mnie pojazd Kamper. Proszę o informację o dostępności.");
  expect(screen.queryByText(/włącznie/)).toBeNull();
});

test("range and seat texts of the vehicle page", () => {
  expect(formatRangeCompact("2026-10-20", "2026-10-22")).toBe("20–22.10");
  expect(formatRangeCompact("2026-10-20", "2026-10-20")).toBe("20.10");
  expect(formatRangeCompact("2026-10-28", "2026-11-03")).toBe("28.10–03.11");
  expect(formatRangeCompact("2026-12-28", "2027-01-03")).toBe("28.12.2026–03.01.2027");
  expect(formatRangeFull("2026-10-20", "2026-10-22")).toBe("20.10.2026–22.10.2026");
  expect(formatRangeFull("2026-10-20", "2026-10-20")).toBe("20.10.2026");
  expect(rangeDays("2026-10-20", "2026-10-20")).toBe(1);
  expect(rangeDays("2026-03-28", "2026-03-30")).toBe(3); // across the DST change
  expect([1, 2, 4, 5, 12, 22, 25].map(pluralSeats)).toEqual(["1 miejsce", "2 miejsca", "4 miejsca", "5 miejsc", "12 miejsc", "22 miejsca", "25 miejsc"]);
});
