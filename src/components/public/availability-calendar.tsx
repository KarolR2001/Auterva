import { catalogPath, monthDays, monthLabel, shiftMonth, type DayState } from "@/modules/public-offer/presentation";

import styles from "./public.module.css";

const weekdays = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const dayText: Record<DayState, string> = { past: "minął", available: "dostępny", unavailable: "niedostępny" };

type Props = {
  slug: string; month: string; today: string; days: Map<string, boolean>;
  range: { from: string | null; to: string | null }; minMonth: string; maxMonth: string;
};

/**
 * Public month calendar (PUB-03): a server-rendered table of the public day states (available / unavailable /
 * past). The reason of an unavailable day never reaches the page. Every state is text as well as shape, and the
 * month links keep the chosen range; the range itself is picked in the check form above.
 */
export function AvailabilityCalendar({ slug, month, today, days, range, minMonth, maxMonth }: Props) {
  const cells = monthDays(month);
  const lead = cells[0].weekday;
  const rows: ({ date: string; day: number } | null)[][] = [];
  const flat = [...Array<null>(lead).fill(null), ...cells.map(({ date }) => ({ date, day: Number(date.slice(8)) }))];
  while (flat.length % 7 !== 0) flat.push(null);
  for (let at = 0; at < flat.length; at += 7) rows.push(flat.slice(at, at + 7));
  const base = `${catalogPath}${slug}/`;
  const link = (target: string) => {
    const params = new URLSearchParams();
    if (range.from && range.to) { params.set("from", range.from); params.set("to", range.to); }
    params.set("month", target);
    return `${base}?${params.toString()}#kalendarz`;
  };
  const inRange = (date: string) => Boolean(range.from && range.to && date >= range.from && date <= range.to);
  const stateOf = (date: string): DayState => (date < today ? "past" : days.get(date) === true ? "available" : "unavailable");
  return (
    <section className={styles.calendar} id="kalendarz" aria-labelledby="calendar-title">
      <div className={styles.calendarHead}>
        {month > minMonth
          ? <a href={link(shiftMonth(month, -1))} className={styles.iconButton} aria-label="Poprzedni miesiąc">‹</a>
          : <span className={styles.spacer} aria-hidden="true" />}
        <h2 id="calendar-title" className={styles.calendarTitle}>{monthLabel(month)}</h2>
        {month < maxMonth
          ? <a href={link(shiftMonth(month, 1))} className={styles.iconButton} aria-label="Następny miesiąc">›</a>
          : <span className={styles.spacer} aria-hidden="true" />}
      </div>
      <table className={styles.calendarTable}>
        <caption className={styles.srOnly}>Dostępność pojazdu w miesiącu: {monthLabel(month)}. Informacja nie jest rezerwacją terminu.</caption>
        <thead><tr>{weekdays.map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, at) => (
            <tr key={at}>
              {row.map((cell, column) => {
                if (!cell) return <td key={column} />;
                const state = stateOf(cell.date);
                const selected = inRange(cell.date);
                const classes = [styles.day, state === "available" ? styles.dayAvailable : state === "unavailable" ? styles.dayUnavailable : styles.dayPast,
                  cell.date === today && styles.dayToday, selected && styles.daySelected].filter(Boolean).join(" ");
                return (
                  <td key={column} className={classes} aria-current={cell.date === today ? "date" : undefined}>
                    {cell.day}
                    <span className={styles.srOnly}> {dayText[state]}{cell.date === today ? ", dzisiaj" : ""}{selected ? ", wybrany zakres" : ""}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.legend} aria-label="Legenda kalendarza">
        <li><span className={`${styles.legendMark} ${styles.dayAvailable}`} aria-hidden="true" />Dostępny</li>
        <li><span className={`${styles.legendMark} ${styles.dayUnavailable}`} aria-hidden="true" />Niedostępny (przekreślony)</li>
        <li><span className={`${styles.legendMark} ${styles.dayToday}`} aria-hidden="true" />Dzisiaj</li>
        <li><span className={`${styles.legendMark} ${styles.daySelected}`} aria-hidden="true" />Wybrany zakres</li>
      </ul>
    </section>
  );
}
