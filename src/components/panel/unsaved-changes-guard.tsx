"use client";

import { createContext, useContext, useEffect, useId, useRef } from "react";

// Seam for a full-page navigation (jsdom cannot navigate, tests spy on it).
export const navigation = {
  assign: (href: string) => window.location.assign(href),
};

export type GuardEntry = {
  dirty: boolean;
  saving?: boolean;
  save?: () => void | Promise<void>;
  contextLabel?: string;
  /** The unsent entry stays stored on this device, so leaving does not discard it (e.g. a chat message). */
  keepsEntry?: boolean;
};

export type GuardState = "free" | "dirty" | "busy";

export type GuardRegistry = {
  register: (id: string, entry: GuardEntry | null) => void;
  state: () => GuardState;
  save: () => Promise<void> | undefined;
  hasSave: () => boolean;
  label: () => string | undefined;
  keepsEntry: () => boolean;
};

export function createGuardRegistry(): GuardRegistry {
  const entries = new Map<string, GuardEntry>();
  const active = () =>
    [...entries.values()].filter((entry) => entry.dirty || entry.saving);
  return {
    register(id, entry) {
      if (entry && (entry.dirty || entry.saving)) entries.set(id, entry);
      else entries.delete(id);
    },
    state() {
      const list = active();
      if (list.some((entry) => entry.saving)) return "busy";
      return list.length ? "dirty" : "free";
    },
    hasSave: () => active().some((entry) => entry.save),
    save() {
      const saves = active().flatMap((entry) => (entry.save ? [entry.save] : []));
      if (!saves.length) return undefined;
      return Promise.all(saves.map((save) => save())).then(() => undefined);
    },
    label: () => active().find((entry) => entry.contextLabel)?.contextLabel,
    keepsEntry: () => { const list = active(); return list.length > 0 && list.every((entry) => entry.keepsEntry); },
  };
}

export const UnsavedChangesGuardContext = createContext<GuardRegistry | null>(
  null,
);

type UseUnsavedChangesOptions = {
  dirty: boolean;
  saving?: boolean;
  save?: () => void | Promise<void>;
  contextLabel?: string;
  keepsEntry?: boolean;
  // Chat drafts are kept by the chat itself and never block leaving (contract of #14).
  chatDraft?: boolean;
};

/**
 * Registers "this form has unsaved changes" with the panel shell, which then guards its links, "Wyloguj"
 * and tab close. Outside a shell (tests, isolated forms) it does nothing.
 */
export function useUnsavedChanges({
  dirty,
  saving = false,
  save,
  contextLabel,
  keepsEntry = false,
  chatDraft = false,
}: UseUnsavedChangesOptions) {
  const registry = useContext(UnsavedChangesGuardContext);
  const id = useId();
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const hasSave = Boolean(save);
  useEffect(() => {
    if (!registry || chatDraft) return;
    registry.register(id, {
      dirty,
      saving,
      contextLabel,
      keepsEntry,
      save: hasSave ? () => saveRef.current?.() : undefined,
    });
    return () => registry.register(id, null);
  }, [registry, id, dirty, saving, contextLabel, keepsEntry, chatDraft, hasSave]);
}
