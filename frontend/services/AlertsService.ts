/**
 * Pikud HaOref (Home Front Command) alerts.
 *
 * Polls the public oref.org.il endpoint every few seconds, classifies each
 * incoming alert as either "early warning" or "actual siren", and pushes it
 * to subscribers. Also exposes `injectFakeAlert` so demos / manual QA can
 * fire a banner without waiting for a real attack.
 *
 * Implementation choices:
 * - Polling, not WebSocket — the official endpoint is plain HTTP JSON.
 * - Dedupe by alert `id` so the same active alert doesn't re-flash the UI.
 * - Errors are swallowed silently; alerting must never crash the app.
 */

export type AlertKind = 'early' | 'siren';

export interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  areas: string[];
  isManual?: boolean;
}

type Listener = (alert: Alert) => void;

const OREF_URL  = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
const POLL_MS   = 3000;

// Pikud HaOref category codes we explicitly understand.
// Anything we don't recognize is treated as a siren — safer to over-alert.
const EARLY_WARNING_CATS = new Set(['13', '14']);

function classify(raw: { cat?: string; title?: string }): AlertKind {
  if (raw.cat && EARLY_WARNING_CATS.has(raw.cat)) return 'early';
  if (raw.title && /התרעה מוקדמת|early warning/i.test(raw.title)) return 'early';
  return 'siren';
}

// Window during which a fresh subscriber gets replayed the last emitted
// alert. Long enough to bridge a cold-start-from-notification-tap (auth
// loading + login + navigation can easily take a few seconds), short
// enough that yesterday's siren doesn't surprise the user when they
// reopen the app the next morning.
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

class AlertsServiceImpl {
  private listeners: Set<Listener> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeenId: string | null = null;
  // Buffer of the most recent alert so a late-mounting subscriber (e.g.,
  // the map screen after a cold-start notification tap) doesn't miss it.
  private lastEmittedAlert: Alert | null = null;
  private lastEmittedAt: number = 0;

  /** Start polling once a listener subscribes; stop when the last one leaves.
   * Also replays the last alert if it's recent — bridges the cold-start gap
   * between the notification tap and the map screen actually mounting. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.startPolling();
    if (
      this.lastEmittedAlert &&
      Date.now() - this.lastEmittedAt < REPLAY_WINDOW_MS
    ) {
      try { listener(this.lastEmittedAlert); } catch { /* swallow */ }
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopPolling();
    };
  }

  /** Demo helper — pushes a fake alert through the same pipeline. */
  injectFakeAlert(kind: AlertKind, area = 'באר שבע') {
    const alert: Alert = {
      id: `manual-${Date.now()}`,
      kind,
      title: kind === 'early' ? 'התרעה מוקדמת' : 'ירי רקטות וטילים',
      areas: [area],
      isManual: true,
    };
    this.emit(alert);
  }

  /**
   * Public entry point used by the push-notification handler when a
   * server-dispatched Oref alert arrives. Goes through the same dedupe
   * as the polling path so a single alert never fires twice if both
   * sources deliver it (push wakes the device, polling catches up).
   */
  injectAlert(alert: Alert) {
    if (alert.id === this.lastSeenId) return;
    this.lastSeenId = alert.id;
    this.emit(alert);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private startPolling() {
    if (this.timer) return;
    // Poll immediately on first subscribe, then on the regular interval.
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  private stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll() {
    try {
      const res = await fetch(OREF_URL, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) return;
      let text = await res.text();
      // Pikud HaOref sometimes ships a BOM prefix that breaks JSON.parse.
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      text = text.trim();
      if (!text) return;
      const data = JSON.parse(text);
      // Empty object `{}` means no active alert right now.
      if (!data || !data.id) return;
      // Dedupe — only fire once per unique alert id.
      if (data.id === this.lastSeenId) return;
      this.lastSeenId = data.id;
      this.emit({
        id:    String(data.id),
        kind:  classify(data),
        title: String(data.title ?? 'אזעקה'),
        areas: Array.isArray(data.data) ? data.data.map(String) : [],
      });
    } catch {
      // Network blip, JSON parse error, whatever — silently skip this tick.
    }
  }

  private emit(alert: Alert) {
    this.lastEmittedAlert = alert;
    this.lastEmittedAt = Date.now();
    for (const l of this.listeners) {
      try { l(alert); } catch { /* listener errors must not break others */ }
    }
  }
}

export const AlertsService = new AlertsServiceImpl();
