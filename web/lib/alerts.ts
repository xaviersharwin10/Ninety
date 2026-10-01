import type { BetResult } from "./account-engine";
import { resultText } from "./result-text";

/**
 * Result alerts: a browser notification when a bet settles while the fan is on another tab or app.
 * In the app, the result toast already says so; this only fires when the page isn't visible. It
 * needs no server: the account engine is still watching the bets in the background tab, and posts
 * the notification itself through the service worker (Android Chrome only shows notifications that
 * way). A closed app gets nothing -- that would take a push server.
 */
const PREF_KEY = "ninety:alerts";

type Pref = "on" | "off";

function readPref(): Pref | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

function writePref(pref: Pref) {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

/** Whether to offer alerts: the browser can show them, and the fan hasn't answered yet. */
export function shouldOfferAlerts(): boolean {
  return supported() && Notification.permission === "default" && readPref() !== "off";
}

/** Asks the browser for permission; must run from a tap. True if alerts are now on. */
export async function enableAlerts(): Promise<boolean> {
  if (!supported()) return false;
  await registerAlertsWorker();
  const permission = await Notification.requestPermission();
  writePref(permission === "granted" ? "on" : "off");
  return permission === "granted";
}

export function declineAlerts() {
  writePref("off");
}

export async function registerAlertsWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** Notifies the fan of a result if they're away from the page and have alerts on. */
export async function alertResult(result: BetResult): Promise<void> {
  if (!supported() || Notification.permission !== "granted" || readPref() === "off") return;
  if (document.visibilityState === "visible") return;
  const { title, detail } = resultText(result);
  // Showing needs an active worker, not just a registered one: a worker registered moments ago may
  // still be installing.
  if (!(await navigator.serviceWorker.getRegistration()) && !(await registerAlertsWorker())) return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body: result.question ? `${result.question} · ${detail}` : detail,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // One notification per market: a later result for it replaces, rather than stacks.
    tag: `result-${result.id}`,
  });
}

/** Gets the worker running when the app opens, if alerts are on, so it's active before a result. */
export function prepareAlerts(): void {
  if (supported() && Notification.permission === "granted" && readPref() !== "off") {
    void registerAlertsWorker();
  }
}
