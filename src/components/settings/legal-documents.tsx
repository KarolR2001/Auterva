"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { LegalStatus } from "./settings-extras";
import { legalStatus } from "./settings-model";
import styles from "./settings.module.css";

type Document = { text: unknown; url: unknown };

const documents = [
  { kind: "privacy", label: "Polityka prywatności" },
  { kind: "terms", label: "Regulamin" },
] as const;

const sources = [
  { status: "TEXT", label: "Treść własna" },
  { status: "LINK", label: "Link zewnętrzny" },
] as const;

/**
 * ADM-14 read-only (D-01): one document at a time. The document switcher only changes what is shown; the publication
 * source is an indicator, not a control, because only the superadmin writes the legal content.
 */
export function LegalDocuments({ privacy, terms }: { privacy: Document; terms: Document }) {
  const [kind, setKind] = useState<"privacy" | "terms">("privacy");
  const current = kind === "privacy" ? privacy : terms;
  const status = legalStatus(current.text, current.url);
  return (
    <div className={styles.legal}>
      <div className={styles.legalGroup}>
        <p id="legal-document-label" className={styles.eyebrow}>Dokument</p>
        <div className={styles.segments} role="group" aria-labelledby="legal-document-label">
          {documents.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={styles.segment}
              aria-pressed={kind === item.kind}
              onClick={() => setKind(item.kind)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.legalGroup}>
        <p id="legal-source-label" className={styles.eyebrow}>Źródło publikacji</p>
        <ul className={styles.segments} aria-labelledby="legal-source-label">
          {sources.map((item) => {
            const selected = status === item.status;
            return (
              <li key={item.status} className={`${styles.segment} ${styles.segmentStatic}`} data-selected={selected || undefined}>
                {selected ? <Check size={16} aria-hidden="true" /> : null}
                {item.label}
                {selected ? <span className={styles.srOnly}> (wybrane)</span> : null}
              </li>
            );
          })}
        </ul>
        {status === "MISSING" ? <p className={styles.status}>Dokument nie ma jeszcze treści ani linku.</p> : null}
      </div>
      <LegalStatus kind={kind} text={current.text} url={current.url} />
    </div>
  );
}
