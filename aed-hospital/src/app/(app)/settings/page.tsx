"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { apiFetch, useApi } from "@/lib/client";
import { Button, Card, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function SettingsPage() {
  const { data, reload } = useApi<any>("/api/settings");
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setV(data), [data]);
  if (!v) return <Spinner />;
  const a = (k: string, val: any) => setV({ ...v, alerts: { ...v.alerts, [k]: val } });
  const save = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/settings", { method: "PUT", json: v });
      toast("success", "Settings saved");
      reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const num = (k: string, label: string, help?: string) => (
    <Field label={label} help={help}>
      <input className="input" type="number" value={v.alerts[k]} onChange={(e) => a(k, Number(e.target.value))} />
    </Field>
  );
  return (
    <Guard perm="settings.manage">
      <PageHeader title="Settings" actions={<Button onClick={save} loading={busy}>Save</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Hospital">
          <div className="space-y-3">
            <Field label="Hospital name">
              <input className="input" value={v.hospitalName} onChange={(e) => setV({ ...v, hospitalName: e.target.value })} />
            </Field>
            <Field label="Address (reports header)">
              <input className="input" value={v.hospitalAddress} onChange={(e) => setV({ ...v, hospitalAddress: e.target.value })} />
            </Field>
            <Field label="Financial year starts in" help="Used for 'This Quarter', 'This Year' and 'Previous Year'. Indian FY = April.">
              <select className="input" value={v.fiscalYearStartMonth} onChange={(e) => setV({ ...v, fiscalYearStartMonth: Number(e.target.value) })}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>
        <Card title="Alerts & thresholds">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.alerts.enabled} onChange={(e) => a("enabled", e.target.checked)} /> Show alerts on the dashboard
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {num("unclosedDaysLookback", "Check unclosed days for the last (days)")}
              {num("missingDataLookbackDays", "Check missing OPD data for the last (days)")}
              {num("largeExpenseAmount", "Large expense threshold (₹)")}
              {num("revenueDeviationPct", "Revenue change alert (%)", "vs the comparison period")}
              {num("outstandingIpdAmount", "Alert when IPD outstanding ≥ (₹)")}
              {num("reconVarianceTolerance", "Ignore reconciliation variance up to (₹)")}
            </div>
          </div>
        </Card>
      </div>
    </Guard>
  );
}
