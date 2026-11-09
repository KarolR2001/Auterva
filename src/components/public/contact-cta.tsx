"use client";

import { useEffect, useState } from "react";

import { contactHref } from "@/modules/public-offer/presentation";

import { LinkButton } from "./public-chrome";

export const rangeEvent = "auterva:checked-range";
type Range = { from: string; to: string } | null;

/**
 * The page-level "Skontaktuj się" action. It follows the range the availability panel has actually checked, so the
 * contact page receives the exact vehicle and dates; it only builds a link and never writes anything.
 */
export function ContactCta({ slug, initial }: { slug: string; initial: Range }) {
  const [range, setRange] = useState<Range>(initial);
  useEffect(() => {
    const listener = (event: Event) => setRange((event as CustomEvent<Range>).detail);
    window.addEventListener(rangeEvent, listener);
    return () => window.removeEventListener(rangeEvent, listener);
  }, []);
  return <LinkButton href={contactHref(slug, range ?? { from: null, to: null })} fill>Skontaktuj się</LinkButton>;
}
