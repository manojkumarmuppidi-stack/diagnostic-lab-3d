"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, useApi } from "@/lib/client";
import { addDays, formatDate, formatDateTime } from "@/lib/dates";
import { formatINR, round2 } from "@/lib/money";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, StatusBadge, Tabs, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan, useSession } from "@/components/session";

type Tab = "days" | "corrections";

function Days() {
  const { today } = useSession();
  const [from, setFrom] = useState(addDays(today, -30));
  const { data, error, loading } = useApi<{ date: string; status: string; income: number; expenses: number; absVariance: number; lines: number; reopenCount: number }[]>(`/api/daily?from=${from}&to=${today}`);
  const counts = data?.reduce<Record<string, number>>((a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-2">
          From
          <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        {counts && (
          <div className="flex flex-wrap gap-2 pb-2">
            {Object.entries(counts).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1 text-sm">
                <StatusBadge status={k} /> {v}
              </span>
            ))}
          </div>
        )}
      </div>
      <ErrorState error={error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th className="num">Income</th>
                <th className="num">Expenses</th>
                <th className="num">Net</th>
                <th className="num">|Variance|</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((d) => (
                <tr key={d.date}>
                  <td>{formatDate(d.date)}</td>
                  <td>
                    <StatusBadge status={d.status} />
                    {d.reopenCount > 0 && <Badge tone="amber" className="ml-1">reopened ×{d.reopenCount}</Badge>}
                    {d.status !== "CLOSED" && d.lines > 0 && d.date < today && <Badge tone="red" className="ml-1">needs closing</Badge>}
                  </td>
                  <td className="num">{formatINR(d.income)}</td>
                  <td className="num">{formatINR(d.expenses)}</td>
                  <td className="num">{formatINR(round2(d.income - d.expenses))}</td>
                  <td className="num" style={{ color: d.absVariance ? "var(--bad)" : undefined }}>
                    {d.absVariance ? formatINR(d.absVariance) : "—"}
                  </td>
                  <td>
                    <Link className="btn btn-secondary btn-sm" href={`/daily-accounts?date=${d.date}`}>
                      {d.status === "CLOSED" ? "View" : "Reconcile / close"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Req {
  id: string;
  module: ModuleKey;
  entityId: string;
  proposed: { action: "CORRECT" | "VOID"; data?: Record<string, unknown> };
  reason: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewNote: string | null;
}

function Corrections() {
  const can = useCan();
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const { data, error, loading, reload } = useApi<Req[]>(`/api/corrections?status=${status}`);
  const [review, setReview] = useState<{ req: Req; decision: "APPROVE" | "REJECT" } | null>(null);
  const [note, setNote] = useState("");
  const decide = async () => {
    if (!review) return;
    try {
      await apiFetch(`/api/corrections/${review.req.id}`, { method: "POST", json: { decision: review.decision, note: note || undefined } });
      toast("success", review.decision === "APPROVE" ? "Correction applied" : "Request rejected");
      setReview(null);
      setNote("");
      reload();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Request status">
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
        <option value="ALL">All</option>
      </select>
      <ErrorState error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !data?.length ? (
        <div className="card">
          <EmptyState title="No correction requests" detail="Corrections to transactions on closed days appear here for approval." />
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <div key={r.id} className="card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} />
                <Badge tone={r.proposed.action === "VOID" ? "red" : "violet"}>{r.proposed.action === "VOID" ? "Void" : "Correction"}</Badge>
                <span className="font-medium">{MODULES[r.module]?.singular ?? r.module}</span>
                <span className="muted">
                  requested by {r.requestedBy} · {formatDateTime(r.requestedAt)}
                </span>
                <Link className="ml-auto text-xs underline" href={`/audit?entityId=${r.entityId}`}>
                  Record history
                </Link>
              </div>
              <p className="mt-1">
                <span className="muted">Reason:</span> {r.reason}
              </p>
              {r.proposed.data && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs muted">Proposed values</summary>
                  <pre className="mt-1 overflow-x-auto rounded p-2 text-xs" style={{ background: "var(--surface-2)" }}>
                    {JSON.stringify(r.proposed.data, null, 2)}
                  </pre>
                </details>
              )}
              {r.reviewedBy && (
                <p className="mt-1 text-xs muted">
                  Reviewed by {r.reviewedBy}
                  {r.reviewNote ? `: ${r.reviewNote}` : ""}
                </p>
              )}
              {r.status === "PENDING" && can("corrections.approve") && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => setReview({ req: r, decision: "APPROVE" })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setReview({ req: r, decision: "REJECT" })}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={!!review}
        onClose={() => setReview(null)}
        title={review?.decision === "APPROVE" ? "Approve correction" : "Reject correction"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button variant={review?.decision === "APPROVE" ? "primary" : "danger"} onClick={decide}>
              {review?.decision === "APPROVE" ? "Approve & apply" : "Reject"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          {review?.decision === "APPROVE" ? "The original record will be marked superseded (kept for audit) and the corrected record created, even though the day is closed. The closed-day totals will show the change." : "The record stays unchanged."}
        </p>
        <Field label="Note (optional)">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (sp.get("tab") as Tab) || "days";
  return (
    <>
      <PageHeader title="Accounting & Reconciliation" subtitle="Day status, reconciliation variances and correction approvals" />
      <div className="space-y-4">
        <Tabs<Tab> value={tab} onChange={(t) => router.replace(`${path}?tab=${t}`)} tabs={[{ key: "days", label: "Day status" }, { key: "corrections", label: "Correction requests" }]} />
        {tab === "days" ? <Days /> : <Corrections />}
        <Card title="Accounting controls in force">
          <ul className="list-disc space-y-1 pl-5 text-sm text-2">
            <li>Transactions are never edited in place — corrections supersede the original, which is kept.</li>
            <li>Nobody can delete financial rows; the database itself blocks deletes and edits of amounts.</li>
            <li>A closed day accepts no changes; corrections become requests that need approval, or an Admin reopens the day (logged).</li>
            <li>A reconciled day that receives a change drops back to “Reviewed” and must be reconciled again.</li>
            <li>Every non-zero reconciliation variance needs a written explanation.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard perm="accounts.view">
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
