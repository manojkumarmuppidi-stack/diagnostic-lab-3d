"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Lock, LockOpen, FileDown } from "lucide-react";
import { apiFetch, cn, download, useApi } from "@/lib/client";
import { EXPENSE_LABELS, STREAM_LABELS, type Counts, type ExpenseByKind, type IncomeByStream, AED_INCOME_STREAMS } from "@/lib/accounting";
import { addDays, formatDate, formatDateTime } from "@/lib/dates";
import { formatINR, formatNumber, round2 } from "@/lib/money";
import { STREAM_HREF, withRange } from "@/lib/drill";
import { Badge, Button, Card, ConfirmDialog, ErrorState, PageHeader, Spinner, StatusBadge, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan, useSession } from "@/components/session";
import { ModuleInsights } from "@/components/insights/ModuleInsights";

interface ReconLine {
  group: string;
  expected: number;
  actual: number | null;
  variance: number | null;
  explanation: string | null;
  stale: boolean;
}
interface Statement {
  date: string;
  income: IncomeByStream;
  expense: ExpenseByKind;
  counts: Counts;
  totalIncome: number;
  totalExpenses: number;
  netOperatingResult: number;
  collectionsByMode: Record<string, number>;
  paymentsByMode: Record<string, number>;
  streamByMode: { stream: string; group: string; amount: number }[];
  spreadExpenses: number;
  status: "OPEN" | "REVIEW" | "RECONCILED" | "CLOSED";
  reviewedBy: string | null;
  reconciledBy: string | null;
  closedBy: string | null;
  closedAt: string | null;
  reopenCount: number;
  notes: string | null;
  events: { id: string; action: string; fromStatus: string; toStatus: string; reason: string | null; userName: string | null; createdAt: string }[];
  reconciliation: ReconLine[];
  closedDrift: { income: number; expenses: number } | null;
}

const STEPS = ["OPEN", "REVIEW", "RECONCILED", "CLOSED"] as const;
const MODE_LABEL: Record<string, string> = { CASH: "Cash", CARD: "Card", UPI: "UPI", BANK: "Bank transfer", OTHER: "Other" };

function DayView({ date }: { date: string }) {
  const { data, error, loading, reload } = useApi<Statement>(`/api/daily/${date}`);
  const can = useCan();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | "close" | "reopen" | "review">(null);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [expl, setExpl] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setActual(Object.fromEntries(data.reconciliation.map((r) => [r.group, r.actual === null ? "" : String(r.actual)])));
    setExpl(Object.fromEntries(data.reconciliation.map((r) => [r.group, r.explanation ?? ""])));
    setNotes(data.notes ?? "");
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const stepIndex = STEPS.indexOf(data.status);
  const r = (href: string) => withRange(href, date, date);

  const action = async (a: "review" | "close" | "reopen", reason?: string) => {
    await apiFetch(`/api/daily/${date}/status`, { method: "POST", json: { action: a, reason } });
    toast("success", a === "close" ? "Day closed" : a === "reopen" ? "Day reopened (logged)" : "Marked as reviewed");
    reload();
  };

  const saveRecon = async () => {
    setSaving(true);
    try {
      const lines = data.reconciliation.map((l) => ({ group: l.group, actual: Number(actual[l.group] || 0), explanation: expl[l.group] || null }));
      await apiFetch(`/api/daily/${date}/reconciliation`, { method: "PUT", json: { lines, notes } });
      toast("success", "Reconciliation saved");
      reload();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reconEditable = can("accounts.reconcile") && (data.status === "REVIEW" || data.status === "RECONCILED");

  return (
    <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
      {/* Workflow stepper */}
      <div className="card p-3">
        <ol className="grid grid-cols-4 gap-1 text-center text-xs sm:text-sm">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("rounded-lg px-1 py-2 font-medium", i <= stepIndex ? "" : "muted")} style={i <= stepIndex ? { background: "color-mix(in srgb, var(--brand) 14%, transparent)", color: "var(--text)" } : { background: "var(--surface-2)" }}>
              {i < stepIndex ? <CheckCircle2 className="mr-1 inline h-4 w-4" style={{ color: "var(--status-good)" }} /> : null}
              {s === "OPEN" ? "Open" : s === "REVIEW" ? "Reviewed" : s === "RECONCILED" ? "Reconciled" : "Closed"}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={data.status} />
          {data.reopenCount > 0 && <Badge tone="amber">Reopened {data.reopenCount}×</Badge>}
          {data.closedBy && (
            <span className="text-xs muted">
              Closed by {data.closedBy} · {formatDateTime(data.closedAt)}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {data.status === "OPEN" && can("accounts.reconcile") && (
              <Button size="sm" onClick={() => setConfirm("review")}>
                Mark reviewed
              </Button>
            )}
            {data.status === "RECONCILED" && can("accounts.close") && (
              <Button size="sm" onClick={() => setConfirm("close")}>
                <Lock className="h-4 w-4" /> Close day
              </Button>
            )}
            {data.status !== "OPEN" && can("accounts.reopen") && (
              <Button size="sm" variant="secondary" onClick={() => setConfirm("reopen")}>
                <LockOpen className="h-4 w-4" /> Reopen
              </Button>
            )}
            {can("reports.export") && (
              <Button size="sm" variant="secondary" onClick={() => download(`/api/reports/daily?date=${date}&format=pdf`).catch((e) => toast("error", e.message))}>
                <FileDown className="h-4 w-4" /> PDF
              </Button>
            )}
          </div>
        </div>
        {data.closedDrift && (
          <p className="mt-2 flex items-center gap-2 text-sm" style={{ color: "var(--bad)" }}>
            <AlertTriangle className="h-4 w-4" /> Figures changed after closing (approved corrections): income {formatINR(data.closedDrift.income)}, expenses {formatINR(data.closedDrift.expenses)}.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="AED Hospital — income">
          <table className="table">
            <tbody>
              {AED_INCOME_STREAMS.map((s) => (
                <tr key={s}>
                  <td>
                    <Link className="hover:underline" href={r(STREAM_HREF[s])}>
                      {STREAM_LABELS[s]}
                    </Link>
                  </td>
                  <td className="num">{formatINR(data.income[s], { paise: true })}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">AED TOTAL INCOME</td>
                <td className="num font-semibold">{formatINR(data.totalIncome, { paise: true })}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="AED Hospital — expenses">
          <table className="table">
            <tbody>
              <tr>
                <td>
                  <Link className="hover:underline" href={r("/expenses?group=HOSPITAL")}>
                    {EXPENSE_LABELS.HOSPITAL}
                  </Link>
                </td>
                <td className="num">{formatINR(data.expense.HOSPITAL, { paise: true })}</td>
              </tr>
              <tr>
                <td>
                  <Link className="hover:underline" href={r("/expenses?group=OTHER")}>
                    {EXPENSE_LABELS.OTHER}
                  </Link>
                </td>
                <td className="num">{formatINR(data.expense.OTHER, { paise: true })}</td>
              </tr>
              <tr>
                <td className="font-semibold">AED TOTAL EXPENSE</td>
                <td className="num font-semibold">{formatINR(data.totalExpenses, { paise: true })}</td>
              </tr>
              {data.spreadExpenses > 0 && (
                <tr>
                  <td colSpan={2} className="text-xs muted">
                    Includes {formatINR(data.spreadExpenses)} — this day&apos;s share of monthly expenses (rent, salaries…) spread over the month.
                  </td>
                </tr>
              )}
              <tr>
                <td className="font-semibold">AED NET RESULT</td>
                <td className="num text-base font-bold" style={{ color: data.netOperatingResult < 0 ? "var(--bad)" : "var(--good)" }}>
                  {formatINR(data.netOperatingResult, { paise: true })}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      {(data.income.PHARMACY !== 0 || data.expense.PHARMACY_PURCHASE !== 0) && (
        <Card title="Hormonal Pharmacy — separate entity, not included in the AED figures above">
          <div className="grid gap-4 sm:grid-cols-2">
            <table className="table">
              <tbody>
                <tr>
                  <td>
                    <Link className="hover:underline" href={r("/pharmacy")}>
                      Sales (net of returns)
                    </Link>
                  </td>
                  <td className="num">{formatINR(data.income.PHARMACY, { paise: true })}</td>
                </tr>
                <tr>
                  <td>
                    <Link className="hover:underline" href={r("/pharmacy?tab=purchases")}>
                      {EXPENSE_LABELS.PHARMACY_PURCHASE}
                    </Link>
                  </td>
                  <td className="num">{formatINR(data.expense.PHARMACY_PURCHASE, { paise: true })}</td>
                </tr>
              </tbody>
            </table>
            <div className="text-sm">
              <p className="mb-1 text-xs font-medium text-2">Pharmacy collections by mode (its own counter — not in AED reconciliation)</p>
              <ul className="space-y-0.5">
                {data.streamByMode
                  .filter((x) => x.stream === "PHARMACY" && x.amount)
                  .map((x) => (
                    <li key={x.group} className="flex justify-between">
                      <span>{x.group === "BANK" ? "Bank transfer" : x.group === "UPI" ? "UPI" : x.group[0] + x.group.slice(1).toLowerCase()}</span>
                      <span className="tabular-nums">{formatINR(x.amount)}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-2 text-xs muted">
                Sales are not profit: medicine costs come in by supplier invoice on other days. Read the pharmacy month by month on{" "}
                <Link className="underline" href={`/hormonal-pharmacy?month=${data.date.slice(0, 7)}`}>
                  Hormonal Pharmacy → accounts
                </Link>
                .
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card
        title="Payment modes & reconciliation"
        actions={
          reconEditable ? (
            <Button size="sm" onClick={saveRecon} loading={saving}>
              Save reconciliation
            </Button>
          ) : data.status === "OPEN" ? (
            <span className="text-xs muted">Mark the day reviewed to reconcile</span>
          ) : null
        }
      >
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Mode</th>
                <th className="num">Expected collections</th>
                <th className="num">Actual collected</th>
                <th className="num">Variance</th>
                <th>Explanation (required if variance)</th>
                <th className="num">Expenses paid</th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliation.map((l) => {
                const act = actual[l.group];
                const variance = act === "" || act === undefined ? null : round2(Number(act) - l.expected);
                return (
                  <tr key={l.group}>
                    <td className="font-medium">
                      {MODE_LABEL[l.group]}
                      {l.stale && <Badge tone="amber" className="ml-1">changed since saved</Badge>}
                    </td>
                    <td className="num">{formatINR(l.expected, { paise: true })}</td>
                    <td className="num">
                      {reconEditable ? (
                        <input
                          aria-label={`Actual ${MODE_LABEL[l.group]}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          className="input !w-32 text-right"
                          value={act ?? ""}
                          onChange={(e) => setActual((a) => ({ ...a, [l.group]: e.target.value }))}
                          placeholder={String(l.expected)}
                        />
                      ) : l.actual === null ? (
                        <span className="muted">—</span>
                      ) : (
                        formatINR(l.actual, { paise: true })
                      )}
                    </td>
                    <td className="num" style={{ color: variance ? "var(--bad)" : undefined }}>
                      {variance === null ? "—" : formatINR(variance, { paise: true })}
                    </td>
                    <td>
                      {reconEditable ? (
                        <input aria-label={`Explanation ${MODE_LABEL[l.group]}`} className="input min-w-[200px]" value={expl[l.group] ?? ""} onChange={(e) => setExpl((x) => ({ ...x, [l.group]: e.target.value }))} placeholder={variance ? "Why is there a difference?" : ""} aria-invalid={!!variance && (expl[l.group] ?? "").length < 5} />
                      ) : (
                        <span className="text-sm">{l.explanation ?? ""}</span>
                      )}
                    </td>
                    <td className="num muted">{formatINR(data.paymentsByMode[l.group] ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {reconEditable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setActual(Object.fromEntries(data.reconciliation.map((l) => [l.group, String(l.expected)])))}>
              Fill actual = expected
            </Button>
            <input className="input flex-1" placeholder="Notes for the day (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        )}
      </Card>

      <ModuleInsights section="overview" defaultOpen={false} query={{ from: date, to: date, compareFrom: addDays(date, -7), compareTo: addDays(date, -7) }} title="Compare with the same weekday last week" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Volumes">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {(
              [
                ["Patients", data.counts.patients],
                ["New consults", data.counts.newConsultations],
                ["Old consults", data.counts.oldConsultations],
                ["Admissions", data.counts.admissions],
                ["Lab tests", data.counts.labTests],
                ["Pharmacy bills", data.counts.pharmacyTransactions],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs muted">{k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatNumber(v)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Closing history">
          {data.events.length === 0 ? (
            <p className="text-sm muted">No closing actions yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.action.replace(/_/g, " ").toLowerCase()}</span> ({e.fromStatus} → {e.toStatus}) by {e.userName ?? "system"} <span className="muted">· {formatDateTime(e.createdAt)}</span>
                  {e.reason && <p className="text-xs muted">Reason: {e.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <ConfirmDialog open={confirm === "review"} onClose={() => setConfirm(null)} title="Mark day as reviewed?" message="Confirms that all transactions for this day have been entered and checked." onConfirm={() => action("review")} />
      <ConfirmDialog
        open={confirm === "close"}
        onClose={() => setConfirm(null)}
        title={`Close ${formatDate(date)}?`}
        message="After closing, nobody can add, correct or void transactions for this date. Corrections will need approval, or an Admin must reopen the day."
        confirmLabel="Close day"
        onConfirm={() => action("close")}
      />
      <ConfirmDialog open={confirm === "reopen"} onClose={() => setConfirm(null)} title="Reopen this day?" message="Reopening is logged in the audit trail with your reason. The day must be reviewed, reconciled and closed again." confirmLabel="Reopen" danger requireReason onConfirm={(reason) => action("reopen", reason)} />
    </div>
  );
}

function RangeView({ from, to }: { from: string; to: string }) {
  const { data, error } = useApi<{ date: string; status: string; income: number; expenses: number; absVariance: number; lines: number }[]>(`/api/daily?from=${from}&to=${to}`);
  if (error) return <ErrorState error={error} />;
  if (!data) return <Spinner />;
  const ti = round2(data.reduce((a, d) => a + d.income, 0));
  const te = round2(data.reduce((a, d) => a + d.expenses, 0));
  return (
    <Card title={`${formatDate(from)} – ${formatDate(to)}`} actions={<span className="text-sm">Income {formatINR(ti)} · Expenses {formatINR(te)} · Net {formatINR(round2(ti - te))}</span>}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th className="num">Income</th>
              <th className="num">Expenses</th>
              <th className="num">Net</th>
              <th className="num">|Variance|</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>
                  <Link className="underline" href={`/daily-accounts?date=${d.date}`}>
                    {formatDate(d.date)}
                  </Link>
                </td>
                <td>
                  <StatusBadge status={d.status} />
                </td>
                <td className="num">{formatINR(d.income)}</td>
                <td className="num">{formatINR(d.expenses)}</td>
                <td className="num">{formatINR(round2(d.income - d.expenses))}</td>
                <td className="num">{d.absVariance ? formatINR(d.absVariance) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { today } = useSession();
  const from = sp.get("from");
  const to = sp.get("to");
  const range = from && to && from !== to;
  const date = sp.get("date") || (from && from === to ? from : today);
  const go = (d: string) => router.replace(`${path}?date=${d}`);
  return (
    <>
      <PageHeader
        title="Daily Accounts"
        subtitle="Income, expenses, net result, payment modes and the daily closing workflow"
        actions={
          !range && (
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => go(addDays(date, -1))} aria-label="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Date" />
              <Button variant="secondary" size="sm" onClick={() => go(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {date !== today && (
                <Button variant="ghost" size="sm" onClick={() => go(today)}>
                  Today
                </Button>
              )}
            </div>
          )
        }
      />
      {range ? <RangeView from={from!} to={to!} /> : <DayView key={date} date={date} />}
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
