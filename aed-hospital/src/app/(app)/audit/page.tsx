"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { qs, useApi } from "@/lib/client";
import { formatDateTime } from "@/lib/dates";
import { Button, ErrorState, Modal, PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";

function diff(before: any, after: any) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before)) return null;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !["updatedAt", "createdAt"].includes(k));
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ k, b: before[k], a: after[k] }));
}

function Inner() {
  const sp = useSearchParams();
  const [f, setF] = useState({ entityType: "", action: "", user: "", from: "", to: "", entityId: sp.get("entityId") ?? "" });
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<any>(`/api/audit${qs({ ...f, page })}`);
  const [detail, setDetail] = useState<any | null>(null);
  const set = (k: string, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(1);
  };
  const d = detail ? diff(detail.before, detail.after) : null;
  return (
    <>
      <PageHeader title="Audit Log" subtitle="Append-only record of every financial change, closing action, import, login and admin change" />
      <div className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <label className="flex flex-col gap-1 text-xs text-2">
          Entity
          <select className="input !w-auto" value={f.entityType} onChange={(e) => set("entityType", e.target.value)}>
            <option value="">All</option>
            {data?.entityTypes.map((t: string) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {(["action", "user", "entityId"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-2">
            {k === "entityId" ? "Record ID" : k[0].toUpperCase() + k.slice(1)}
            <input className="input !w-40" value={f[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs text-2">
          From
          <input type="date" className="input !w-auto" value={f.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-2">
          To
          <input type="date" className="input !w-auto" value={f.to} onChange={(e) => set("to", e.target.value)} />
        </label>
      </div>
      <ErrorState error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Reason</th>
                    <th>IP / device</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.createdAt)}</td>
                      <td>{r.userName}</td>
                      <td className="font-medium">{r.action}</td>
                      <td>
                        {r.entityType} <span className="text-xs muted">{r.entityId?.slice(-8)}</span>
                      </td>
                      <td className="max-w-[240px] truncate" title={r.reason ?? ""}>
                        {r.reason}
                      </td>
                      <td className="max-w-[180px] truncate text-xs muted" title={r.userAgent ?? ""}>
                        {r.ip ?? ""} {r.userAgent ? `· ${r.userAgent.slice(0, 30)}` : ""}
                      </td>
                      <td>
                        {(r.before || r.after) && (
                          <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                            Details
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </Button>
              <span className="muted">
                Page {page} · {data.total} entries
              </span>
              <Button size="sm" variant="secondary" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </>
        )
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.action} · ${detail.entityType}` : ""} wide>
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="muted">
              {formatDateTime(detail.createdAt)} by {detail.userName} · record {detail.entityId}
            </p>
            {detail.reason && <p>Reason: {detail.reason}</p>}
            {d && d.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Original value</th>
                    <th>New value</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((x) => (
                    <tr key={x.k}>
                      <td>{x.k}</td>
                      <td className="whitespace-normal">{JSON.stringify(x.b)}</td>
                      <td className="whitespace-normal">{JSON.stringify(x.a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <details>
              <summary className="cursor-pointer muted">Raw before / after</summary>
              <pre className="mt-2 overflow-x-auto rounded p-2 text-xs" style={{ background: "var(--surface-2)" }}>
                {JSON.stringify({ before: detail.before, after: detail.after }, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <Guard perm="audit.view">
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
