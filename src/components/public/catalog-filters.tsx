import { CalendarSearch } from "lucide-react";

import { FilterDetails } from "./filter-details";
import { DateRangeField } from "./date-range-field";

import { catalogHref, catalogPath, sortLabels } from "@/modules/public-offer/presentation";
import type { CatalogResult } from "@/modules/public-offer/read";

import styles from "./public.module.css";

type Ok = Extract<CatalogResult, { ok: true }>;

/** Home checker (PUB-01): a GET form to the catalog, so the chosen range lives in the URL and in history. */
export function AvailabilityChecker({ today }: { today: string }) {
  return (
    <form action={catalogPath} method="get" className={styles.panel} aria-labelledby="checker-title">
      <h2 id="checker-title" className={styles.panelTitle}>Sprawdź termin</h2>
      <div className={`${styles.fields} ${styles.fieldsChecker}`}>
        <DateRangeField from={null} to={null} required today={today} />
        <button type="submit" className={`${styles.linkButton} ${styles.linkButtonPrimary}`}>
          <CalendarSearch aria-hidden="true" size={18} />Sprawdź
        </button>
      </div>
      <p className={styles.hint}>Dostępność jest informacyjna; termin potwierdzasz z wypożyczalnią.</p>
    </form>
  );
}

/**
 * Catalog filters (PUB-02): category, seats, transmission, range and sort in one GET form. Every field is a plain
 * control, so the page works without client code, keeps the state in the URL and Back replays it.
 */
export function CatalogFilters({ result, today }: { result: Ok; today: string }) {
  const { applied, filters } = result;
  const active = [applied.category, applied.seats, applied.transmission, applied.from, applied.sort !== "recommended" ? applied.sort : null]
    .filter(Boolean).length;
  const clearable = [applied.category, applied.seats, applied.transmission, applied.sort !== "recommended" ? applied.sort : null].some(Boolean);
  const seatOptions = filters.seats ? Array.from({ length: filters.seats.max - filters.seats.min + 1 }, (_, index) => filters.seats!.min + index) : [];
  const hasFilterOptions = filters.categories.length > 0 || filters.transmissions.length > 0 || seatOptions.length > 1;
  return (
    <form action={catalogPath} method="get" id="catalog-filters" className={`${styles.panel} ${styles.filterBar}`} aria-label="Filtry pojazdów">
      <FilterDetails>
        <summary className={styles.summary}>Filtry i termin{active > 0 ? ` (${active})` : ""}</summary>
        <div className={styles.filterBody}>
          <div className={styles.fields}>
            {filters.categories.length > 0 ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="filter-category">Kategoria</label>
                <select id="filter-category" name="category" defaultValue={applied.category ?? ""} className={styles.select}>
                  <option value="">Wszystkie</option>
                  {filters.categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}
                </select>
              </div>
            ) : null}
            {seatOptions.length > 1 ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="filter-seats">Liczba miejsc (min.)</label>
                <select id="filter-seats" name="seats" defaultValue={applied.seats?.toString() ?? ""} className={styles.select}>
                  <option value="">Dowolna</option>
                  {seatOptions.map((seats) => <option key={seats} value={seats}>{seats}+</option>)}
                </select>
              </div>
            ) : null}
            {filters.transmissions.length > 0 ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="filter-transmission">Skrzynia biegów</label>
                <select id="filter-transmission" name="transmission" defaultValue={filters.transmissions.find((value) => value.toLowerCase() === applied.transmission?.toLowerCase()) ?? ""} className={styles.select}>
                  <option value="">Dowolna</option>
                  {filters.transmissions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
            ) : null}
            <DateRangeField from={applied.from} to={applied.to} required={false} today={today} />
            <div className={styles.field}>
              <label className={styles.label} htmlFor="filter-sort">Sortowanie</label>
              <select id="filter-sort" name="sort" defaultValue={applied.sort} className={styles.select}>
                {filters.sorts.map((sort) => <option key={sort} value={sort}>{sortLabels[sort]}</option>)}
              </select>
            </div>
          </div>
          {!hasFilterOptions ? <p className={styles.hint}>Ta oferta ma na razie jeden wariant — filtry pojawią się wraz z kolejnymi pojazdami.</p> : null}
          <p className={styles.hint}>Terminem jest zakres od 1 do 365 dni; obie daty wliczają się do niego.</p>
          <div className={styles.filterActions}>
            <button type="submit" className={`${styles.linkButton} ${styles.linkButtonPrimary}`}>Zastosuj</button>
            {clearable ? (
              <a href={catalogHref({ from: applied.from, to: applied.to })} className={`${styles.linkButton} ${styles.linkButtonSecondary}`}>Wyczyść filtry</a>
            ) : null}
          </div>
        </div>
      </FilterDetails>
    </form>
  );
}
