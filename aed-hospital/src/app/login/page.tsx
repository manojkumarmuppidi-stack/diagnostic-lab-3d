"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/client";

function LoginForm() {
  const sp = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ mustChangePassword: boolean }>("/api/auth/login", { method: "POST", json: { username, password } });
      const next = sp.get("next");
      window.location.href = r.mustChangePassword ? "/change-password" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Activity className="h-7 w-7" style={{ color: "var(--brand)" }} aria-hidden />
        <div>
          <h1 className="text-lg font-bold leading-tight">AED Hospital</h1>
          <p className="text-xs muted">KPHB, Hyderabad · Finance & Analytics</p>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="username" className="text-xs font-medium text-2">
          Username
        </label>
        <input id="username" className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-xs font-medium text-2">
          Password
        </label>
        <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
      </button>
      <p className="text-center text-xs muted">Authorised hospital staff only. All activity is logged.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
