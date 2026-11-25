"use client";

import { Car, ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./public.module.css";

export type GalleryImage = { id: string; alt: string | null; width: number | null; height: number | null;
  urls: { large: string; thumb: string } };

/**
 * Vehicle gallery (PUB-03): one large image at a time, thumbnails from the small variant, full-screen view in a
 * native modal dialog (the shared Radix dialog injects an un-nonced style element, which the document CSP of #57 blocks). Only the shown image is requested at full size (the others load when picked or when the dialog opens).
 * Works with the mouse, touch (swipe) and the keyboard (arrows on the viewer); the dialog returns focus to the
 * button that opened it. No animation, so reduced motion needs no special case.
 */
export function VehicleGallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const swipeStart = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);
  const count = images.length;
  // No photo yet: the column keeps the gallery card with a neutral 3:2 placeholder instead of an empty gap (PUB-03).
  if (count === 0) {
    return (
      <div className={styles.gallery}>
        <div className={styles.galleryEmpty} role="img" aria-label={`${name}: brak zdjęć`}>
          <Car aria-hidden="true" size={40} /><span aria-hidden="true">Zdjęcia pojawią się wkrótce</span>
        </div>
      </div>
    );
  }
  const current = images[index];
  const alt = (image: GalleryImage, position: number) => image.alt ?? `${name}, zdjęcie ${position + 1}`;
  const go = (delta: number) => setIndex((value) => (value + delta + count) % count);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
  };
  const onPointerDown = (event: PointerEvent) => { swipeStart.current = event.clientX; };
  const onPointerUp = (event: PointerEvent) => {
    if (swipeStart.current === null) return;
    const delta = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1);
  };

  return (
    <section className={styles.gallery} aria-roledescription="galeria" aria-label={`Zdjęcia: ${name}`}>
      <div className={styles.galleryViewer} role="group" aria-roledescription="podgląd zdjęć" tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        aria-label={`Zdjęcie ${index + 1} z ${count}. Strzałki w lewo i w prawo zmieniają zdjęcie.`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route */}
        <img key={current.id} src={current.urls.large} alt={alt(current, index)} width={current.width ?? undefined} height={current.height ?? undefined}
          className={styles.galleryImage} fetchPriority={index === 0 ? "high" : undefined} draggable={false} sizes="(min-width: 1024px) 60vw, 100vw" />
      </div>
      {/* Phone (FLOW-MVP-04 M/13): ‹ „1 / 2” „Powiększ” ›; from 768 px the text counter and the arrows on the right. */}
      <div className={styles.galleryBar}>
        <p className={styles.galleryCounter} aria-live="polite">
          <span className={styles.wideOnly}>Zdjęcie {index + 1} z {count}</span>
          <span className={styles.narrowOnly}>{index + 1} / {count}</span>
        </p>
        {count > 1 ? (
          <button type="button" className={`${styles.iconButton} ${styles.galleryNav} ${styles.galleryPrev}`} onClick={() => go(-1)} aria-label="Poprzednie zdjęcie"><ChevronLeft aria-hidden="true" size={20} /></button>
        ) : null}
        <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary} ${styles.galleryZoom} ${styles.narrowOnly}`} onClick={() => setOpen(true)}>Powiększ</button>
        {count > 1 ? (
          <button type="button" className={`${styles.iconButton} ${styles.galleryNav}`} onClick={() => go(1)} aria-label="Następne zdjęcie"><ChevronRight aria-hidden="true" size={20} /></button>
        ) : null}
      </div>
      {count > 1 ? (
        <ul className={styles.thumbs} aria-label="Miniatury zdjęć">
          {images.map((image, position) => (
            <li key={image.id}>
              <button type="button" className={styles.thumb} aria-label={`Pokaż zdjęcie ${position + 1} z ${count}`} aria-current={position === index ? "true" : undefined}
                data-selected={position === index ? "true" : undefined} onClick={() => setIndex(position)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route */}
                <img src={image.urls.thumb} alt="" width={104} height={69} loading="lazy" className={styles.thumbImage} />
                {position === index ? <span className={styles.thumbLabel} aria-hidden="true">Wybrane</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary} ${styles.fill} ${styles.wideOnly}`} onClick={() => setOpen(true)}>
        <Maximize2 aria-hidden="true" size={18} />Zobacz wszystkie zdjęcia
      </button>
      {open ? (
        // showModal() traps focus, closes on Escape and returns focus to the button that opened it.
        <dialog ref={dialogRef} className={styles.lightbox} aria-label={`Galeria: ${name}`} onClose={() => setOpen(false)} onKeyDown={onKeyDown}>
          <div className={styles.lightboxBar}>
            <p className={styles.galleryCounter} aria-live="polite">Zdjęcie {index + 1} z {count}</p>
            {count > 1 ? (
              <>
                <button type="button" className={styles.iconButton} onClick={() => go(-1)} aria-label="Poprzednie zdjęcie"><ChevronLeft aria-hidden="true" size={20} /></button>
                <button type="button" className={styles.iconButton} onClick={() => go(1)} aria-label="Następne zdjęcie"><ChevronRight aria-hidden="true" size={20} /></button>
              </>
            ) : null}
            <button type="button" className={styles.iconButton} onClick={() => dialogRef.current?.close()} aria-label="Zamknij galerię"><X aria-hidden="true" size={20} /></button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route */}
          <img src={current.urls.large} alt={alt(current, index)} className={styles.lightboxImage} />
        </dialog>
      ) : null}
    </section>
  );
}
