"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined") window.location.href = "/change-password";
  }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const b = (typeof body === "object" ? body : { error: body }) as { error?: string; code?: string; fields?: Record<string, string>; details?: unknown };
    throw new ApiError(res.status, b.error || `Request failed (${res.status})`, b.code, b.fields, b.details);
  }
  return body as T;
}

/** GET with loading/error state; re-fetches when `url` changes. Pass null to skip. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<T>(url);
      if (my === seq.current) setData(d);
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function download(url: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: `Download failed (${res.status})` }));
    throw new ApiError(res.status, b.error ?? "Download failed");
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? "download";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/**
 * Share a generated file (e.g. a PDF) through the phone's share sheet — WhatsApp, email…
 * Returns false where the browser cannot share files (most desktops); the caller then downloads instead.
 */
export async function shareFile(url: string, title: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !("canShare" in navigator)) return false;
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: `Download failed (${res.status})` }));
    throw new ApiError(res.status, b.error ?? "Download failed");
  }
  const blob = await res.blob();
  const name = /filename="?([^"]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "report.pdf";
  const file = new File([blob], name, { type: blob.type || "application/pdf" });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title });
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
  return true;
}

export function cn(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
