"use client";

import { Ban, Check, Circle, CircleCheck, Copy, Info, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { legacyCopy } from "../public/copy-button";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { PageHeader } from "../ui/page-header";
import settingsStyles from "../settings/settings.module.css";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import { createFeed, listFeeds, revokeFeed, rotateFeed, type FeedContext, type FeedResult } from "./feed-api";
import {
  daysLeft, daysText, expiresSoon, findUnseenCreated, findUnseenRotated, formatDate, isUncertain, LABEL_MAX,
  keepKnown, labelError, limitReached, metaLine, revokedOnList, scopeText, statusLabels, vehicleIdsErrorText,
  vehicleSelectionError, type FeedItem, type FeedList, type FeedScope, type FeedStatus, type IssuedFeed,
} from "./feed-model";
import { FeedScopeFields, FeedScopeVehicles, usePublishedVehicles } from "./feed-scope";
import styles from "./calendar-feeds.module.css";

type Notice = { tone: "success" | "info" | "warning" | "error"; title: string; text?: string;
  action?: { label: string; onClick: () => void } } | null;
type Confirm = { kind: "rotate" | "revoke"; item: FeedItem } | null;
type Pending = { kind: "create" } | { kind: "rotate" | "revoke"; id: string } | null;
type View = "list" | "create" | "issued";

const statusIcons: Record<FeedStatus, typeof CircleCheck> = { ACTIVE: CircleCheck, EXPIRED: Circle, REVOKED: Ban };

function failureText(result: Extract<FeedResult<unknown>, { ok: false }>): string {
  if (result.status === 429) return result.retryAfter ? `Za dużo żądań. Spróbuj ponownie za ${result.retryAfter} s.` : "Za dużo żądań. Spróbuj ponownie za chwilę.";
  if (result.status === 403 || result.status === 401) return "Brak uprawnień do tej operacji. Odśwież stronę lub zaloguj się ponownie.";
  return "Odśwież listę i spróbuj ponownie.";
}

type Props = {
  context: FeedContext;
  /** Superadmin view: the company whose addresses are shown (create and rotate stay with the company admin). */
  companyName?: string;
  now?: Date;
  /** Settings section nav (ADM-22): the page header then spans the nav and the content, like the other settings. */
  nav?: ReactNode;
  /** Trail above the title, e.g. "Ustawienia / Kalendarz zewnętrzny". */
  trail?: string;
};

/**
 * ADM-22 (#355): private iCal addresses of the company. The address exists only in the answer of create or rotate and
 * only in this component's state until it is closed; it never goes to the URL, storage, logs or server props.
 */
export function CalendarFeeds({ context, companyName, now: fixedNow, nav, trail }: Props) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [list, setList] = useState<FeedList | null>(null);
  const [view, setView] = useState<View>("list");
  const [label, setLabel] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [scope, setScope] = useState<FeedScope>("FLEET");
  const [selected, setSelected] = useState<string[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ feed: IssuedFeed; rotated: boolean } | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = fixedNow ?? new Date();

  const published = usePublishedVehicles(view === "create" && scope === "VEHICLES");
  // Leaving with an address on screen loses it for good; a typed label or a selection is a draft. Both go through the shell guard.
  useUnsavedChanges({ dirty: view === "issued" || (view === "create" && (label.trim().length > 0 || selected.length > 0)), saving: pending !== null,
    contextLabel: view === "issued" ? "jednorazowo pokazany adres kalendarza" : "nowy adres kalendarza" });

  const load = useCallback(async () => {
    const result = await listFeeds(context);
    if (result.ok) { setList(result.data); setPhase("ready"); return result.data; }
    setPhase((current) => (current === "ready" ? current : "error"));
    return null;
  }, [context]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  const focus = (target: () => HTMLElement | null | undefined) => requestAnimationFrame(() => target()?.focus());
  const focusHeading = () => focus(() => headingRef.current);
  const show = (next: Notice) => { setNotice(next); if (next) focus(() => noticeRef.current); };
  const focusNew = () => focus(() => {
    const button = document.getElementById("feed-new");
    return button instanceof HTMLButtonElement && !button.disabled ? button : headingRef.current;
  });

  async function refreshList() {
    const after = await load();
    show(after ? { tone: "info", title: "Lista została odświeżona.", text: "Pokazuje stan potwierdzony przez serwer." }
      : { tone: "error", title: "Nie udało się odczytać listy.", text: "Sprawdź połączenie i spróbuj ponownie.",
          action: { label: "Odśwież listę", onClick: () => void refreshList() } });
  }

  function reveal(feed: IssuedFeed, rotated: boolean) {
    setIssued({ feed, rotated });
    setCopy("idle");
    setNotice(null);
    setView("issued");
    focusHeading();
  }

  function openForm() {
    setView("create");
    setNotice(null);
    focus(() => document.getElementById("feed-label"));
  }
  function resetForm() {
    setLabel(""); setFieldError(null); setScope("FLEET"); setSelected([]); setScopeError(null);
  }
  function backToList() {
    setView("list"); resetForm();
    focusNew();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const error = labelError(label);
    const selectionError = vehicleSelectionError(scope, selected);
    setFieldError(error);
    setScopeError(selectionError);
    if (error || selectionError) { document.getElementById(error ? "feed-label" : "feed-vehicles")?.focus(); return; }
    const before = list?.items ?? [];
    setPending({ kind: "create" });
    setNotice(null);
    try {
      // "Cała flota" sends no vehicleIds; only an explicit selection narrows the address (#366).
      const result = await createFeed(context, label, scope === "VEHICLES" ? selected : null);
      if (result.ok) {
        resetForm();
        reveal(result.data, false);
        void load();
        return;
      }
      if (result.status === 400 && result.fieldErrors?.vehicleIds) {
        const code = result.fieldErrors.vehicleIds;
        // A vehicle unpublished or removed meanwhile: read the list again and keep only what is still there.
        if (code === "VEHICLE_NOT_PUBLISHED" || code === "VEHICLE_NOT_FOUND") {
          const fresh = await published.reload();
          if (fresh) setSelected((current) => keepKnown(current, fresh));
        }
        setScopeError(vehicleIdsErrorText(code));
        focus(() => document.getElementById("feed-vehicles"));
        return;
      }
      if (result.status === 400) {
        setFieldError("Etykieta jest za długa lub zawiera niedozwolone znaki.");
        document.getElementById("feed-label")?.focus();
        return;
      }
      if (result.status === 409 && result.code === "FEED_LIMIT_REACHED") {
        await load();
        setView("list");
        show({ tone: "warning", title: "Osiągnięto limit aktywnych adresów.", text: "Odwołaj nieużywany adres, aby utworzyć nowy." });
        return;
      }
      if (!isUncertain(result.status)) {
        show({ tone: "error", title: "Nie utworzono adresu.", text: failureText(result) });
        return;
      }
      // Unknown outcome: never a success and never a blind second POST; the list decides what happened.
      const after = await load();
      const created = after ? findUnseenCreated(before, after.items, label) : null;
      setView("list"); resetForm();
      if (created) {
        show({ tone: "warning", title: `Adres „${created.label}” powstał, ale nie dotarł do przeglądarki.`,
          text: "Nie można go odczytać ponownie. Obróć go, aby dostać nowy adres — nieodebrany przestanie działać.",
          action: { label: "Obróć adres", onClick: () => setConfirm({ kind: "rotate", item: created }) } });
      } else {
        show({ tone: "error", title: "Nie wiemy, czy adres został utworzony.",
          text: after
            ? "Serwer nie odpowiedział poprawnie (błąd 5xx lub brak połączenia). Lista nie pokazuje nowego adresu. Odśwież ją za chwilę; jeśli adres się pojawi, obróć go, bo jego treści nie odczytasz ponownie. Możesz też spróbować jeszcze raz."
            : "Serwer nie odpowiedział poprawnie (błąd 5xx lub brak połączenia). Nie pokazujemy sukcesu i nie ma adresu do skopiowania. Odśwież listę: jeśli nowy adres się pojawił, obróć go.",
          action: { label: "Odśwież listę", onClick: () => void refreshList() } });
      }
    } finally { setPending(null); }
  }

  async function rotate(item: FeedItem) {
    const before = list?.items ?? [];
    setPending({ kind: "rotate", id: item.id });
    setNotice(null);
    try {
      const result = await rotateFeed(context, item.id);
      if (result.ok) { reveal(result.data, true); void load(); return; }
      if (result.status === 404) {
        await load();
        show({ tone: "info", title: "Ten adres nie jest już aktywny.", text: "Wygasł, został odwołany albo obrócony. Lista została odświeżona." });
        return;
      }
      if (!isUncertain(result.status)) { show({ tone: "error", title: "Nie obrócono adresu.", text: failureText(result) }); return; }
      const after = await load();
      const outcome = after ? findUnseenRotated(before, after.items, item) : null;
      if (outcome === "not-rotated") {
        show({ tone: "error", title: "Adres nie został obrócony.", text: "Dotychczasowy adres nadal działa. Spróbuj ponownie.",
          action: { label: "Obróć ponownie", onClick: () => setConfirm({ kind: "rotate", item }) } });
      } else if (outcome) {
        show({ tone: "warning", title: "Adres obrócono, ale nowy nie dotarł do przeglądarki.",
          text: "Poprzedni adres już nie działa. Obróć adres jeszcze raz, aby dostać nowy do aplikacji kalendarza.",
          action: { label: "Obróć ponownie", onClick: () => setConfirm({ kind: "rotate", item: outcome }) } });
      } else {
        show({ tone: "error", title: "Nie wiemy, czy adres został obrócony.",
          text: "Nie pokazujemy sukcesu i nie ma adresu do skopiowania. Odśwież listę i sprawdź jego stan.",
          action: { label: "Odśwież listę", onClick: () => void refreshList() } });
      }
    } finally { setPending(null); }
  }

  async function revoke(item: FeedItem) {
    setPending({ kind: "revoke", id: item.id });
    setNotice(null);
    try {
      const result = await revokeFeed(context, item.id);
      if (result.ok) {
        await load();
        show({ tone: "success", title: `Odwołano adres „${item.label}”.`, text: "Adres przestał działać." });
        return;
      }
      if (result.status === 404) {
        await load();
        show({ tone: "info", title: "Tego adresu nie ma już na liście.", text: "Lista została odświeżona." });
        return;
      }
      if (!isUncertain(result.status)) { show({ tone: "error", title: "Nie odwołano adresu.", text: failureText(result) }); return; }
      // DELETE is safe to repeat (contract): the list confirms it, otherwise a plain retry is offered.
      const after = await load();
      if (after && revokedOnList(after.items, item.id)) {
        show({ tone: "success", title: `Odwołano adres „${item.label}”.`, text: "Potwierdzone odczytem listy z serwera." });
      } else {
        show({ tone: "error", title: "Nie wiemy, czy adres został odwołany.",
          text: after ? "Lista nadal pokazuje go jako aktywny. Ponowienie jest bezpieczne." : "Nie udało się odczytać listy. Ponowienie jest bezpieczne.",
          action: { label: "Ponów odwołanie", onClick: () => void revoke(item) } });
      }
    } finally { setPending(null); }
  }

  async function copyAddress() {
    if (!issued) return;
    let ok = false;
    try { await navigator.clipboard.writeText(issued.feed.url); ok = true; } catch { ok = legacyCopy(issued.feed.url); }
    setCopy(ok ? "copied" : "failed");
  }

  function closeIssued() {
    setIssued(null);
    setCopy("idle");
    setView("list");
    focusNew();
  }

  function confirmAction() {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.kind === "rotate") void rotate(current.item);
    else void revoke(current.item);
  }

  const atLimit = list ? limitReached(list) : false;
  const items = list?.items ?? [];
  const expiring = items.filter((item) => expiresSoon(item, now));
  const heading = view === "create" ? "Nowy adres kalendarza" : view === "issued" ? "Adres kalendarza" : "Kalendarz zewnętrzny";
  const lead = view === "create" ? "Adres pokażemy tylko raz, zaraz po utworzeniu."
    : view === "issued" ? "Skopiuj adres teraz. Nie pokażemy go ponownie."
    : companyName ? `Adresy kalendarza firmy ${companyName}. Widok superadmina.`
    : "Prywatny adres kalendarza (iCal) dla Twojej aplikacji. Pokazuje tylko „Niedostępny”.";

  const header = <PageHeader trail={trail} title={heading} description={lead} headingRef={headingRef} />;
  const content = (
    <>
      <div ref={noticeRef} tabIndex={-1} className={styles.notice} role="status" aria-live="polite">
        {notice && <Alert tone={notice.tone} title={notice.title} action={notice.action}>{notice.text}</Alert>}
      </div>

      {view === "issued" && issued && (
        <>
          <Alert tone="success" title={issued.rotated ? `Adres „${issued.feed.label}” został obrócony` : `Adres „${issued.feed.label}” został utworzony`}>
            {issued.rotated ? "Poprzedni adres już nie działa. " : ""}Wklej nowy adres w aplikacji kalendarza jako subskrypcję
            z adresu URL. Aplikacja odświeża dane sama: Kalendarz Google co kilka godzin, Apple co 5–60 minut.
          </Alert>
          <section className={styles.card} aria-labelledby="feed-url-heading">
            <h3 id="feed-url-heading">Twój adres kalendarza</h3>
            <label className={styles.visuallyHidden} htmlFor="feed-url">Adres kalendarza (iCal)</label>
            <textarea id="feed-url" className={styles.url} readOnly rows={3} value={issued.feed.url}
              spellCheck={false} autoComplete="off" onFocus={(event) => event.currentTarget.select()} />
            <div className={styles.actions}>
              <Button icon={copy === "copied" ? <Check size={16} /> : <Copy size={16} />} onClick={() => void copyAddress()}>
                Kopiuj adres
              </Button>
            </div>
            <p role="status" className={styles.copyStatus}>
              {copy === "copied" && <><Check aria-hidden="true" size={16} /> Skopiowano do schowka</>}
              {copy === "failed" && "Nie udało się skopiować. Zaznacz adres w polu i skopiuj go ręcznie."}
            </p>
            <Alert tone="warning" title="Adres pokazujemy tylko raz.">
              Po zamknięciu tego widoku nie odczytasz go ponownie, bo zapisujemy tylko jego skrót. Jeśli go zgubisz, obróć
              adres i dostaniesz nowy.
            </Alert>
            <p className={styles.hint}>
              Traktuj adres jak hasło: każdy, kto go ma, widzi zajętość floty (bez typu blokady). Odwołasz go w dowolnej
              chwili z listy adresów.
            </p>
            <div className={styles.actions}>
              <Button variant={copy === "copied" ? "primary" : "secondary"} onClick={closeIssued}>
                {copy === "copied" ? "Gotowe" : "Zamknij"}
              </Button>
            </div>
          </section>
        </>
      )}

      {view === "create" && (
        <form className={styles.card} onSubmit={(event) => void submit(event)} noValidate aria-labelledby="feed-create">
          <h3 id="feed-create">Nowy adres kalendarza</h3>
          {(fieldError || scopeError) && (
            <Alert tone="error" title={`Do poprawy: ${[fieldError, scopeError].filter(Boolean).length}`}>
              <ul className={styles.summary}>
                {fieldError && <li><a href="#feed-label" onClick={(event) => { event.preventDefault(); document.getElementById("feed-label")?.focus(); }}>Etykieta</a>: {fieldError}</li>}
                {scopeError && <li><a href="#feed-vehicles" onClick={(event) => { event.preventDefault(); document.getElementById("feed-vehicles")?.focus(); }}>Pojazdy</a>: {scopeError}</li>}
              </ul>
            </Alert>
          )}
          <FormField id="feed-label" label="Etykieta" error={fieldError ?? undefined}
            hint={`Pomaga rozpoznać adres na liście. Do ${LABEL_MAX} znaków.`}>
            <TextInput value={label} required autoComplete="off" onChange={(event) => setLabel(event.target.value)} />
          </FormField>
          <FeedScopeFields scope={scope} selected={selected} vehicles={published.state} error={scopeError}
            disabled={pending?.kind === "create"} onRetry={() => void published.reload()}
            onScope={(next) => { setScope(next); setScopeError(null); }}
            onSelected={(ids) => { setSelected(ids); setScopeError(null); }} />
          <p className={styles.hint}>
            Ważność: {list?.validityDays ?? 365} dni od utworzenia. Kalendarz pokazuje tylko „Niedostępny”: bez typu blokady,
            numeru odniesienia i notatek.
          </p>
          <div className={styles.formActions}>
            <Button type="submit" loading={pending?.kind === "create"} loadingLabel="Tworzenie adresu">Utwórz adres</Button>
            <Button variant="secondary" onClick={backToList} disabled={pending?.kind === "create"}>Anuluj</Button>
          </div>
        </form>
      )}

      {view === "list" && (
        <>
          {companyName && (
            <Alert tone="info" title={`Jesteś w kontekście firmy ${companyName} jako superadmin`}>
              Możesz przeglądać adresy kalendarza firmy i je odwoływać. Tworzenie nowych adresów i rotacja są dostępne
              tylko dla administratora firmy.
            </Alert>
          )}
          {expiring.map((item) => (
            <Alert key={item.id} tone="warning" title={`Adres „${item.label}” wygasa ${daysText(daysLeft(item, now) ?? 0)}`}>
              Wygasa {formatDate(item.expiresAt)}.{" "}
              {context.canManage
                ? "Obróć go przed wygaśnięciem i zaktualizuj aplikację kalendarza, bo po tej dacie aplikacja przestanie się odświeżać bez komunikatu."
                : "Administrator firmy może go obrócić przed wygaśnięciem."}
            </Alert>
          ))}

          {phase === "ready" && list && atLimit && context.canManage && (
            <Alert tone="warning" title={`Osiągnięto limit ${list.activeLimit} aktywnych adresów`}>
              Odwołaj nieużywany adres, aby utworzyć nowy. Wygasłe i odwołane adresy nie wliczają się do limitu.
            </Alert>
          )}

          {phase === "loading" && <p role="status">Wczytywanie adresów…</p>}
          {phase === "error" && (
            <Alert tone="error" title="Nie udało się wczytać adresów kalendarza." action={{ label: "Spróbuj ponownie", onClick: () => void load() }}>
              Nic nie zostało zmienione.
            </Alert>
          )}

          {phase === "ready" && list && (
            <section className={styles.card} aria-labelledby="feed-list">
              <div className={styles.listHeader}>
                <div>
                  <h3 id="feed-list">Adresy kalendarza</h3>
                  <p className={styles.count}>Aktywne adresy: {list.activeCount} z {list.activeLimit}</p>
                </div>
                {context.canManage && items.length > 0 && (
                  <div className={styles.createBar}>
                    <Button id="feed-new" onClick={openForm} disabled={atLimit} aria-describedby={atLimit ? "feed-limit" : undefined}>
                      {atLimit ? `Nowy adres (limit ${list.activeLimit})` : "Nowy adres kalendarza"}
                    </Button>
                    {atLimit && (
                      <p id="feed-limit" className={styles.limit}>
                        Masz {list.activeCount} z {list.activeLimit} aktywnych adresów. Odwołaj nieużywany, aby utworzyć nowy.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {items.length === 0 ? (
                <div className={styles.empty}>
                  <p><strong>Nie ma jeszcze adresów kalendarza.</strong></p>
                  <p>
                    {context.canManage
                      ? "Utwórz adres i dodaj go w Kalendarzu Google, Apple lub Outlook, aby widzieć dni „Niedostępny” opublikowanych pojazdów."
                      : "Administrator firmy nie utworzył jeszcze żadnego adresu."}
                  </p>
                  <ul className={styles.emptyFacts}>
                    <li><Check aria-hidden="true" size={16} />Tylko pojazdy opublikowane</li>
                    <li><Check aria-hidden="true" size={16} />Adres działa {list.validityDays} dni</li>
                    <li><Check aria-hidden="true" size={16} />Do {list.activeLimit} aktywnych adresów</li>
                  </ul>
                  {context.canManage && (
                    <Button id="feed-new" onClick={openForm} disabled={atLimit}>Utwórz pierwszy adres</Button>
                  )}
                </div>
              ) : (
                <ul className={styles.list}>
                  {items.map((item) => {
                    const Icon = statusIcons[item.status];
                    const busy = pending !== null && "id" in pending && pending.id === item.id;
                    return (
                      <li key={item.id} className={styles.item} data-status={item.status}>
                        <div className={styles.itemText}>
                          <h4>{item.label}</h4>
                          <p className={styles.itemState}>
                            <span className={styles.status} data-status={item.status}>
                              <Icon aria-hidden="true" size={16} />{statusLabels[item.status]}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Zakres: {scopeText(item)}</span>
                          </p>
                          <p className={styles.meta}>{metaLine(item, now)}</p>
                          <FeedScopeVehicles item={item} />
                        </div>
                        {item.status === "ACTIVE" && (
                          <div className={styles.itemActions}>
                            {context.canManage && (
                              <Button variant="secondary" icon={<RefreshCw size={16} />} disabled={pending !== null}
                                loading={busy && pending?.kind === "rotate"} loadingLabel={`Obracanie adresu ${item.label}`}
                                aria-label={`Obróć adres ${item.label}`} onClick={() => setConfirm({ kind: "rotate", item })}>
                                Obróć
                              </Button>
                            )}
                            <Button variant="secondary" icon={<Ban size={16} />} disabled={pending !== null}
                              loading={busy && pending?.kind === "revoke"} loadingLabel={`Odwoływanie adresu ${item.label}`}
                              aria-label={`Odwołaj adres ${item.label}`} onClick={() => setConfirm({ kind: "revoke", item })}>
                              Odwołaj
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <div className={styles.info}>
            <Info aria-hidden="true" size={20} />
            <p>
              Kalendarz Google odświeża subskrypcję co kilka godzin, Apple co 5–60 minut. O dostępności rozstrzyga panel.
              Feed pokazuje tylko „Niedostępny” dla opublikowanych pojazdów.
            </p>
          </div>
          {phase === "ready" && items.length > 0 && (
            <p className={styles.hint}>Feed nie zawiera typu blokady, numeru odniesienia ani notatek.</p>
          )}
        </>
      )}

      <Dialog
        open={confirm?.kind === "rotate"}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        type="confirm"
        title={`Obrócić adres „${confirm?.item.label ?? ""}”?`}
        description={`Dostaniesz nowy adres ważny ${list?.validityDays ?? 365} dni. Obecny adres przestanie działać od razu — podmień go w każdej aplikacji kalendarza, która go subskrybuje.`}
        primaryAction={{ label: "Obróć adres", onClick: confirmAction }}
        secondaryAction={{ label: "Anuluj", onClick: () => setConfirm(null) }}
      />
      <Dialog
        open={confirm?.kind === "revoke"}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        type="destructive"
        title={`Odwołać adres „${confirm?.item.label ?? ""}”?`}
        description="Adres przestanie działać od razu, a aplikacje kalendarza z tą subskrypcją przestaną się odświeżać. Kopie w aplikacjach mogą pokazywać stare dane do czasu odświeżenia."
        primaryAction={{ label: "Odwołaj adres", onClick: confirmAction }}
      >
        <Alert tone="warning" title="Tej operacji nie można cofnąć">Nowy adres utworzysz osobno.</Alert>
      </Dialog>
    </>
  );

  if (!nav) {
    return (
      <div className={styles.screen}>
        {header}
        {content}
      </div>
    );
  }
  return (
    <div className={settingsStyles.page}>
      {header}
      <div className={settingsStyles.layout}>
        {nav}
        <div className={styles.screen}>{content}</div>
      </div>
    </div>
  );
}
