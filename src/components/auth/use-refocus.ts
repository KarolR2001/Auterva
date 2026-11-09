"use client";

import { useEffect, useRef } from "react";

/**
 * Fields are disabled while a request runs, which drops focus to the body.
 * Each time a request finishes (`settled` changes) focus returns to the given element;
 * it is a no-op when that element no longer exists (e.g. the form was replaced by a success view).
 */
export function useRefocus(settled: number, targetId: () => string | null) {
  const target = useRef(targetId);
  useEffect(() => {
    target.current = targetId;
  });
  useEffect(() => {
    if (settled === 0) return;
    const id = target.current();
    if (id) document.getElementById(id)?.focus();
  }, [settled]);
}
