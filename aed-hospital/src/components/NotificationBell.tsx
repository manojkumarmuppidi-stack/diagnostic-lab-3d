"use client";
/**
 * The bell in the top bar: what needs this person's attention (approvals, routine bills not yet
 * booked, accounts not updated, days to close). New items pop up in the app and — once allowed
 * on that phone/computer — as a system notification, while the app is open.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, BellRing, Info } from "lucide-react";
import { apiFetch, cn } from "@/lib/client";
import { useToast } from "./ui";

interface Notice {
  id: string;
  tone: "bad" | "warn" | "info";
  title: string;
  detail?: string;
  href: string;
}

const POLL_MS = 3 * 60 * 1000;
const SEEN_KEY = "aed.notices.seen";
const COLOR = { bad: "var(--bad)", warn: "var(--status-warning)", info: "var(--series-1)" } as const;

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function writeSeen(ids: Iterable<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    /* private mode: popups simply repeat */
  }
}

const canNotify = () => typeof window !== "undefined" && "Notification" in window;

async function systemNotify(n: Notice) {
  if (!canNotify() || Notification.permission !== "granted") return;
  const opts = { body: n.detail ?? "", tag: n.id, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { href: n.href } };
  try {
    // Phones only show notifications through the service worker.
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) await reg.showNotification(n.title, opts);
    else new Notification(n.title, opts);
  } catch {
    /* not supported here: the in-app popup is enough */
  }
}

export function NotificationBell({ className }: { className?: string }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<string>("unsupported");
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: Notice[] }>("/api/notifications");
      setItems(r.items);
      const seen = readSeen();
      const fresh = r.items.filter((n) => !seen.has(n.id));
      // Pop up what is new since this person last saw it (at most three at once).
      for (const n of fresh.slice(0, 3)) {
        toast(n.tone === "bad" ? "error" : "info", n.title);
        void systemNotify(n);
      }
      if (fresh.length) writeSeen([...seen, ...fresh.map((n) => n.id)]);
    } catch {
      /* offline or signed out: try again next round */
    }
  }, [toast]);

  useEffect(() => {
    if (canNotify()) setPerm(Notification.permission);
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const enable = async () => {
    if (!canNotify()) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") {
      toast("success", "Notifications turned on for this device");
      for (const n of items.slice(0, 1)) void systemNotify(n);
    }
  };

  const urgent = items.some((n) => n.tone !== "info");
  return (
    <div className={cn("relative", className)}>
      <button className="btn btn-ghost relative" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Notifications${items.length ? ` (${items.length})` : ""}`}>
        {items.length ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {items.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold leading-[1.1rem]" style={{ background: urgent ? "var(--bad)" : "var(--brand)", color: "#fff" }}>
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close notifications" onClick={() => setOpen(false)} />
          <div className="card fixed inset-x-3 top-14 z-50 max-h-[70vh] overflow-y-auto p-2 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96" role="dialog" aria-label="Notifications">
            <p className="px-2 py-1 text-sm font-semibold">Needs attention</p>
            {items.length === 0 && <p className="px-2 py-3 text-sm muted">All caught up.</p>}
            <ul>
              {items.map((n) => {
                const Icon = n.tone === "info" ? Info : AlertTriangle;
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      className="flex gap-2 rounded-md px-2 py-2 text-sm hover:opacity-80"
                      onClick={() => setOpen(false)}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: COLOR[n.tone] }} />
                      <span>
                        <span className="block font-medium">{n.title}</span>
                        {n.detail && <span className="block text-xs muted">{n.detail}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {perm === "default" && (
              <button className="btn btn-secondary btn-sm mt-2 w-full" onClick={enable}>
                <BellRing className="h-4 w-4" /> Get these as phone / desktop notifications
              </button>
            )}
            {perm === "denied" && <p className="mt-2 px-2 text-xs muted">Notifications are blocked for this site in the browser settings; reminders still show here.</p>}
          </div>
        </>
      )}
    </div>
  );
}
