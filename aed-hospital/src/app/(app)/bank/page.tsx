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
import { useCan } from "@/components/session";
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

function Report() {
  const can = useCan();
  const toast = useToast();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [all, setAll] = useState(false);
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
