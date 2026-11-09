"use client";

import { useRef, useState } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import { mediaKinds, newEventKey, type PublicMediaItem, type SettingsSnapshot } from "./settings-model";
import styles from "./settings.module.css";

const maxBytes = 10 * 1024 * 1024;
const accepted = ["image/jpeg", "image/png", "image/webp"];

type Notice = { tone: "success" | "error" | "info"; title: string; text?: string } | null;

const uploadErrors: Record<string, string> = {
  IMAGE_TOO_LARGE_OR_EMPTY: "Plik jest pusty albo większy niż 10 MB.",
  INVALID_IMAGE: "To nie jest poprawne zdjęcie JPEG, PNG lub WebP.",
  IMAGE_TOO_COMPLEX: "Zdjęcie jest zbyt duże lub złożone do przetworzenia.",
  MEDIA_IMAGE_LIMIT: "Osiągnięto limit zdjęć tego rodzaju. Usuń jedno, aby dodać kolejne.",
  RATE_LIMITED: "Za dużo prób. Poczekaj chwilę.",
  MEDIA_BUSY: "Przetwarzanie jest zajęte. Spróbuj za chwilę.",
  MEDIA_DECODER_UNAVAILABLE: "Przetwarzanie zdjęć jest chwilowo niedostępne. Spróbuj później.",
  FORBIDDEN: "Brak uprawnień do zmiany zdjęć.",
  NOT_FOUND: "Nie znaleziono firmy albo zasobu.",
};

function thumb(base: string, id: string) {
  return `${base}/media/${id}/thumb/`;
}

/**
 * Logo, hero and brand images of one company (superadmin only, D-01/D-22). Uploads go through the media
 * pipeline; a stored image may still be processing, so the list is refreshed from the protected read.
 */
export function MediaManager({ snapshot }: { snapshot: SettingsSnapshot }) {
  const [items, setItems] = useState<PublicMediaItem[]>(snapshot.media);
  const [drafts, setDrafts] = useState<Record<string, { alt: string; position: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const org = encodeURIComponent(snapshot.organizationId);
  const api = `/api/platform/companies/${org}`;
  const previewBase = `${api}/preview`;

  const pendingUpload = useRef<{ signature: string; key: string } | null>(null);

  const isDirty = (item: PublicMediaItem, draft: { alt: string; position: string } | undefined) =>
    draft !== undefined && (draft.alt !== (item.alt ?? "") || draft.position !== String(item.position ?? 0));
  const dirtyIds = items.filter((item) => isDirty(item, drafts[item.id])).map((item) => item.id);

  type PatchResult = "ok" | "conflict" | "invalid" | "error";
  async function patchItem(item: PublicMediaItem, draft: { alt: string; position: string }): Promise<PatchResult> {
    try {
      const response = await fetch(`${api}/public-media/${encodeURIComponent(item.id)}/`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: item.version ?? 0, eventKey: newEventKey(), alt: draft.alt, position: Number(draft.position) }),
      });
      if (response.ok) return "ok";
      if (response.status === 409) return "conflict";
      return response.status === 400 ? "invalid" : "error";
    } catch {
      return "error";
    }
  }

  // The guard of the panel shell calls this for "Zapisz i przejdź": every edited photo is saved, any failure aborts leaving.
  const saveAll = async () => {
    const edited = items.filter((item) => isDirty(item, drafts[item.id]));
    for (const item of edited) {
      const result = await patchItem(item, drafts[item.id]);
      if (result !== "ok") {
        setNotice({ tone: "error", title: "Nie zapisano wszystkich zdjęć", text: "Opis lub kolejność zdjęcia nie zostały zapisane. Dane pozostają w formularzu; popraw je i zapisz ponownie." });
        throw new Error("MEDIA_SAVE_FAILED");
      }
    }
    await refresh();
  };
  useUnsavedChanges({
    dirty: dirtyIds.length > 0,
    saving: busy !== null,
    contextLabel: "ustawienia — wygląd publiczny",
    save: dirtyIds.length > 0 ? saveAll : undefined,
  });

  // Keeps the drafts of photos the operation did not touch; only the saved or removed photo loses its draft.
  async function refresh(settled?: string): Promise<boolean> {
    try {
      const response = await fetch(`${api}/settings/`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("refresh");
      const latest = (await response.json()) as SettingsSnapshot;
      if (!Array.isArray(latest.media)) throw new Error("refresh");
      setItems(latest.media);
      setDrafts((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => id !== settled && latest.media.some((item) => item.id === id)),
      ));
      return true;
    } catch {
      setNotice({ tone: "error", title: "Nie udało się odświeżyć listy zdjęć", text: "Sprawdź połączenie i spróbuj ponownie. Niezapisane opisy pozostają w formularzu." });
      return false;
    }
  }

  async function upload(kind: string, file: File | undefined) {
    if (!file || busy) return;
    if (!accepted.includes(file.type)) return setNotice({ tone: "error", title: "Nieobsługiwany format", text: "Wybierz plik JPEG, PNG lub WebP." });
    if (file.size === 0 || file.size > maxBytes) return setNotice({ tone: "error", title: "Zły rozmiar pliku", text: uploadErrors.IMAGE_TOO_LARGE_OR_EMPTY });
    // One key per file and attempt: a retry of an uncertain upload reuses it, so the server never stores a duplicate.
    const signature = `${kind}:${file.name}:${file.size}:${file.lastModified}`;
    const key = pendingUpload.current?.signature === signature ? pendingUpload.current.key : newEventKey();
    pendingUpload.current = { signature, key };
    setBusy(`upload-${kind}`);
    setNotice(null);
    const uncertain = async () => {
      const refreshed = await refresh();
      setNotice({
        tone: "error",
        title: "Wynik wysyłania jest nieznany",
        text: refreshed
          ? "Sprawdź listę: zdjęcie mogło zostać przyjęte. Ponowne wybranie tego samego pliku jest bezpieczne i nie utworzy duplikatu."
          : "Nie udało się też odczytać listy. Odśwież ją przed ponowieniem; ponowne wybranie tego samego pliku nie utworzy duplikatu.",
      });
    };
    try {
      const response = await fetch(`${api}/public-media/${kind.toLowerCase()}/`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": file.type, "Idempotency-Key": key },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      if (response.ok) {
        pendingUpload.current = null;
        await refresh();
        setNotice(response.status === 202
          ? { tone: "info", title: "Zdjęcie jest przetwarzane", text: "Pojawi się na liście po zakończeniu. Użyj „Odśwież listę”." }
          : { tone: "success", title: "Dodano zdjęcie" });
      } else if (response.status >= 500 || response.status === 408) {
        await uncertain();
      } else {
        pendingUpload.current = null;
        setNotice({ tone: "error", title: "Nie udało się dodać zdjęcia", text: uploadErrors[body.code ?? ""] ?? "Spróbuj ponownie." });
      }
    } catch {
      await uncertain();
    } finally {
      setBusy(null);
      const input = inputs.current[kind];
      if (input) input.value = "";
    }
  }

  async function mutate(item: PublicMediaItem, init: { method: "PATCH" | "DELETE"; body: Record<string, unknown> }, done: string) {
    if (busy) return;
    setBusy(item.id);
    setNotice(null);
    try {
      let result: PatchResult;
      if (init.method === "PATCH") {
        result = await patchItem(item, { alt: String(init.body.alt ?? ""), position: String(init.body.position ?? 0) });
      } else {
        try {
          const response = await fetch(`${api}/public-media/${encodeURIComponent(item.id)}/`, {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedVersion: item.version ?? 0, eventKey: newEventKey() }),
          });
          result = response.ok ? "ok" : response.status === 409 ? "conflict" : response.status === 400 ? "invalid" : "error";
        } catch {
          result = "error";
        }
      }
      if (result === "ok") {
        await refresh(item.id);
        setConfirmDelete(null);
        setNotice({ tone: "success", title: done });
      } else if (result === "conflict") {
        setNotice({ tone: "error", title: "Zdjęcie zostało zmienione w międzyczasie", text: "Odśwież listę. Twoje wartości nie zostały zapisane, a pola zachowano." });
      } else if (result === "invalid") {
        setNotice({ tone: "error", title: "Popraw dane zdjęcia", text: "Opis alternatywny nie może zawierać znaczników i ma do 200 znaków; kolejność to liczba od 0 do 999." });
      } else {
        setNotice({ tone: "error", title: "Nie udało się zapisać zmiany", text: "Sprawdź połączenie i spróbuj ponownie. Pola zachowano." });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.panel} aria-label="Zdjęcia publiczne firmy">
      <h2>Logo i zdjęcia</h2>
      <p>Zdjęcia trafiają na publiczną stronę tej firmy po przetworzeniu. Kolory, fonty i ikony pozostają stałe.</p>
      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"}>
          <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>
        </div>
      )}
      {mediaKinds.map(({ kind, title, limit, hint }) => {
        const list = items.filter((item) => item.kind === kind);
        return (
          <div key={kind} className={styles.mediaGroup}>
            <h3>{title} ({list.length} z {limit})</h3>
            <p className={styles.status}>{hint}</p>
            {list.length === 0 && <p className={styles.empty}>Brak zdjęć tego rodzaju.</p>}
            <ul className={styles.mediaList}>
              {list.map((item) => {
                const draft = drafts[item.id] ?? { alt: item.alt ?? "", position: String(item.position ?? 0) };
                const label = `${title} ${item.position ?? 0}`;
                return (
                  <li key={item.id} className={styles.mediaItem}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- protected preview variant, not a public asset */}
                    <img src={thumb(previewBase, item.id)} alt={item.alt ?? ""} width={120} height={80} className={styles.thumb} loading="lazy" />
                    <div className={styles.mediaFields}>
                      <FormField id={`alt-${item.id}`} label={`Opis alternatywny (${label})`} optionalLabel="(opcjonalne)">
                        <TextInput value={draft.alt} maxLength={200} onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: { ...draft, alt: e.target.value } }))} />
                      </FormField>
                      {kind !== "LOGO" && (
                        <FormField id={`pos-${item.id}`} label={`Kolejność (${label})`} hint="Liczba od 0; mniejsza wyświetla się wcześniej.">
                          <TextInput inputMode="numeric" value={draft.position} onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: { ...draft, position: e.target.value } }))} />
                        </FormField>
                      )}
                      <div className={styles.actions}>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={busy === item.id}
                          disabled={busy !== null || !dirtyIds.includes(item.id)}
                          onClick={() => void mutate(item, { method: "PATCH", body: { alt: draft.alt, position: Number(draft.position) } }, "Zapisano zdjęcie")}
                        >
                          Zapisz opis i kolejność
                        </Button>
                        {confirmDelete === item.id ? (
                          <>
                            <Button type="button" variant="destructive" size="sm" disabled={busy !== null} onClick={() => void mutate(item, { method: "DELETE", body: {} }, "Usunięto zdjęcie")}>
                              Potwierdź usunięcie
                            </Button>
                            <Button type="button" variant="tertiary" size="sm" onClick={() => setConfirmDelete(null)}>Anuluj</Button>
                          </>
                        ) : (
                          <Button type="button" variant="tertiary" size="sm" disabled={busy !== null} onClick={() => setConfirmDelete(item.id)}>
                            Usuń ({label})
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className={styles.actions}>
              <input
                ref={(node) => { inputs.current[kind] = node; }}
                id={`upload-${kind}`}
                aria-label={`Wybierz plik: ${title}`}
                className={styles.srOnly}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy !== null}
                onChange={(e) => void upload(kind, e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="secondary"
                loading={busy === `upload-${kind}`}
                loadingLabel="Wysyłanie"
                disabled={busy !== null || (kind !== "LOGO" && list.length >= limit)}
                onClick={() => inputs.current[kind]?.click()}
              >
                {kind === "LOGO" && list.length ? "Zastąp logo" : `Dodaj: ${title.toLowerCase()}`}
              </Button>
            </div>
          </div>
        );
      })}
      <div className={styles.actions}>
        <Button type="button" variant="tertiary" disabled={busy !== null} onClick={() => void refresh()}>Odśwież listę</Button>
      </div>
    </section>
  );
}
