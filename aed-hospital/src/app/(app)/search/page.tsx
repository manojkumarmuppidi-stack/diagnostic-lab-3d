"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useApi } from "@/lib/client";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Badge, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";

interface Result {
  type: string;
  title: string;
  subtitle: string;
  href: string;
  amount?: number;
  date?: string;
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = sp.get("q") ?? "";
  const [text, setText] = useState(q);
  const [type, setType] = useState("");
  useEffect(() => setText(q), [q]);
  const { data, error, loading } = useApi<{ results: Result[] }>(q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null);
  const types = [...new Set(data?.results.map((r) => r.type) ?? [])];
  const results = (data?.results ?? []).filter((r) => !type || r.type === type);
  return (
    <>
      <PageHeader title="Search" subtitle="Patients, invoices, transactions, investigations, expenses and admissions" />
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/search?q=${encodeURIComponent(text.trim())}`);
        }}
      >
        <input className="input" autoFocus placeholder="Type at least 2 characters…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" />
        <button className="btn btn-primary">
          <Search className="h-4 w-4" />
          <span className="sr-only">Search</span>
        </button>
      </form>
      {types.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1">
          <button className={`btn btn-sm ${type === "" ? "btn-primary" : "btn-secondary"}`} onClick={() => setType("")}>
            All ({data?.results.length})
          </button>
          {types.map((t) => (
            <button key={t} className={`btn btn-sm ${type === t ? "btn-primary" : "btn-secondary"}`} onClick={() => setType(t)}>
              {t} ({data?.results.filter((r) => r.type === t).length})
            </button>
          ))}
        </div>
      )}
      <ErrorState error={error} />
      {loading && <Spinner />}
      {data && !results.length && <EmptyState title="No matches" detail="Try a patient ID, name, invoice or bill number." />}
      <ul className="space-y-2">
        {results.map((r, i) => (
          <li key={i}>
            <Link href={r.href} className="card flex items-center justify-between gap-3 p-3 hover:shadow-md">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="blue">{r.type}</Badge>
                  <span className="truncate font-medium">{r.title}</span>
                </div>
                <p className="mt-0.5 truncate text-xs muted">
                  {r.date ? `${formatDate(r.date)} · ` : ""}
                  {r.subtitle}
                </p>
              </div>
              {r.amount !== undefined && <span className="font-semibold tabular-nums">{formatINR(r.amount)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Page() {
  return (
    <Guard perm="search.use">
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
