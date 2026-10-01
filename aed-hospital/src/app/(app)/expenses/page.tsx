"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Download, Plus, X } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Spinner, Tabs, useToast, type Tone } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { TransactionForm } from "@/components/TransactionForm";
import { useCan } from "@/components/session";
import { apiFetch, qs, useApi } from "@/lib/client";
import { addMonths, formatDate, startOfMonth, todayISO } from "@/lib/dates";
import { monthLabel } from "@/lib/expenses";
import { formatINR, formatINRCompact } from "@/lib/money";

type Tab = "list" | "pending" | "checklist" | "monthwise";

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const can = useCan();
  const tab = (sp.get("tab") as Tab) || "list";
  const pending = useApi<any>("/api/expenses/pending");
  const n = pending.data?.rows.length ?? 0;
  const tabs: { key: Tab; label: React.ReactNode }[] = [
    { key: "list", label: "Expenses" },
    { key: "pending", label: `${can("expense.approve") ? "Waiting approval" : "My entries waiting"}${n ? ` (${n})` : ""}` },
    { key: "checklist", label: "Monthly checklist" },
    { key: "monthwise", label: "Month-wise" },
  ];
  return (
    <div className="space-y-4">
      <Tabs<Tab> tabs={tabs} value={tab} onChange={(t) => router.replace(`${path}?tab=${t}`)} />
      {tab === "list" && (
        <>
          <ModuleInsights section="expense" />
          <ModuleList module="expense" embedded />
        </>
      )}
      {tab === "pending" && <Pending data={pending.data} error={pending.error} reload={pending.reload} />}
      {tab === "checklist" && <Checklist onSaved={pending.reload} />}
      {tab === "monthwise" && <MonthWise />}
    </div>
  );
}

function Pending({ data, error, reload }: { data: any; error: { message: string } | null; reload: () => void }) {
  const toast = useToast();
  const [reject, setReject] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  if (!data.rows.length)
    return <EmptyState title="Nothing waiting" detail={data.canApprove ? "Expenses entered by staff appear here for approval." : "Your entries appear here until an Admin approves them."} />;
  const approve = async (id: string) => {
    setBusy(id);
    try {
      await apiFetch(`/api/expenses/${id}/decision`, { method: "POST", json: { decision: "APPROVE" } });
      toast("success", "Approved — now counted in expenses");
      reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title={`${data.rows.length} expense${data.rows.length === 1 ? "" : "s"} waiting · ${formatINR(data.total)}`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Head / category</th>
              <th>Description</th>
              <th>Paid to</th>
              <th className="num">Amount</th>
              <th>Mode</th>
              <th>Entered by</th>
              {data.canApprove && <th />}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                <td>
                  {r.head ?? r.category}
                  {r.subcategory && <div className="text-xs muted">{r.subcategory}</div>}
                </td>
                <td>
                  {r.description}
                  {r.attachments > 0 && (
                    <Badge tone="blue" className="ml-1">
                      {r.attachments} bill
                    </Badge>
                  )}
                </td>
                <td>{r.vendor ?? "—"}</td>
                <td className="num">{formatINR(r.amount)}</td>
                <td>{r.paymentMode ?? "—"}</td>
                <td className="text-xs">{r.enteredBy}</td>
                {data.canApprove && (
                  <td className="whitespace-nowrap">
                    <Button size="sm" onClick={() => approve(r.id)} loading={busy === r.id}>
                      <Check className="h-4 w-4" /> Approve
                    </Button>{" "}
                    <Button size="sm" variant="secondary" onClick={() => setReject(r)}>
                      <X className="h-4 w-4" /> Reject
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!reject}
        onClose={() => setReject(null)}
        title="Reject expense"
        danger
        requireReason
        confirmLabel="Reject"
        message={reject ? `${reject.description} · ${formatINR(reject.amount)}. The entry is kept (voided) with your reason.` : ""}
        onConfirm={async (reason: string) => {
          await apiFetch(`/api/expenses/${reject.id}/decision`, { method: "POST", json: { decision: "REJECT", reason } });
          toast("success", "Rejected");
          reload();
        }}
      />
    </Card>
  );
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  done: { label: "Entered", tone: "green" },
  pending: { label: "Waiting approval", tone: "amber" },
  missing: { label: "Not entered", tone: "red" },
  optional: { label: "Occasional", tone: "neutral" },
};

function Checklist({ onSaved }: { onSaved: () => void }) {
  const can = useCan();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [q, setQ] = useState("");
  const [add, setAdd] = useState<Record<string, string> | null>(null);
  const { data, error, reload } = useApi<any>(`/api/expenses/checklist?month=${month}`);
  const rows = (data?.month === month ? data.rows : []).filter((r: any) => !q || `${r.name} ${r.category} ${r.vendor ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const entryDate = month === todayISO().slice(0, 7) ? todayISO() : `${month}-${String(lastDay).padStart(2, "0")}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs muted">Month</span>
          <input type="month" className="input !w-auto" value={month} max={todayISO().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs muted">Find a head</span>
          <input className="input !w-56" value={q} onChange={(e) => setQ(e.target.value)} placeholder="rent, milk, esi…" />
        </label>
        {data?.summary && data.month === month && (
          <p className="text-sm muted">
            {data.summary.done} of {data.summary.heads} monthly heads entered · {data.summary.pending} waiting approval · {data.summary.missing} not entered
            {data.summary.expectedMissing > 0 && ` (about ${formatINRCompact(data.summary.expectedMissing)} going by last month)`}
          </p>
        )}
      </div>
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && !data.rows.length && <EmptyState title="No expense heads yet" detail="An Admin adds the recurring heads (rent, electricity, salaries…) under Masters → Expense heads." />}
      {data?.month === month && data.rows.length > 0 && (
        <Card title={`Recurring expenses — ${monthLabel(month)}`}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Head</th>
                  <th>Category</th>
                  <th className="num">This month</th>
                  <th className="num">Last month</th>
                  <th>Status</th>
                  {can("expense.write") && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.vendor && <div className="text-xs muted">{r.vendor}</div>}
                    </td>
                    <td className="text-xs">{r.category}</td>
                    <td className="num">
                      {r.approved ? formatINR(r.approved) : "—"}
                      {r.pending > 0 && <div className="text-xs muted">+ {formatINR(r.pending)} waiting</div>}
                    </td>
                    <td className="num muted">{r.lastMonth ? formatINR(r.lastMonth) : "—"}</td>
                    <td>
                      <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                    </td>
                    {can("expense.write") && (
                      <td>
                        <Button size="sm" variant="secondary" onClick={() => setAdd({ headId: r.id, date: entryDate, ...(r.expected ? { amount: String(r.expected) } : {}) })}>
                          <Plus className="h-4 w-4" /> Add
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <TransactionForm
        module="expense"
        open={!!add}
        preset={add ?? undefined}
        onClose={() => setAdd(null)}
        onSaved={() => {
          reload();
          onSaved();
        }}
      />
    </div>
  );
}

function MonthWise() {
  const [to, setTo] = useState(todayISO());
  const [from, setFrom] = useState<string>(startOfMonth(addMonths(todayISO(), -5)));
  const [by, setBy] = useState<"category" | "subcategory" | "head" | "mode">("category");
  const { data, error, reload } = useApi<any>(`/api/expenses/pivot${qs({ from, to, by })}`);
  const csv = () => {
    if (!data) return;
    const esc = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/^(.*[",\n].*)$/s, (x) => `"${x.replace(/"/g, '""')}"`);
    const lines = [["Line", ...data.months.map(monthLabel), "Total"].map(esc).join(",")];
    for (const l of data.lines) lines.push([esc(l.label), ...data.months.map((m: string) => String(l.byMonth[m] ?? 0)), String(l.total)].join(","));
    lines.push(["Total", ...data.months.map((m: string) => String(data.totals[m] ?? 0)), String(data.grandTotal)].join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-month-wise-${data.from}-to-${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs muted">From</span>
          <input type="date" className="input !w-auto" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs muted">To</span>
          <input type="date" className="input !w-auto" value={to} max={todayISO()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs muted">Rows</span>
          <select className="input !w-auto" value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
            <option value="category">Category</option>
            <option value="subcategory">Category / subcategory</option>
            <option value="head">Expense head</option>
            <option value="mode">Payment mode (cash, cheque, GPay, PhonePe…)</option>
          </select>
        </label>
        <Button variant="secondary" onClick={csv} disabled={!data}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && (
        <Card title={`Approved expenses by month · ${formatINR(data.grandTotal)}`}>
          {data.lines.length === 0 ? (
            <p className="text-sm muted">No approved expenses in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{by === "head" ? "Head" : by === "mode" ? "Paid by" : "Category"}</th>
                    {data.months.map((m: string) => (
                      <th key={m} className="num">
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l: any) => (
                    <tr key={l.label}>
                      <td>{l.label}</td>
                      {data.months.map((m: string) => (
                        <td key={m} className="num">
                          {l.byMonth[m] ? formatINRCompact(l.byMonth[m]) : <span className="muted">—</span>}
                        </td>
                      ))}
                      <td className="num font-medium">{formatINRCompact(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>Total</td>
                    {data.months.map((m: string) => (
                      <td key={m} className="num">
                        {formatINRCompact(data.totals[m] ?? 0)}
                      </td>
                    ))}
                    <td className="num">{formatINRCompact(data.grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs muted">Approved expenses only. Pharmacy purchases are their own line, so the total equals Total Expenses elsewhere in the app.</p>
        </Card>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="expense.view">
      <PageHeader title="Expenses" subtitle="Operating and other expenses, with bills · staff entries are approved by an Admin" />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
