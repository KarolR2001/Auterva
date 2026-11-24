import { ArrowUpDown, CalendarDays, SlidersHorizontal } from "lucide-react";

import { FilterDetails } from "./filter-details";
import { DateRangeField } from "./date-range-field";

import { catalogHref, catalogPath, formatRangeShort, sortLabels } from "@/modules/public-offer/presentation";
import type { CatalogResult } from "@/modules/public-offer/read";

import styles from "./public.module.css";

type Ok = Extract<CatalogResult, { ok: true }>;

/** Home checker (PUB-01): a GET form to the catalog, so the chosen range lives in the URL and in history. */
export function AvailabilityChecker({ today }: { today: string }) {
  return (
    <form action={catalogPath} method="get" className={styles.panel} aria-labelledby="checker-title">
      <h2 id="checker-title" className={styles.panelTitle}>Sprawdź termin</h2>
      <DateRangeField from={null} to={null} required today={today}
        action={<button type="submit" className={`${styles.linkButton} ${styles.linkButtonPrimary}`}>Sprawdź</button>} />
    </form>
  );
}

/**
 * Catalog toolbar (PUB-02): „Wybierz termin”, „Filtry” and „Sortuj” in one row; each opens its panel below the row
 * (one at a time). All controls stay in one GET form, so the page works without client code, keeps the state in the
 * URL and Back replays it. A closed panel still submits its fields.
 */
export function CatalogFilters({ result, today }: { result: Ok; today: string }) {
  const { applied, filters } = result;
  const activeFilters = [applied.category, applied.seats, applied.transmission].filter(Boolean).length;
  const clearable = [applied.category, applied.seats, applied.transmission, applied.sort !== "recommended" ? applied.sort : null].some(Boolean);
  const seatOptions = filters.seats ? Array.from({ length: filters.seats.max - filters.seats.min + 1 }, (_, index) => filters.seats!.min + index) : [];
  const hasFilterOptions = filters.categories.length > 0 || filters.transmissions.length > 0 || seatOptions.length > 1;
  const apply = <button type="submit" className={`${styles.linkButton} ${styles.linkButtonPrimary}`}>Zastosuj</button>;
  const clear = clearable
    ? <a href={catalogHref({ from: applied.from, to: applied.to })} className={`${styles.linkButton} ${styles.linkButtonSecondary}`}>Wyczyść filtry</a> : null;
  return (
    <form action={catalogPath} method="get" id="catalog-filters" className={styles.filterBar} aria-label="Filtry pojazdów">
      <div className={styles.toolbar}>
        <FilterDetails openOnHash="#catalog-filters" className={styles.toolbarDates}>
          <summary className={styles.toolbarButton}>
            <CalendarDays aria-hidden="true" size={18} />
            {applied.from && applied.to ? <span>Termin: {formatRangeShort(applied.from, applied.to)}</span> : <span>Wybierz termin</span>}
          </summary>
          <div className={styles.toolbarPanel}>
            <DateRangeField from={applied.from} to={applied.to} required={false} today={today} />
            <p className={styles.hint}>Terminem jest zakres od 1 do 365 dni.</p>
            <div className={styles.filterActions}>{apply}</div>
          </div>
        </FilterDetails>
        <FilterDetails className={styles.toolbarItem}>
          <summary className={styles.toolbarButton}>
            <SlidersHorizontal aria-hidden="true" size={18} /><span>Filtry{activeFilters > 0 ? ` (${activeFilters})` : ""}</span>
          </summary>
          <div className={styles.toolbarPanel}>
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
            </div>
            {!hasFilterOptions ? <p className={styles.hint}>Ta oferta ma na razie jeden wariant — filtry pojawią się wraz z kolejnymi pojazdami.</p> : null}
            <div className={styles.filterActions}>{apply}{clear}</div>
          </div>
        </FilterDetails>
        <FilterDetails className={styles.toolbarItem}>
          <summary className={styles.toolbarButton}>
            <ArrowUpDown aria-hidden="true" size={18} /><span>Sortuj: {sortLabels[applied.sort].toLowerCase()}</span>
          </summary>
          <div className={styles.toolbarPanel}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="filter-sort">Sortowanie</label>
              <select id="filter-sort" name="sort" defaultValue={applied.sort} className={styles.select}>
                {filters.sorts.map((sort) => <option key={sort} value={sort}>{sortLabels[sort]}</option>)}
              </select>
            </div>
            <div className={styles.filterActions}>{apply}</div>
          </div>
        </FilterDetails>
      </div>
    </form>
  );
}
