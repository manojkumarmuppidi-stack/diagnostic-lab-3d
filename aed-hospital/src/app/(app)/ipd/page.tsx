"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Card, EmptyState, Field, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { masterOptions, useCan, useMasters } from "@/components/session";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { apiFetch, useApi } from "@/lib/client";
import { formatDate, todayISO } from "@/lib/dates";
import { formatINR } from "@/lib/money";

type Tab = "admissions" | "payments" | "outstanding";

type Due = {
  id: string;
  patientName: string | null;
  admissionDate: string;
  dischargeDate: string | null;
  admissionType: string;
  billed: number;
  collected: number;
  balance: number;
};

/**
 * Admissions with money still due. Tick the ones that have paid in full and record their balances in
 * one go (a final settlement each, on one date or on each patient's discharge date).
 */
function Outstanding() {
  const can = useCan();
  const toast = useToast();
  const { masters } = useMasters();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const { data: d, reload } = useApi<{ list: Due[]; total: number }>(`/api/ipd/outstanding?from=${from}&to=${to}`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState("");
  const [dateMode, setDateMode] = useState<"discharge" | "fixed">("discharge");
  const [date, setDate] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPicked(new Set()), [d]);
  const writable = can("ipd.write");
  const modes = masterOptions(masters, "paymentModes");
  const list = d?.list ?? [];
  const chosen = list.filter((x) => picked.has(x.id));
  const chosenTotal = chosen.reduce((a, x) => a + x.balance, 0);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const settle = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ settled: number; amount: number }>("/api/ipd/settle", {
        method: "POST",
        json: { admissionIds: chosen.map((x) => x.id), paymentModeId: mode, dateMode, date: dateMode === "fixed" ? date : null },
      });
      toast("success", `${r.settled} admission${r.settled === 1 ? "" : "s"} marked fully paid — ${formatINR(r.amount)} recorded as IPD income`);
      setConfirming(false);
      reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={`Outstanding balances · ${formatINR(d?.total ?? 0)}`}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Admitted from">
          <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label="to">
          <input type="date" className="input" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
      </div>
      {!d ? (
        <Spinner />
      ) : !list.length ? (
        <EmptyState title="No outstanding IPD balances for admissions in these dates" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {writable && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={picked.size === list.length}
                        onChange={(e) => setPicked(e.target.checked ? new Set(list.map((x) => x.id)) : new Set())}
                      />
                    </th>
                  )}
                  <th>Admitted</th>
                  <th>Discharged</th>
                  <th>Patient</th>
                  <th>Type</th>
                  <th className="num">Billed</th>
                  <th className="num">Collected</th>
                  <th className="num">Balance due</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} onClick={writable ? () => toggle(o.id) : undefined} className={writable ? "cursor-pointer" : undefined}>
                    {writable && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${o.patientName ?? "admission"}`} checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
                      </td>
                    )}
                    <td>{formatDate(o.admissionDate)}</td>
                    <td>{o.dischargeDate ? formatDate(o.dischargeDate) : "—"}</td>
                    <td>
                      <Link className="underline" href={`/ipd?q=${encodeURIComponent(o.patientName ?? "")}&from=&to=`} onClick={(e) => e.stopPropagation()}>
                        {o.patientName ?? "—"}
                      </Link>
                    </td>
                    <td>{o.admissionType}</td>
                    <td className="num">{formatINR(o.billed)}</td>
                    <td className="num">{formatINR(o.collected)}</td>
                    <td className="num font-semibold">{formatINR(o.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {writable && (
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <Field label="Paid by">
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="">Choose…</option>
                  {modes.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Received on">
                <select className="input" value={dateMode} onChange={(e) => setDateMode(e.target.value as "discharge" | "fixed")}>
                  <option value="discharge">Each patient&apos;s discharge date</option>
                  <option value="fixed">One date for all</option>
                </select>
              </Field>
              {dateMode === "fixed" && (
                <Field label="Date">
                  <input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
                </Field>
              )}
              <Button disabled={!chosen.length || !mode} onClick={() => setConfirming(true)}>
                Mark {chosen.length || ""} selected as fully paid{chosen.length ? ` · ${formatINR(chosenTotal)}` : ""}
              </Button>
            </div>
          )}
        </>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Mark as fully paid?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={settle} loading={busy}>
              Record {formatINR(chosenTotal)}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {chosen.length} admission{chosen.length === 1 ? "" : "s"}: each gets a final settlement for its balance due, {formatINR(chosenTotal)} in all, paid by{" "}
          {modes.find((m: any) => m.id === mode)?.name ?? "—"},{" "}
          {dateMode === "fixed" ? `on ${formatDate(date)}` : "on each patient's discharge date (admission date if not discharged)"}. This is IPD income in the core accounts. A
          mistake is undone like any payment: void it from Payments &amp; refunds.
        </p>
      </Modal>
    </Card>
  );
}

function IpdInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (sp.get("tab") as Tab) || "admissions";
  const setTab = (t: Tab) => {
    const n = new URLSearchParams(sp.toString());
    n.set("tab", t);
    router.replace(`${path}?${n.toString()}`);
  };
  return (
    <div className="space-y-4">
      <ModuleInsights section="ipd" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "admissions", label: "Admissions" },
          { key: "payments", label: "Payments & refunds" },
          { key: "outstanding", label: "Outstanding" },
        ]}
      />
      {tab === "admissions" && <ModuleList module="ipd" embedded />}
      {tab === "payments" && <ModuleList module="ipd-payment" embedded />}
      {tab === "outstanding" && <Outstanding />}
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="ipd.view">
      <PageHeader title="IPD" subtitle="Admissions, advances, payments, refunds and settlements. IPD income = money collected." />
      <Suspense fallback={<Spinner />}>
        <IpdInner />
      </Suspense>
    </Guard>
  );
}
