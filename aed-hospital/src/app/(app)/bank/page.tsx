"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Bank statement check: upload the bank's statements and see, month by month, whether the money that
 * reached the bank matches the UPI / card collections recorded, and which payments have no expense or
 * pharmacy purchase in the core accounts. Nothing is booked from here.
 */
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { apiFetch, download, useApi } from "@/lib/client";
import { todayISO } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { masterOptions, useCan, useMasters } from "@/components/session";
import { colLabel } from "@/components/departments/insights";

const inr = (v: number) => (v ? formatINR(Math.round(v)) : "—");

function UploadButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  return (
    <>
      <label className={`btn btn-primary ${busy ? "pointer-events-none opacity-70" : "cursor-pointer"}`}>
        {busy ? <Spinner /> : <Upload className="h-4 w-4" />} {busy ? "Uploading…" : "Upload bank statements"}
        <input
          type="file"
          multiple
          accept=".xls,.txt,.csv"
          className="sr-only"
          disabled={busy}
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (!files.length) return;
            const fd = new FormData();
            for (const f of files) fd.append("file", f);
            setBusy(true);
            try {
              const r: any = await apiFetch("/api/bank/import", { method: "POST", body: fd });
              setResult({
                ok: true,
                lines: [
                  `${r.added} new lines saved (${r.lines - r.added} were already here).`,
                  ...r.files.map((f: any) => `${f.file}: account ${f.account}, ${f.from} to ${f.to}, ${f.lines} lines, ${f.added} new`),
                ],
              });
              onDone();
            } catch (err: any) {
              setResult({ ok: false, lines: [err.message] });
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title={result?.ok ? "Statements uploaded" : "Nothing was saved"}
        footer={<Button onClick={() => setResult(null)}>OK</Button>}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm" style={result?.ok ? undefined : { color: "var(--status-bad)" }}>
          {result?.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

/** Upload the reviewed payments sheet: rows marked "Yes" become expenses, each re-checked first. */
function ReviewedUpload({ onDone }: { onDone: () => void }) {
  const can = useCan();
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  return (
    <>
      <span className="flex items-center gap-2">
        <label
          className={`btn btn-secondary ${busy ? "pointer-events-none opacity-70" : "cursor-pointer"}`}
          title='The payments sheet after you marked "Enter as expense?" Yes and chose the expense head'
        >
          {busy ? <Spinner /> : <Upload className="h-4 w-4" />} {busy ? "Entering…" : "Upload reviewed list"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const fd = new FormData();
              fd.append("file", file);
              if (closed) fd.append("intoClosedDays", "1");
              setBusy(true);
              try {
                const r: any = await apiFetch("/api/bank/book-sheet", { method: "POST", body: fd });
                setResult({
                  ok: true,
                  lines: [
                    `${r.booked} expense${r.booked === 1 ? "" : "s"} entered, ${formatINR(r.amount)}.`,
                    ...(r.skipped ? [`${r.skipped} skipped: already in the core accounts.`] : []),
                    ...(r.notFound
                      ? [
                          `${r.notFound} rows were not found among the bank lines in the app: upload those months' SBI statements first (Upload bank statements), then this list again.`,
                        ]
                      : []),
                  ],
                });
                onDone();
              } catch (err: any) {
                setResult({ ok: false, lines: String(err.message).split(/;\s+(?=row)/) });
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {can("accounts.reopen") && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> allow closed days
          </label>
        )}
      </span>
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title={result?.ok ? "Expenses entered" : "Nothing was entered"}
        footer={<Button onClick={() => setResult(null)}>OK</Button>}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm" style={result?.ok ? undefined : { color: "var(--status-bad)" }}>
          {result?.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

/** Enter one payee's payments that have no core entry as expenses (one per payment, on the bank's date). */
function BookDialog({ row, lines, kinds, onClose, onDone }: { row: any; lines: any[]; kinds: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const can = useCan();
  const toast = useToast();
  const { masters } = useMasters();
  const [cat, setCat] = useState("");
  const [sub, setSub] = useState("");
  const [dept, setDept] = useState("");
  const [desc, setDesc] = useState(row.party === "(no name)" ? "" : row.party);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const subs = masterOptions(masters, "expenseSubcategories", { parentId: cat });
  const save = async () => {
    setBusy(true);
    try {
      const r: any = await apiFetch("/api/bank/book", {
        method: "POST",
        json: { lineIds: lines.map((l) => l.id), categoryId: cat, subcategoryId: sub || null, departmentId: dept || null, description: desc, intoClosedDays: closed },
      });
      toast(
        "success",
        `${r.booked} expense${r.booked === 1 ? "" : "s"} entered, ${formatINR(r.amount)}${r.skipped ? ` · ${r.skipped} skipped (already in the core accounts)` : ""}`,
      );
      onDone();
      onClose();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Enter as expenses: ${row.party}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!cat}>
            Enter {lines.length} expense{lines.length === 1 ? "" : "s"} · {inr(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          {lines.length} payment{lines.length === 1 ? "" : "s"} by {kinds[row.kind] ?? row.kind} with no expense of the same amount near that date. Each becomes one expense on the
          bank&apos;s date. Only enter them if they are AED&apos;s expenses — loans, owner payments, assets and transfers belong in the suspense list instead.
        </p>
        <div className="max-h-40 overflow-y-auto rounded border p-2 text-xs" style={{ borderColor: "var(--border)" }}>
          {lines.map((l) => (
            <div key={l.id} className="flex justify-between gap-2">
              <span>{l.date}</span>
              <span>{inr(l.amount)}</span>
            </div>
          ))}
        </div>
        <Field label="Expense head" required>
          <select className="input" value={cat} onChange={(e) => (setCat(e.target.value), setSub(""))}>
            <option value="">Choose…</option>
            {masterOptions(masters, "expenseCategories").map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {subs.length > 0 && (
          <Field label="Sub-head">
            <select className="input" value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="">—</option>
              {subs.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Department (optional)">
          <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">—</option>
            {masterOptions(masters, "departments").map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" help="The supplier's name is kept as the vendor, so department rules (e.g. Lab suppliers) find these expenses">
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        {can("accounts.reopen") && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Allow entering on days that are already closed (their closing totals are
            refreshed)
          </label>
        )}
      </div>
    </Modal>
  );
}

function Report() {
  const can = useCan();
  const toast = useToast();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [all, setAll] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const canBook = can("expense.write");
  const { data, error, reload } = useApi<any>(`/api/bank?from=${from}&to=${to}`);
  const tot = (rows: any[], k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From">
            <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
          {data?.imported?.from && (
            <p className="pb-2 text-sm muted">
              Statements uploaded: {data.imported.from} to {data.imported.to} · {data.imported.lines} lines
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!data?.months?.length}
            onClick={async () => {
              try {
                await download(`/api/bank/export?from=${from}&to=${to}`);
              } catch (e: any) {
                toast("error", e.message);
              }
            }}
          >
            <Download className="h-4 w-4" /> Download Excel
          </Button>
          {can("expense.write") && <ReviewedUpload onDone={reload} />}
          {can("accounts.reconcile") && <UploadButton onDone={reload} />}
        </div>
      </div>
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && !data.months.length && <EmptyState title="No bank lines for these dates" detail="Upload the bank's statements (SBI: Account Statement → download as Excel)." />}
      {data?.months?.length > 0 && (
        <>
          <Card title="Money in — UPI / card collections: bank vs the core accounts">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Reached the bank</th>
                    <th className="num">Recorded: AED</th>
                    <th className="num">Recorded: pharmacy</th>
                    <th className="num">Difference</th>
                    <th className="num">Other money in</th>
                  </tr>
                </thead>
                <tbody>
                  {data.moneyIn.map((r: any) => {
                    const diff = r.bank - r.aed - r.pharmacy;
                    return (
                      <tr key={r.month}>
                        <td>{colLabel(r.month)}</td>
                        <td className="num">{inr(r.bank)}</td>
                        <td className="num">{inr(r.aed)}</td>
                        <td className="num">{inr(r.pharmacy)}</td>
                        <td className="num font-semibold" style={{ color: Math.abs(diff) > 0.02 * (r.bank || 1) ? "var(--status-bad)" : undefined }}>
                          {inr(diff)}
                        </td>
                        <td className="num">{inr(r.otherIn)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td>Total</td>
                    <td className="num">{inr(tot(data.moneyIn, "bank"))}</td>
                    <td className="num">{inr(tot(data.moneyIn, "aed"))}</td>
                    <td className="num">{inr(tot(data.moneyIn, "pharmacy"))}</td>
                    <td className="num">{inr(tot(data.moneyIn, "bank") - tot(data.moneyIn, "aed") - tot(data.moneyIn, "pharmacy"))}</td>
                    <td className="num">{inr(tot(data.moneyIn, "otherIn"))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs muted">
              Settlements reach the bank a day or two late and after the provider&apos;s charges, so small differences are normal; a large one means collections not recorded (or
              recorded as UPI but taken in cash).
            </p>
          </Card>
          <Card title="Money out — payments from the bank vs the core accounts">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Paid from the bank</th>
                    <th className="num">Matched to an entry</th>
                    <th className="num">Own transfers &amp; cash</th>
                    <th className="num">Not found in core</th>
                  </tr>
                </thead>
                <tbody>
                  {data.moneyOut.map((r: any) => (
                    <tr key={r.month}>
                      <td>{colLabel(r.month)}</td>
                      <td className="num">{inr(r.total)}</td>
                      <td className="num">{inr(r.matched)}</td>
                      <td className="num">{inr(r.notExpense)}</td>
                      <td className="num font-semibold">{inr(r.unmatched)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td>Total</td>
                    <td className="num">{inr(tot(data.moneyOut, "total"))}</td>
                    <td className="num">{inr(tot(data.moneyOut, "matched"))}</td>
                    <td className="num">{inr(tot(data.moneyOut, "notExpense"))}</td>
                    <td className="num">{inr(tot(data.moneyOut, "unmatched"))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs muted">
              A payment matches an expense or pharmacy purchase of the same amount dated up to 45 days before it or 5 days after. Bills entered as one monthly total (e.g. salaries)
              do not match single payments — check those by payee below.
            </p>
          </Card>
          <Card title={`Payments not found in the core accounts — by payee (${data.unmatchedByPayee.length})`}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Paid to</th>
                    <th>How</th>
                    <th className="num">Payments</th>
                    <th className="num">Amount</th>
                    <th>Months</th>
                    {canBook && <th />}
                  </tr>
                </thead>
                <tbody>
                  {(all ? data.unmatchedByPayee : data.unmatchedByPayee.slice(0, 40)).map((r: any) => (
                    <tr key={`${r.kind}|${r.party}`}>
                      <td>{r.party}</td>
                      <td>{data.kinds[r.kind] ?? r.kind}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{inr(r.amount)}</td>
                      <td className="text-xs">{r.months.map((m: string) => colLabel(m)).join(", ")}</td>
                      {canBook && (
                        <td className="text-right">
                          <Button size="sm" variant="secondary" onClick={() => setBooking(r)}>
                            Enter as expenses
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.unmatchedByPayee.length > 40 && (
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAll(!all)}>
                {all ? "Show the top 40" : `Show all ${data.unmatchedByPayee.length}`}
              </Button>
            )}
          </Card>
          {booking && (
            <BookDialog
              row={booking}
              lines={data.unmatched.filter((u: any) => u.kind === booking.kind && (u.party ?? "(no name)").toLowerCase() === booking.party.toLowerCase())}
              kinds={data.kinds}
              onClose={() => setBooking(null)}
              onDone={reload}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="accounts.view">
      <PageHeader
        title="Bank statement check"
        subtitle="The bank against the core accounts: collections that reached the bank, and payments with no entry. Nothing is booked from here."
      />
      <Report />
    </Guard>
  );
}
