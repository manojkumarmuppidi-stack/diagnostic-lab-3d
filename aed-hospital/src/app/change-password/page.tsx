"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: "New passwords do not match" });
    setBusy(true);
    try {
      await apiFetch("/api/auth/password", { method: "POST", json: { current, next } });
      setMsg({ ok: true, text: "Password changed. Redirecting…" });
      setTimeout(() => (window.location.href = "/dashboard"), 800);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 p-6">
        <h1 className="text-lg font-semibold">Change password</h1>
        <p className="text-xs muted">At least 8 characters with letters and numbers.</p>
        {[
          ["Current password", current, setCurrent, "current-password"],
          ["New password", next, setNext, "new-password"],
          ["Confirm new password", confirm, setConfirm, "new-password"],
        ].map(([label, v, set, ac]) => (
          <label key={label as string} className="block space-y-1 text-xs font-medium text-2">
            {label as string}
            <input type="password" className="input" autoComplete={ac as string} value={v as string} onChange={(e) => (set as (s: string) => void)(e.target.value)} required />
          </label>
        ))}
        {msg && (
          <p className="text-sm" style={{ color: msg.ok ? "var(--good)" : "var(--bad)" }} role="alert">
            {msg.text}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          Change password
        </button>
        <a href="/dashboard" className="btn btn-ghost w-full">
          Cancel
        </a>
      </form>
    </main>
  );
}
