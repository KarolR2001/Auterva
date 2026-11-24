import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CatalogFilters } from "@/components/public/catalog-filters";
import { LinkButton, PublicPage } from "@/components/public/public-chrome";
import { EmptyOffer, StateBlock } from "@/components/public/state-page";
import { VehicleCard } from "@/components/public/vehicle-card";
import styles from "@/components/public/public.module.css";
import { loadCatalog, loadHome, requestHost, todayWarsaw } from "@/modules/public-offer/page-data";
import { catalogHref, cleanCatalogSearch, formatRangeLong, pluralVehicles, queryErrorMessages, toSearchParams,
  withRange } from "@/modules/public-offer/presentation";
import { toNextMetadata } from "@/modules/public-offer/seo";
import { SearchX } from "lucide-react";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const host = await requestHost();
  if (!host) return {};
  const result = await loadCatalog(host, toSearchParams(await searchParams).toString());
  return result?.ok ? toNextMetadata(result.seo) : { robots: { index: false, follow: false } };
}

export default async function CatalogPage({ searchParams }: Props) {
  const raw = await searchParams;
  const cleaned = cleanCatalogSearch(raw);
  if (cleaned !== null) redirect(cleaned ? `/pojazdy/?${cleaned}` : "/pojazdy/");
  const host = await requestHost();
  if (!host) notFound();
  const query = toSearchParams(raw).toString();
  let result = await loadCatalog(host, query);
  // A disabled company is cut here, before anything else: the same 404 as an unknown address (C-N057).
  if (!result) notFound();
  let problem: string | null = null;
  if (!result.ok) {
    problem = queryErrorMessages[result.error.code];
    // The offer is still shown (without the rejected parameters) so the visitor can correct them.
    result = await loadCatalog(host, "");
    if (!result?.ok) notFound();
  }
  const home = await loadHome(host);
  if (!home) notFound();
  const { applied } = result;
  const range = { from: applied.from, to: applied.to };
  const contactHref = withRange("/kontakt/", range);
  const brand = { name: home.company.name, logo: home.company.logo };
  const today = todayWarsaw();
  const filtered = Boolean(applied.category || applied.seats || applied.transmission || applied.from);

  return (
    <PublicPage brand={brand} contact={home.contact} range={range}>
      <div className={styles.container}>
        <div className={styles.section}>
          <h1 className={styles.pageTitle}>Znajdź pojazd na swoją trasę</h1>
          {result.state !== "EMPTY_OFFER" ? <p className={styles.pageLead}>{pluralVehicles(result.total)} {filtered ? "w wynikach" : "w ofercie"}{applied.from ? ` · ${formatRangeLong(applied.from, applied.to!)}` : ""}</p> : null}
          {problem ? <div role="alert" className={styles.notice}>{problem}</div> : null}
          {result.state === "EMPTY_OFFER" ? (
            <EmptyOffer contactHref={contactHref} level={2} />
          ) : (
            <>
              <CatalogFilters result={result} today={today} />
              {result.state === "NO_RESULTS" ? (
                <StateBlock level={2} icon={<SearchX size={24} />} title="Brak pojazdów dla tych filtrów"
                  actions={<>
                    {applied.category || applied.seats || applied.transmission || applied.sort !== "recommended"
                      ? <LinkButton href={catalogHref({ from: applied.from, to: applied.to })}>Wyczyść filtry</LinkButton> : null}
                    <LinkButton href="#catalog-filters" variant="secondary">Zmień termin</LinkButton>
                    <LinkButton href={contactHref} variant="secondary">Skontaktuj się po alternatywę</LinkButton>
                  </>}>
                  {applied.from ? "Żaden pojazd nie jest wolny w całym wybranym terminie albo nie spełnia filtrów. " : "Żaden pojazd nie spełnia wybranych filtrów. "}
                  Zmień kryteria albo zapytaj firmę o alternatywę.
                </StateBlock>
              ) : (
                <>
                  <h2 className={styles.srOnly}>Lista pojazdów</h2>
                  <ul className={`${styles.grid} ${styles.grid3} ${styles.catalogGrid}`}>
                    {result.items.map((vehicle, index) => (
                      <li key={vehicle.slug}><VehicleCard vehicle={vehicle} range={range} headingLevel={3} priority={index === 0} /></li>
                    ))}
                  </ul>
                  {result.nextCursor ? (
                    <nav className={styles.pager} aria-label="Kolejne wyniki">
                      <LinkButton href={catalogHref({ ...applied, seats: applied.seats?.toString() ?? null, cursor: result.nextCursor })} variant="secondary">
                        Pokaż kolejne pojazdy
                      </LinkButton>
                    </nav>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </PublicPage>
  );
}
