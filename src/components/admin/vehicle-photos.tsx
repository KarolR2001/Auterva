"use client";

import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Clock, ImagePlus, LoaderCircle, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ACCEPT_ATTRIBUTE, checkImageFile, consumedKeyCodes, sendImage, uploadErrors } from "../media/upload-core";
import { newEventKey } from "../settings/settings-model";
import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import {
  deleteImage, imageErrorMessage, imagesUrl, patchImage, readVehicle, reorderImages,
  type ApiResult, type PanelContext, type VehicleImage,
} from "./fleet-api";
import styles from "./vehicle-photos.module.css";

export const MAX_VEHICLE_IMAGES = 30;
const POLL_MS = 2_000;
const SLOW_AFTER_MS = 90_000;

/** One file of the upload queue. `key` is the Idempotency-Key of the current attempt. */
type QueueItem = {
  id: string; file: File; key: string; since: number; progress: number; error?: string;
  state: "queued" | "uploading" | "processing" | "slow" | "failed" | "uncertain";
  /** A retry is offered only where it can help: not for a file the server will always refuse. */
  retryable: boolean; imageId?: string;
};

const fatalCodes = new Set(["IMAGE_TOO_LARGE_OR_EMPTY", "INVALID_IMAGE", "IMAGE_TOO_COMPLEX", "MEDIA_IMAGE_LIMIT", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"]);
const photoErrors: Record<string, string> = { ...uploadErrors, MEDIA_IMAGE_LIMIT: "Osiągnięto limit 30 zdjęć pojazdu. Usuń jedno, aby dodać kolejne." };
const sizeText = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1).replace(".", ",")} MB`;
type Notice = { tone: "success" | "error" | "warning" | "info"; title: string; text?: string } | null;

type Props = {
  context: PanelContext;
  vehicleId: string;
  /** The published vehicle must keep a cover, so the last cover cannot simply be deleted. */
  published: boolean;
  /** Archived vehicles accept no photo change (the server answers FLEET_ARCHIVED). */
  readOnly: boolean;
  images: VehicleImage[];
  onImages: (images: VehicleImage[]) => void;
};

/**
 * Photos of one vehicle (ADM-07, FR-ADM-040–046): multi-file upload with per-file progress and retry, cover, order with
 * buttons (no drag-only), alt text and confirmed deletion. Every shown state comes from the server; the same component
 * serves the company admin and the superadmin through `context`.
 */
export function VehiclePhotos({ context, vehicleId, published, readOnly, images, onImages }: Props) {
  const ready = useMemo(() => images.filter((image) => image.status === "READY"), [images]);
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<VehicleImage | null>(null);
  const [replacement, setReplacement] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const focusId = useRef<string | null>(null);
  const pumping = useRef(false);
  const imagesRef = useRef(ready);
  const hintId = useId();
  const statusId = useId();
  useEffect(() => { imagesRef.current = ready; }, [ready]);

  const setQueue = useCallback((next: (current: QueueItem[]) => QueueItem[]) => {
    queueRef.current = next(queueRef.current);
    setQueueState(queueRef.current);
  }, []);
  const patch = useCallback((id: string, change: Partial<QueueItem>) =>
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item))), [setQueue]);

  const activeUploads = queue.filter((item) => item.state !== "failed").length;
  const slotsLeft = Math.max(0, MAX_VEHICLE_IMAGES - ready.length - queue.filter((item) => item.state !== "failed").length);
  const dirtyIds = ready.filter((image) => alts[image.id] !== undefined && alts[image.id] !== image.alt).map((image) => image.id);

  /** The truth is the server's list; drafts of untouched photos survive, a saved or removed one loses its draft. */
  const refresh = useCallback(async (settled?: string): Promise<boolean> => {
    const result = await readVehicle(context, vehicleId);
    if (!result.ok) { setStale(true); return false; }
    setStale(false);
    const latest = result.data.images;
    onImages(latest);
    imagesRef.current = latest.filter((image) => image.status === "READY");
    setAlts((current) => Object.fromEntries(Object.entries(current)
      .filter(([id, text]) => id !== settled && latest.some((image) => image.id === id && image.alt !== text))));
    // A processed photo leaves the queue as soon as the list contains it.
    setQueue((items) => items.filter((item) => !(item.imageId && latest.some((image) => image.id === item.imageId))));
    return true;
  }, [context, vehicleId, onImages, setQueue]);

  /** Polls while a photo is being processed: it appears in the list only after the media worker stored it. */
  const waiting = queue.some((item) => item.state === "processing");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void refresh().then(() => setQueue((items) => items.map((item) =>
        item.state === "processing" && Date.now() - item.since > SLOW_AFTER_MS ? { ...item, state: "slow" } : item)));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh, setQueue]);

  async function sendOne(item: QueueItem) {
    patch(item.id, { state: "uploading", progress: 0, error: undefined });
    const result = await sendImage({ url: imagesUrl(context, vehicleId), file: item.file, key: item.key,
      onProgress: (fraction) => patch(item.id, { progress: fraction }) });
    if (result.kind === "accepted") {
      const imageId = result.body.imageId;
      const done = await refresh();
      const stored = imageId && imagesRef.current.some((image) => image.id === imageId);
      if (stored) { setQueue((items) => items.filter((entry) => entry.id !== item.id)); setNotice({ tone: "success", title: `Dodano zdjęcie: ${item.file.name}` }); return; }
      if (!imageId) { patch(item.id, { state: "uncertain", error: "Serwer przyjął plik, ale nie podał identyfikatora. Sprawdź listę.", retryable: true }); return; }
      patch(item.id, { state: "processing", since: Date.now(), imageId, progress: 1 });
      if (!done) setNotice({ tone: "warning", title: "Nie udało się odświeżyć listy zdjęć", text: "Plik został przyjęty. Lista odświeży się automatycznie." });
    } else if (result.kind === "uncertain") {
      patch(item.id, { state: "uncertain", retryable: true,
        error: "Wynik wysyłania jest nieznany: zdjęcie mogło zostać przyjęte. Ponowienie tego samego pliku jest bezpieczne i nie utworzy duplikatu." });
      await refresh();
    } else {
      const consumed = consumedKeyCodes.has(result.code);
      patch(item.id, { state: "failed", retryable: !fatalCodes.has(result.code), key: consumed ? newEventKey() : item.key,
        error: (photoErrors[result.code] ?? "Nie udało się wysłać zdjęcia.") + (result.retryAfter ? ` Spróbuj za ${result.retryAfter} s.` : "") });
    }
  }

  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = queueRef.current.find((item) => item.state === "queued");
        if (!next) break;
        await sendOne(next);
      }
    } finally { pumping.current = false; }
  }

  /** Limits are checked per file before any request; the rest of the selection is still sent. */
  function choose(files: FileList | null) {
    if (!files || files.length === 0) return;
    let slots = slotsLeft;
    const added: QueueItem[] = [];
    for (const file of Array.from(files)) {
      const problem = checkImageFile(file);
      const base = { id: newEventKey(), file, since: 0, progress: 0, retryable: false };
      if (problem) { added.push({ ...base, key: "", state: "failed", error: problem.message }); continue; }
      if (slots <= 0) { added.push({ ...base, key: "", state: "failed", error: photoErrors.MEDIA_IMAGE_LIMIT }); continue; }
      slots -= 1;
      added.push({ ...base, key: newEventKey(), state: "queued" });
    }
    setQueue((current) => [...current, ...added]);
    setNotice(null);
    if (input.current) input.current.value = "";
    void pump();
  }

  function retry(item: QueueItem) {
    patch(item.id, { state: "queued", error: undefined });
    void pump();
  }

  async function checkAgain() {
    const ok = await refresh();
    setNotice(ok ? { tone: "info", title: "Odświeżono listę zdjęć" } : { tone: "error", title: "Nie udało się odświeżyć listy", text: "Sprawdź połączenie i spróbuj ponownie." });
  }

  const unknown = (what: string) => setNotice({ tone: "error", title: `Wynik operacji jest nieznany: ${what}`,
    text: "Odświeżono listę z serwera. Sprawdź stan zdjęć i w razie potrzeby powtórz zmianę." });

  /** Runs one mutation under the busy lock; the list is read again afterwards so the cover and order are the server's. */
  async function mutate<T>(label: string, call: () => Promise<ApiResult<T>>, done: string, settled?: string): Promise<ApiResult<T>> {
    setBusy(label);
    setNotice(null);
    const result = await call();
    if (result.ok) {
      const refreshed = await refresh(settled);
      setNotice(refreshed ? { tone: "success", title: done }
        : { tone: "warning", title: `${done} Nie udało się odświeżyć listy.`, text: "Użyj „Odśwież listę”, aby zobaczyć aktualny stan." });
    } else if (result.status === 0 || result.status >= 500) {
      await refresh(); unknown(label);
    } else {
      if (result.code === "MEDIA_VERSION_CONFLICT" || result.code === "NOT_FOUND" || result.code === "MEDIA_REPLACEMENT_INVALID") await refresh();
      setNotice({ tone: "error", title: "Zmiana nie została zapisana", text: imageErrorMessage(result.code) });
    }
    setBusy(null);
    return result;
  }

  async function saveAlt(image: VehicleImage): Promise<boolean> {
    const draft = alts[image.id] ?? image.alt;
    const result = await mutate("zapis opisu", () => patchImage(context, vehicleId, image.id, image.version, { alt: draft.trim() === "" ? null : draft }),
      "Zapisano opis zdjęcia.", image.id);
    return result.ok;
  }

  async function setCover(image: VehicleImage) {
    const result = await mutate("zmiana zdjęcia głównego", () => patchImage(context, vehicleId, image.id, image.version, { isCover: true }), "Zmieniono zdjęcie główne.");
    if (result.ok) focusId.current = `vp-${ready[0]?.id === image.id ? "down" : "up"}-${image.id}`;
  }

  async function move(image: VehicleImage, direction: -1 | 1) {
    const index = ready.findIndex((entry) => entry.id === image.id);
    const target = index + direction;
    if (target < 0 || target >= ready.length) return;
    const order = [...ready];
    order.splice(index, 1);
    order.splice(target, 0, image);
    const result = await mutate("zmiana kolejności", () => reorderImages(context, vehicleId, order.map((entry) => ({ id: entry.id, expectedVersion: entry.version }))),
      `Zdjęcie przesunięto na pozycję ${target + 1} z ${ready.length}.`);
    if (result.ok) focusId.current = `vp-${direction < 0 ? (target === 0 ? "down" : "up") : (target === ready.length - 1 ? "up" : "down")}-${image.id}`;
  }

  function askRemove(image: VehicleImage) {
    const others = ready.filter((entry) => entry.id !== image.id);
    setReplacement(others[0]?.id ?? "");
    setDialogError(null);
    setRemoving(image);
  }

  async function confirmRemove() {
    const image = removing;
    if (!image) return;
    const others = ready.filter((entry) => entry.id !== image.id);
    const needsReplacement = image.isCover && published && others.length > 0;
    setBusy("usuwanie");
    setDialogError(null);
    const result = await deleteImage(context, vehicleId, image.id, image.version, needsReplacement ? replacement : undefined);
    if (result.ok) {
      setRemoving(null);
      const refreshed = await refresh(image.id);
      setBusy(null);
      setNotice(refreshed ? { tone: "success", title: "Usunięto zdjęcie." } : { tone: "warning", title: "Usunięto zdjęcie. Nie udało się odświeżyć listy.", text: "Użyj „Odśwież listę”." });
      setTimeout(() => headingRef.current?.focus(), 50);
      return;
    }
    if (result.status === 0 || result.status >= 500) { setRemoving(null); await refresh(); setBusy(null); unknown("usuwanie zdjęcia"); return; }
    if (result.code === "MEDIA_VERSION_CONFLICT" || result.code === "NOT_FOUND" || result.code === "MEDIA_REPLACEMENT_INVALID") {
      setRemoving(null); await refresh(); setBusy(null);
      setNotice({ tone: "error", title: "Zdjęcie nie zostało usunięte", text: imageErrorMessage(result.code) });
      return;
    }
    setBusy(null);
    setDialogError(imageErrorMessage(result.code));
  }

  // The shell guard asks for a save before leaving; active uploads cannot be saved, so they stop the leaving instead.
  const saveAll = async () => {
    if (queueRef.current.some((item) => item.state !== "failed")) {
      setNotice({ tone: "warning", title: "Wysyłanie zdjęć trwa", text: "Poczekaj na koniec wysyłania albo usuń pliki z kolejki, zanim opuścisz formularz." });
      throw new Error("PHOTO_UPLOAD_ACTIVE");
    }
    for (const id of dirtyIds) {
      const image = imagesRef.current.find((entry) => entry.id === id);
      if (image && !(await saveAlt(image))) throw new Error("PHOTO_SAVE_FAILED");
    }
  };
  useUnsavedChanges({ dirty: dirtyIds.length > 0 || activeUploads > 0, saving: busy !== null, contextLabel: "zdjęcia pojazdu",
    save: dirtyIds.length > 0 ? saveAll : undefined });

  // Focus returns to the control that moved after the list is rendered again.
  useEffect(() => {
    if (!focusId.current) return;
    const element = document.getElementById(focusId.current);
    focusId.current = null;
    if (element && !(element as HTMLButtonElement).disabled) element.focus();
  }, [images]);

  const lastCover = removing?.isCover && published && ready.length === 1;
  const needsReplacement = Boolean(removing?.isCover && published && ready.length > 1);
  const remaining = ready.filter((entry) => entry.id !== removing?.id);

  return (
    <div className={styles.photos}>
      <h4 className={styles.heading} tabIndex={-1} ref={headingRef}>Zdjęcia pojazdu ({ready.length} z {MAX_VEHICLE_IMAGES})</h4>
      <p className={styles.hint} id={hintId}>
        Pliki JPEG, PNG lub WebP, do 10 MB każdy, najwyżej {MAX_VEHICLE_IMAGES} zdjęć na pojazd{readOnly ? "" : ` (zostało ${slotsLeft})`}.
        Do publikacji potrzebne jest co najmniej jedno gotowe zdjęcie oznaczone jako główne. Kolejność zmienisz przyciskami.
      </p>
      <div className={styles.live} id={statusId} aria-live="polite">
        {notice && <Alert tone={notice.tone} title={notice.title} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
        {stale && <Alert tone="warning" title="Lista zdjęć może być nieaktualna" action={{ label: "Odśwież listę", onClick: () => void checkAgain() }}>Nie udało się odczytać aktualnego stanu z serwera.</Alert>}
      </div>

      {!readOnly && (
        <div className={styles.actions}>
          <input ref={input} className={styles.srOnly} type="file" multiple accept={ACCEPT_ATTRIBUTE} tabIndex={-1} aria-hidden="true"
            data-testid="vehicle-photo-input" onChange={(event) => choose(event.target.files)} />
          <Button variant="secondary" icon={<ImagePlus aria-hidden="true" size={18} />} aria-describedby={hintId} disabled={slotsLeft === 0}
            onClick={() => input.current?.click()}>Dodaj zdjęcia</Button>
          <Button variant="tertiary" disabled={busy !== null} onClick={() => void checkAgain()}>Odśwież listę</Button>
        </div>
      )}

      {queue.length > 0 && (
        <ul className={styles.queue} aria-label="Kolejka wysyłania zdjęć">
          {queue.map((item) => (
            <li key={item.id} className={styles.queueItem} data-state={item.state}>
              <div className={styles.queueMain}>
                <span className={styles.fileName}>{item.file.name}</span>
                <span className={styles.meta}>{sizeText(item.file.size)}</span>
              </div>
              <p className={styles.state}>
                {item.state === "failed" || item.state === "uncertain" ? <CircleAlert aria-hidden="true" size={16} />
                  : item.state === "queued" ? <Clock aria-hidden="true" size={16} />
                    : <LoaderCircle aria-hidden="true" size={16} className={styles.spin} />}
                <span>{item.state === "queued" ? "Czeka na wysłanie"
                  : item.state === "uploading" ? `Wysyłanie: ${Math.round(item.progress * 100)}%`
                    : item.state === "processing" ? "Przetwarzanie zdjęcia…"
                      : item.state === "slow" ? "Przetwarzanie trwa dłużej niż zwykle. Zdjęcie pojawi się na liście po zakończeniu."
                        : item.state === "uncertain" ? "Wynik nieznany" : "Nie wysłano"}</span>
              </p>
              {item.state === "uploading" && <progress className={styles.progress} max={100} value={Math.round(item.progress * 100)} aria-label={`Wysyłanie ${item.file.name}`} />}
              {item.error && <p className={styles.error}>{item.error}</p>}
              <div className={styles.rowActions}>
                {(item.state === "failed" || item.state === "uncertain") && item.retryable && (
                  <Button size="sm" variant="secondary" onClick={() => retry(item)}>Spróbuj ponownie<span className={styles.srOnly}>: {item.file.name}</span></Button>
                )}
                {item.state === "slow" && <Button size="sm" variant="secondary" onClick={() => void checkAgain()}>Sprawdź ponownie<span className={styles.srOnly}>: {item.file.name}</span></Button>}
                {(item.state === "failed" || item.state === "uncertain" || item.state === "slow" || item.state === "queued") && (
                  <Button size="sm" variant="tertiary" onClick={() => setQueue((items) => items.filter((entry) => entry.id !== item.id))}>Usuń z kolejki<span className={styles.srOnly}>: {item.file.name}</span></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {ready.length === 0 ? <p className={styles.hint}>Brak gotowych zdjęć.</p> : (
        <ol className={styles.list} aria-label="Gotowe zdjęcia pojazdu">
          {ready.map((image, index) => {
            const label = `zdjęcie ${index + 1}`;
            const draft = alts[image.id] ?? image.alt;
            const dirty = draft !== image.alt;
            return (
              <li key={image.id} className={styles.item}>
                {/* eslint-disable-next-line @next/next/no-img-element -- protected preview variant, never the optimizer */}
                <img src={image.urls.thumb} alt={image.alt} width={160} height={107} className={styles.thumb} loading="lazy" />
                <div className={styles.body}>
                  <p className={styles.itemHead}>
                    <strong>Zdjęcie {index + 1} z {ready.length}</strong>
                    {image.isCover && <span className={styles.cover}><Star aria-hidden="true" size={14} />Główne</span>}
                  </p>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`vp-alt-${image.id}`}>Opis alternatywny ({label}) <span className={styles.optional}>(opcjonalnie)</span></label>
                    <input id={`vp-alt-${image.id}`} className={styles.control} type="text" maxLength={200} value={draft} disabled={readOnly}
                      aria-describedby={`vp-alt-hint-${image.id}`} onChange={(event) => setAlts((current) => ({ ...current, [image.id]: event.target.value }))} />
                    <p className={styles.hint} id={`vp-alt-hint-${image.id}`}>Do 200 znaków, bez znaczników. Puste pole przywraca opis domyślny z nazwy pojazdu.</p>
                  </div>
                  {!readOnly && (
                    <div className={styles.rowActions}>
                      {dirty && <Button size="sm" variant="secondary" disabled={busy !== null} loading={busy === "zapis opisu"} loadingLabel="Zapisywanie"
                        onClick={() => void saveAlt(image)}>Zapisz opis<span className={styles.srOnly}>, {label}</span></Button>}
                      {!image.isCover && <Button id={`vp-cover-${image.id}`} size="sm" variant="secondary" disabled={busy !== null} icon={<Star aria-hidden="true" size={16} />}
                        onClick={() => void setCover(image)}>Ustaw jako główne<span className={styles.srOnly}>, {label}</span></Button>}
                      <Button id={`vp-up-${image.id}`} size="sm" variant="tertiary" disabled={busy !== null || index === 0} icon={<ArrowUp aria-hidden="true" size={16} />}
                        onClick={() => void move(image, -1)}>Przesuń wyżej<span className={styles.srOnly}>, {label}</span></Button>
                      <Button id={`vp-down-${image.id}`} size="sm" variant="tertiary" disabled={busy !== null || index === ready.length - 1} icon={<ArrowDown aria-hidden="true" size={16} />}
                        onClick={() => void move(image, 1)}>Przesuń niżej<span className={styles.srOnly}>, {label}</span></Button>
                      <Button size="sm" variant="tertiary" disabled={busy !== null} icon={<Trash2 aria-hidden="true" size={16} />}
                        onClick={() => askRemove(image)}>Usuń<span className={styles.srOnly}>, {label}</span></Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {ready.length > 0 && !ready.some((image) => image.isCover) && (
        <p className={styles.error}><CircleAlert aria-hidden="true" size={16} />Żadne zdjęcie nie jest oznaczone jako główne. Wybierz „Ustaw jako główne”.</p>
      )}
      {ready.some((image) => image.isCover) && <p className={styles.ok}><CircleCheck aria-hidden="true" size={16} />Zdjęcie główne jest ustawione.</p>}

      <Dialog open={removing !== null} onOpenChange={(open) => { if (!open && busy !== "usuwanie") setRemoving(null); }}
        type={lastCover ? "info" : "destructive"}
        title={lastCover ? "Nie można usunąć jedynego zdjęcia" : "Usunąć zdjęcie?"}
        description={lastCover ? "To jedyne zdjęcie opublikowanego pojazdu i zarazem zdjęcie główne. Najpierw ukryj pojazd (cofnij publikację), potem usuń zdjęcie."
          : removing?.isCover && !published && remaining.length > 0 ? "To zdjęcie główne. Pojazd nie jest opublikowany, więc kolejne zdjęcie zostanie głównym. Usunięcia nie można cofnąć."
            : removing?.isCover && published ? "To zdjęcie główne opublikowanego pojazdu. Wybierz zdjęcie, które je zastąpi. Usunięcia nie można cofnąć."
              : "Usunięcia nie można cofnąć. Zdjęcie przestanie być widoczne od razu."}
        primaryAction={lastCover ? { label: "Rozumiem", onClick: () => setRemoving(null) }
          : { label: busy === "usuwanie" ? "Usuwanie…" : "Usuń zdjęcie", onClick: () => void confirmRemove() }}
        secondaryAction={lastCover ? undefined : { label: "Anuluj", onClick: () => { if (busy !== "usuwanie") setRemoving(null); } }}>
        {needsReplacement && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="vp-replacement">Nowe zdjęcie główne</label>
            <select id="vp-replacement" className={styles.control} value={replacement} onChange={(event) => setReplacement(event.target.value)}>
              {remaining.map((entry) => <option key={entry.id} value={entry.id}>Zdjęcie {ready.findIndex((candidate) => candidate.id === entry.id) + 1}{entry.alt ? `: ${entry.alt}` : ""}</option>)}
            </select>
          </div>
        )}
        {dialogError && <p className={styles.error} role="alert"><CircleAlert aria-hidden="true" size={16} />{dialogError}</p>}
      </Dialog>
    </div>
  );
}
