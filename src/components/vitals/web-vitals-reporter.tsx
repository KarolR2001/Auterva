"use client";

import { useEffect } from "react";
import { normalizeRoute, type VitalDevice, type VitalPayload, type VitalReport } from "@/lib/web-vitals";

// Web Vitals (#340) without a third party: PerformanceObserver in the page, one report per page view when the page
// is hidden, sent to our own endpoint. A report holds three numbers, route PATTERNS (never the URL, slug, ID or
// token), and the device class. No cookie, no storage, no identifier; the browser's Do Not Track and Global Privacy
// Control signals switch it off. The endpoint sends `Cache-Control: no-store` and keeps only aggregates.

export const vitalsBrowser = {
  send(payload: VitalPayload): void {
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon?.("/api/vitals/", new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall through to fetch */ }
    void fetch("/api/vitals/", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true,
      credentials: "omit", cache: "no-store" }).catch(() => undefined);
  },
};

/** Respect the visitor's opt-out signals before measuring anything. */
export function measurementAllowed(nav: Navigator & { globalPrivacyControl?: boolean } = navigator): boolean {
  return nav.doNotTrack !== "1" && nav.globalPrivacyControl !== true;
}

type Collector = { lcp: number | null; cls: number; inp: number | null };

type LayoutShift = PerformanceEntry & { value: number; hadRecentInput: boolean };
type EventTiming = PerformanceEntry & { interactionId?: number };

/** INP: the longest interaction; with 50 or more interactions the worst one is ignored per 50 (web.dev definition). */
export function inpFrom(durationsByInteraction: Map<number, number>): number | null {
  if (durationsByInteraction.size === 0) return null;
  const sorted = [...durationsByInteraction.values()].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(durationsByInteraction.size / 50))];
}

export function startVitals(report: (payload: VitalPayload) => void): () => void {
  if (typeof PerformanceObserver === "undefined" || !measurementAllowed()) return () => undefined;
  const state: Collector = { lcp: null, cls: 0, inp: null };
  const landingRoute = normalizeRoute(location.pathname);
  const interactions = new Map<number, number>();
  const observers: PerformanceObserver[] = [];
  let windowValue = 0;
  let windowStart = 0;
  let windowLast = 0;
  let sent = false;

  const observe = (type: string, handler: (entries: PerformanceEntryList) => void, options: PerformanceObserverInit & { durationThreshold?: number } = {}) => {
    try {
      const observer = new PerformanceObserver((list) => handler(list.getEntries()));
      observer.observe({ type, buffered: true, ...options });
      observers.push(observer);
    } catch { /* entry type unsupported in this browser: that metric is simply not reported */ }
  };

  observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) state.lcp = last.startTime;
  });
  observe("layout-shift", (entries) => {
    for (const entry of entries as LayoutShift[]) {
      if (entry.hadRecentInput) continue;
      // Session windows: a gap above 1 s or a window longer than 5 s starts a new one; CLS is the worst window.
      if (windowValue > 0 && (entry.startTime - windowLast > 1000 || entry.startTime - windowStart > 5000)) windowValue = 0;
      if (windowValue === 0) windowStart = entry.startTime;
      windowValue += entry.value;
      windowLast = entry.startTime;
      state.cls = Math.max(state.cls, windowValue);
    }
  });
  observe("event", (entries) => {
    for (const entry of entries as EventTiming[]) {
      if (!entry.interactionId) continue;
      interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration));
      state.inp = inpFrom(interactions);
    }
  }, { durationThreshold: 40 });

  const flush = () => {
    if (sent) return;
    const device: VitalDevice = window.matchMedia?.("(max-width: 767px)").matches ? "mobile" : "desktop";
    const currentRoute = normalizeRoute(location.pathname);
    const metrics: VitalReport[] = [];
    if (state.lcp !== null) metrics.push({ name: "LCP", value: Math.round(state.lcp), route: landingRoute });
    if (state.inp !== null) metrics.push({ name: "INP", value: Math.round(state.inp), route: currentRoute });
    // CLS is reported only after a visible frame was painted (LCP seen), as a page that never rendered has no layout.
    if (state.lcp !== null) metrics.push({ name: "CLS", value: Math.round(state.cls * 10_000) / 10_000, route: landingRoute });
    if (metrics.length === 0) return;
    sent = true;
    report({ device, metrics });
  };
  const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
    for (const observer of observers) observer.disconnect();
  };
}

export function WebVitalsReporter() {
  useEffect(() => startVitals((payload) => vitalsBrowser.send(payload)), []);
  return null;
}
