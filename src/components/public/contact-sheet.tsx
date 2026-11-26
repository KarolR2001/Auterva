"use client";

import { Mail, MessageSquare, Phone } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { formatRangeShort, pluralDays } from "@/modules/public-offer/presentation";

import { formatRangeFull, rangeDays } from "./range-text";
import styles from "./public.module.css";

export const openContactEvent = "auterva:open-contact";
type Range = { from: string; to: string } | null;
type OpenRequest = { range: Range; alternative: boolean };
export type SheetChannel = { kind: string; value: string; href: string; preferred?: boolean };

/**
 * "Skontaktuj się" on the vehicle page (OVR-04). It stays a plain link to /kontakt/ with the vehicle and the dates: without
 * script, with a modifier key or when the page has no contact sheet, the browser follows it. With the sheet mounted a
 * plain click opens the sheet instead (the sheet cancels the event it handles).
 */
export function ContactLink({ href, range, alternative = false, className, children }:
  { href: string; range: Range; alternative?: boolean; className?: string; children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const handled = !window.dispatchEvent(new CustomEvent<OpenRequest>(openContactEvent, { cancelable: true, detail: { range, alternative } }));
    if (handled) event.preventDefault();
  };
  return <a href={href} className={className} onClick={onClick}>{children}</a>;
}

const channelText: Record<string, { label: string; Icon: typeof Phone }> = {
  PHONE: { label: "Zadzwoń", Icon: Phone },
  WHATSAPP: { label: "Napisz na WhatsApp", Icon: MessageSquare },
  EMAIL: { label: "Napisz e-mail", Icon: Mail },
};

function defaultMessage(vehicleName: string, { range, alternative }: OpenRequest): string {
  const term = range ? ` w terminie ${formatRangeFull(range.from, range.to)}` : "";
  const question = alternative ? "Czy możecie zaproponować inny termin lub pojazd?" : range ? "Czy dostępność jest aktualna?" : "Proszę o informację o dostępności.";
  return `Dzień dobry, interesuje mnie pojazd ${vehicleName}${term}. ${question}`;
}

/** The link of a channel with the visitor's own text: WhatsApp and e-mail carry it, the phone only dials. */
function channelHref(channel: SheetChannel, text: string, subject: string): string {
  const base = channel.href.split("?")[0];
  const body = text.trim();
  if (channel.kind === "WHATSAPP") return body ? `${base}?text=${encodeURIComponent(body)}` : base;
  if (channel.kind === "EMAIL") return `${base}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
  return channel.href;
}

/**
 * OVR-04 (FLOW-MVP-05 M/05): contact with the chosen vehicle and dates. It never sends or stores anything: the channels
 * open the visitor's phone, WhatsApp or mail client with the editable message, and nothing is reserved.
 * A native modal dialog (the shared Radix dialog injects an un-nonced style, which the CSP of #57 blocks): showModal()
 * traps focus, Escape closes it and focus returns to the link that opened it. Full screen on a phone, centred from 768 px.
 */
export function ContactSheet({ vehicleName, channels }: { vehicleName: string; channels: SheetChannel[] }) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [text, setText] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const id = useId();
  const usable = channels.length > 0;

  useEffect(() => {
    if (!usable) return;
    const listener = (event: Event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<OpenRequest>).detail;
      setRequest(detail);
      setText(defaultMessage(vehicleName, detail));
    };
    window.addEventListener(openContactEvent, listener);
    return () => window.removeEventListener(openContactEvent, listener);
  }, [usable, vehicleName]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (request && dialog && !dialog.open) dialog.showModal();
  }, [request]);

  if (!request) return null;
  const { range } = request;
  const subject = `Zapytanie: ${vehicleName}`;
  return (
    <dialog ref={dialogRef} className={styles.sheet} aria-labelledby={`${id}-title`} onClose={() => setRequest(null)}>
      <h2 id={`${id}-title`} className={styles.sheetTitle}>Skontaktuj się</h2>
      <p className={styles.sheetVehicle}>{vehicleName}</p>
      {range ? <p className={styles.sheetRange}>{formatRangeShort(range.from, range.to)} · {pluralDays(rangeDays(range.from, range.to))} włącznie</p> : null}
      <ul className={styles.sheetChannels} aria-label="Kanały kontaktu">
        {channels.map((channel) => {
          const info = channelText[channel.kind];
          if (!info) return null;
          const { label, Icon } = info;
          return (
            <li key={channel.kind}>
              <a href={channelHref(channel, text, subject)} className={`${styles.sheetChannel} ${channel.preferred ? styles.sheetChannelPreferred : ""}`}
                {...(channel.kind === "WHATSAPP" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                <Icon aria-hidden="true" size={24} className={styles.sheetChannelIcon} />
                <span className={styles.sheetChannelText}>
                  <span className={styles.sheetChannelLabel}>{label}</span>
                  <span className={styles.sheetChannelValue}>{channel.kind === "WHATSAPP" ? "Z przygotowaną wiadomością" : channel.value}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <label htmlFor={`${id}-message`} className={styles.sheetLabel}>Wiadomość do wypożyczalni</label>
      <textarea id={`${id}-message`} className={styles.sheetMessage} value={text} rows={5} maxLength={1000}
        aria-describedby={`${id}-hint`} onChange={(event) => setText(event.target.value)} />
      <p id={`${id}-hint`} className={styles.sheetHint}>Możesz zmienić treść przed wysłaniem.</p>
      <p className={styles.sheetNote}>Termin i warunki potwierdzisz z wypożyczalnią. Samo zapytanie nie rezerwuje pojazdu.</p>
      <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary} ${styles.fill}`} onClick={() => dialogRef.current?.close()}>Zamknij</button>
    </dialog>
  );
}
