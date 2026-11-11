"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { TextInput } from "../ui/text-input";
import { listPublishedVehicles } from "./feed-api";
import {
  FEED_MAX_VEHICLES, isVehicleScope, VEHICLE_SEARCH_THRESHOLD, vehicleName, vehiclesText,
  type FeedItem, type FeedScope, type FeedScopeVehicle,
} from "./feed-model";
import styles from "./feed-scope.module.css";

export type PublishedVehicles = { status: "idle" | "loading" } | { status: "error" } | { status: "ready"; items: FeedScopeVehicle[] };

/**
 * Published vehicles for the selection, read the first time "Wybrane pojazdy" is chosen. `reload` reads the list again
 * (after the server refused a vehicle that is no longer published) and resolves with the fresh list, or null.
 */
export function usePublishedVehicles(enabled: boolean) {
  const [state, setState] = useState<PublishedVehicles>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async (): Promise<FeedScopeVehicle[] | null> => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: "loading" });
    const result = await listPublishedVehicles(current.signal);
    if (current.signal.aborted) return null;
    setState(result.ok ? { status: "ready", items: result.data } : { status: "error" });
    return result.ok ? result.data : null;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first read when the selection is opened
    if (enabled && state.status === "idle") void reload();
  }, [enabled, state.status, reload]);
  useEffect(() => () => controller.current?.abort(), []);

  return { state, reload };
}

type FieldsProps = {
  scope: FeedScope;
  selected: string[];
  vehicles: PublishedVehicles;
  error: string | null;
  disabled: boolean;
  onScope: (scope: FeedScope) => void;
  onSelected: (ids: string[]) => void;
  onRetry: () => void;
};

/**
 * ADM-22 state=create (#367): scope of a new address. Native radios (arrow keys move between them) and a checkbox list
 * of published vehicles with a search above 8 vehicles and a limit of 50.
 */
export function FeedScopeFields({ scope, selected, vehicles, error, disabled, onScope, onSelected, onRetry }: FieldsProps) {
  const [search, setSearch] = useState("");
  const all = vehicles.status === "ready" ? vehicles.items : [];
  const query = search.trim().toLocaleLowerCase("pl");
  const shown = query ? all.filter((vehicle) => vehicleName(vehicle).toLocaleLowerCase("pl").includes(query)) : all;
  const full = selected.length >= FEED_MAX_VEHICLES;

  function toggle(id: string, checked: boolean) {
    if (checked) { if (!selected.includes(id) && !full) onSelected([...selected, id]); }
    else onSelected(selected.filter((value) => value !== id));
  }

  return (
    <div className={styles.scope}>
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.legend}>Zakres</legend>
        <label className={styles.option}>
          <input type="radio" name="feed-scope" value="FLEET" checked={scope === "FLEET"} onChange={() => onScope("FLEET")}
            aria-describedby="feed-scope-fleet-hint" />
          <span><strong>Cała flota</strong><span id="feed-scope-fleet-hint">Wszystkie pojazdy opublikowane.</span></span>
        </label>
        <label className={styles.option}>
          <input id="feed-scope-vehicles" type="radio" name="feed-scope" value="VEHICLES" checked={scope === "VEHICLES"}
            onChange={() => onScope("VEHICLES")} aria-describedby="feed-scope-vehicles-hint" />
          <span><strong>Wybrane pojazdy (opublikowane)</strong>
            <span id="feed-scope-vehicles-hint">Wybierz pojazdy opublikowane; szkice, ukryte i zarchiwizowane są pomijane.</span></span>
        </label>
      </fieldset>

      {scope === "VEHICLES" && (
        <fieldset id="feed-vehicles" tabIndex={-1} className={`${styles.fieldset} ${styles.vehiclesBox}`} disabled={disabled}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "feed-vehicles-error feed-vehicles-count" : "feed-vehicles-count"}>
          <legend className={styles.legend}>Pojazdy opublikowane</legend>
          <p id="feed-vehicles-count" className={styles.count} aria-live="polite">
            {vehicles.status === "ready"
              ? `Wybrano ${selected.length} z ${all.length} · limit ${FEED_MAX_VEHICLES} pojazdów w jednym adresie`
              : `Do ${FEED_MAX_VEHICLES} pojazdów w jednym adresie.`}
          </p>
          {error && <p id="feed-vehicles-error" className={styles.error}>{error}</p>}
          {(vehicles.status === "loading" || vehicles.status === "idle") && <p role="status" className={styles.muted}>Wczytujemy opublikowane pojazdy…</p>}
          {vehicles.status === "error" && (
            <Alert tone="error" title="Nie udało się wczytać pojazdów." action={{ label: "Spróbuj ponownie", onClick: onRetry }}>
              Wybór pojazdów jest niedostępny do czasu ponownego odczytu. Możesz utworzyć adres dla całej floty.
            </Alert>
          )}
          {vehicles.status === "ready" && all.length === 0 && (
            <p className={styles.muted}>Firma nie ma teraz opublikowanych pojazdów. Opublikuj pojazd albo wybierz zakres „Cała flota”.</p>
          )}
          {vehicles.status === "ready" && all.length > VEHICLE_SEARCH_THRESHOLD && (
            <div className={styles.tools}>
              <TextInput id="feed-vehicle-search" type="search" aria-label="Szukaj pojazdu" placeholder="Szukaj pojazdu"
                value={search} autoComplete="off" onChange={(event) => setSearch(event.target.value)} />
              <Button variant="tertiary" size="sm" onClick={() => onSelected([])} disabled={disabled || selected.length === 0}>Wyczyść wybór</Button>
            </div>
          )}
          {vehicles.status === "ready" && all.length > 0 && (shown.length === 0
            ? <p className={styles.muted}>Żaden pojazd nie pasuje do wyszukiwania.</p>
            : (
              <ul className={styles.vehicles}>
                {shown.map((vehicle) => {
                  const checked = selected.includes(vehicle.id);
                  return (
                    <li key={vehicle.id} className={styles.vehicle}>
                      <label className={styles.vehicleLabel}>
                        <input type="checkbox" checked={checked} disabled={!checked && full}
                          onChange={(event) => toggle(vehicle.id, event.target.checked)} />
                        <span>{vehicleName(vehicle)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ))}
          {full && <p className={styles.muted}>Wybrano limit {FEED_MAX_VEHICLES} pojazdów. Odznacz pojazd, aby wybrać inny.</p>}
        </fieldset>
      )}
    </div>
  );
}

/** Names behind a disclosure for a VEHICLES scope on the list (also in the superadmin view, read only). */
export function FeedScopeVehicles({ item }: { item: FeedItem }) {
  if (!isVehicleScope(item)) return null;
  const vehicles = item.vehicles ?? [];
  if (vehicles.length === 0) {
    return <p className={styles.muted}>Wybrane pojazdy zostały usunięte z floty, więc ten kalendarz jest pusty.</p>;
  }
  return (
    <details className={styles.details}>
      <summary>Pojazdy w zakresie ({vehiclesText(vehicles.length)})</summary>
      <ul className={styles.names}>
        {vehicles.map((vehicle) => <li key={vehicle.id}>{vehicleName(vehicle)}</li>)}
      </ul>
      <p className={styles.muted}>Kalendarz pokazuje tylko te z nich, które są teraz opublikowane.</p>
    </details>
  );
}
