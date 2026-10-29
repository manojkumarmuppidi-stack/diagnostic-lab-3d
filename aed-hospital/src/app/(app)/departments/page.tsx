"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Department-wise accounts: is each department (USG scan room, Cardiac, JJ Wellness …) making money?
 * Profit = billed income + margin on its pharmacy medicines − its own expenses − staff incentive, with the
 * partner's share (JJ Wellness 20%); then income month by month with the billed items behind it.
 */
import { Fragment, Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Info, Pencil, Plus, ShieldAlert, Trash2, Upload } from "lucide-react";
import { apiFetch, useApi } from "@/lib/client";
import { endOfMonth, todayISO } from "@/lib/dates";
import { formatINR, formatINRCompact, formatNumber } from "@/lib/money";
import { recentMonths } from "@/lib/periods";
import { STREAM_LABELS } from "@/lib/accounting";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { useCan, useSession } from "@/components/session";
import { BarsChart, ChartCard, SLOT } from "@/components/charts/Charts";
import { AllDepartmentsInsights, colLabel, costGroups, DepartmentInsights, incomeGroups, Section } from "@/components/departments/insights";

const money = (v: number | undefined) => (v ? formatINR(v) : "—");
const signed = (v: number) => <span style={{ color: v < 0 ? "var(--status-bad)" : undefined }}>{formatINR(v)}</span>;

function Verdict({ st }: { st: any }) {
  if (!st.costsEntered) return <Badge tone="neutral">Costs not entered</Badge>;
  if (st.totals.profit > 0) return <Badge tone="green">Profit</Badge>;
  if (st.totals.profit < 0) return <Badge tone="red">Loss</Badge>;
  return <Badge tone="neutral">Break-even</Badge>;
}

const EMPTY_COST = {
  label: "",
  kind: "FIXED",
  amount: "",
  percent: "",
  categoryId: "",
  fromMonth: "",
  toMonth: "",
};

function CostDialog({
  open,
  onClose,
  onSaved,
  departmentId,
  cost,
  months,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  departmentId: string;
  cost: any | null;
  months: { value: string; label: string }[];
}) {
  const toast = useToast();
  const { data: opts } = useApi<any>(open ? "/api/departments/costs" : null);
  const [v, setV] = useState<any>(EMPTY_COST);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setV(
      cost
        ? {
            ...cost,
            amount: cost.amount || "",
            percent: cost.percent || "",
            categoryId: cost.categoryId ?? "",
            toMonth: cost.toMonth ?? "",
          }
        : { ...EMPTY_COST, fromMonth: todayISO().slice(0, 7) },
    );
  }, [open, cost]);
  const set = (k: string, val: string) => setV((x: any) => ({ ...x, [k]: val }));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        departmentId,
        label: v.label,
        kind: v.kind,
        amount: Number(v.amount) || 0,
        percent: Number(v.percent) || 0,
        categoryId: v.categoryId || null,
        fromMonth: v.fromMonth,
        toMonth: v.toMonth || null,
      };
      await apiFetch(cost ? `/api/departments/costs/${cost.id}` : "/api/departments/costs", { method: cost ? "PATCH" : "POST", json: body });
      toast("success", cost ? "Cost updated" : "Cost added");
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const cats = (opts?.categories ?? []).filter((c: any) => !c.parentId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cost ? "Edit cost" : "Add a cost to this department"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="What is it" required help="e.g. Rent for 500 sq ft, Electricity share, Salary — Swarna (counsellor)">
          <input className="input" value={v.label} onChange={(e) => set("label", e.target.value)} />
        </Field>
        <Field label="How much">
          <select className="input" value={v.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="FIXED">A fixed amount every month</option>
            <option value="SHARE">A % of what the hospital spends on an expense category that month</option>
            <option value="INCOME">A % of this department&apos;s own billed income that month (incentives)</option>
          </select>
        </Field>
        {v.kind === "INCOME" ? (
          <Field
            label="Percent of the department's billed income (%)"
            required
            help="Packages, tests and consultations billed to this department that month — not the injection margin"
          >
            <input className="input" type="number" min={0} max={100} step="0.01" value={v.percent} onChange={(e) => set("percent", e.target.value)} />
          </Field>
        ) : v.kind === "FIXED" ? (
          <Field label="Amount per month (₹)" required>
            <input className="input" type="number" min={0} value={v.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Percent (%)" required>
              <input className="input" type="number" min={0} max={100} step="0.01" value={v.percent} onChange={(e) => set("percent", e.target.value)} />
            </Field>
            <Field label="of the hospital's expense category" required>
              <select className="input" value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">Choose…</option>
                {cats.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From month" required>
            <select className="input" value={v.fromMonth} onChange={(e) => set("fromMonth", e.target.value)}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Until month" help="Leave empty to keep it every month">
            <select className="input" value={v.toMonth} onChange={(e) => set("toMonth", e.target.value)}>
              <option value="">Every month from then on</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-xs muted">This is for department accounts only. It is not a hospital expense and does not change the hospital&apos;s income or expenditure.</p>
        {err && (
          <p className="text-sm" style={{ color: "var(--status-bad)" }}>
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Upload a costs workbook: for one department, or (with a Department column) for every department. */
function ImportButton({ departmentId, label = "Import from Excel", onDone }: { departmentId: string | null; label?: string; onDone: () => void }) {
  const toast = useToast();
  return (
    <label className="btn btn-secondary btn-sm cursor-pointer" title="Salaries, repairs and other costs (and people's income generated) from one Excel file">
      <Upload className="h-4 w-4" /> {label}
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const fd = new FormData();
          fd.append("file", file);
          if (departmentId) fd.append("departmentId", departmentId);
          try {
            const r: any = await apiFetch("/api/departments/import", { method: "POST", body: fd });
            const where = r.departments?.length > 1 ? `${r.departments.length} departments` : r.department;
            toast(
              "success",
              `${where}: ${r.costsAdded} costs added, ${r.costsUpdated} updated${r.people ? `, ${r.people} people, ${r.incomeMonths} months of income generated` : ""}`,
            );
            onDone();
          } catch (err: any) {
            toast("error", err.message);
          }
        }}
      />
    </label>
  );
}

function Statement({ st, months, monthOptions, onChanged }: { st: any; months: string[]; monthOptions: { value: string; label: string }[]; onChanged: () => void }) {
  const can = useCan();
  const me = useSession();
  const toast = useToast();
  const admin = can("masters.manage");
  // Admins change any cost; the department's head adds costs and changes the ones they added.
  const edit = admin || me.headOfDepartmentId === st.id;
  const canChange = (c: any) => admin || (me.headOfDepartmentId === st.id && c.createdById === me.id);
  const [dialog, setDialog] = useState<{ cost: any | null } | null>(null);
  const [removing, setRemoving] = useState<any | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpenGroups((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const { data: costs, reload } = useApi<any[]>(`/api/departments/costs?departmentId=${st.id}`);
  const changed = () => {
    reload();
    onChanged();
  };
  const cols = months.length + 2;
  const row = (
    label: ReactNode,
    byMonth: Record<string, number>,
    total: number,
    opts: {
      bold?: boolean;
      minus?: boolean;
      sub?: ReactNode;
      actions?: ReactNode;
    } = {},
  ) => (
    <tr className={opts.bold ? "font-semibold" : undefined}>
      <td className={opts.bold ? undefined : "pl-6"}>
        <div className="flex items-start justify-between gap-2">
          <span>
            {label}
            {opts.sub && <span className="block text-xs muted">{opts.sub}</span>}
          </span>
          {opts.actions}
        </div>
      </td>
      {months.map((m) => (
        <td key={m} className="num">
          {byMonth[m] ? (opts.minus ? `−${formatINRCompact(byMonth[m])}` : formatINRCompact(byMonth[m])) : ""}
        </td>
      ))}
      <td className="num">{total ? (opts.minus ? `−${formatINR(total)}` : formatINR(total)) : "—"}</td>
    </tr>
  );
  const head = (t: string) => (
    <tr>
      <td colSpan={cols} className="pt-4 text-xs font-semibold uppercase tracking-wide text-2">
        {t}
      </td>
    </tr>
  );
  return (
    <Card
      title={
        <span>
          {st.name} — income, costs and profit
          <span className="ml-2 text-xs font-normal muted">
            income {formatINR(st.totals.income)} · costs −{formatINR(st.totals.costs)} · profit {formatINR(st.totals.profit)}
          </span>
        </span>
      }
      actions={
        <span className="flex flex-wrap gap-2">
          {edit && <ImportButton departmentId={st.id} onDone={changed} />}
          {edit && (
            <Button size="sm" onClick={() => setDialog({ cost: null })}>
              <Plus className="h-4 w-4" /> Add cost
            </Button>
          )}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th />
              {months.map((m) => (
                <th key={m} className="num whitespace-nowrap">
                  {colLabel(m)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {head("Income — from every source")}
            {st.incomeLines.length === 0 && (
              <tr>
                <td colSpan={cols} className="pl-6 text-sm muted">
                  No income in this period.
                </td>
              </tr>
            )}
            {incomeGroups(st.incomeLines).map((g) =>
              g.lines.length === 1 ? (
                <Fragment key={g.key}>
                  {row(g.lines[0].name, g.lines[0].byMonth, g.lines[0].total, {
                    sub: g.lines[0].count
                      ? `${STREAM_LABELS[g.lines[0].stream as keyof typeof STREAM_LABELS] ?? g.lines[0].stream} · ${formatNumber(g.lines[0].count)} bills/tests`
                      : undefined,
                  })}
                </Fragment>
              ) : (
                <Fragment key={g.key}>
                  {row(
                    <button type="button" className="flex items-center gap-1 text-left hover:underline" onClick={() => toggle(g.key)} aria-expanded={openGroups.has(g.key)}>
                      {openGroups.has(g.key) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      {g.label}
                    </button>,
                    g.byMonth,
                    g.total,
                    { sub: `${g.lines.length} billed items${g.count ? ` · ${formatNumber(g.count)} bills/tests` : ""} — tap to see them` },
                  )}
                  {openGroups.has(g.key) &&
                    g.lines.map((l: any) => (
                      <tr key={`${l.stream}|${l.name}`} className="text-xs">
                        <td className="pl-12">
                          {l.name}
                          {l.count ? <span className="muted"> · {formatNumber(l.count)}</span> : null}
                        </td>
                        {months.map((m) => (
                          <td key={m} className="num muted">
                            {l.byMonth[m] ? formatINRCompact(l.byMonth[m]) : ""}
                          </td>
                        ))}
                        <td className="num">{formatINR(l.total)}</td>
                      </tr>
                    ))}
                </Fragment>
              ),
            )}
            {row("Total income", st.income, st.totals.income, { bold: true })}
            {head("Costs — the shares you allocate to this department")}
            {st.costLines.length === 0 && (
              <tr>
                <td colSpan={cols} className="pl-6 text-sm muted">
                  No costs entered yet
                  {edit ? " — use “Add cost” for its rent share, power share and the salaries of its staff." : "."}
                </td>
              </tr>
            )}
            {costGroups(st.costLines).map((g) => (
              <Fragment key={g.key}>
                {row(
                  <button
                    type="button"
                    className="flex items-center gap-1 text-left hover:underline"
                    onClick={() => toggle(`cost:${g.key}`)}
                    aria-expanded={openGroups.has(`cost:${g.key}`)}
                  >
                    {openGroups.has(`cost:${g.key}`) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    {g.label}
                  </button>,
                  g.byMonth,
                  g.total,
                  {
                    minus: true,
                    sub: `${new Set(g.lines.map((l: any) => l.label)).size} item${new Set(g.lines.map((l: any) => l.label)).size === 1 ? "" : "s"} — tap to see${edit ? " and edit" : ""} them`,
                  },
                )}
                {openGroups.has(`cost:${g.key}`) &&
                  g.lines.map((l: any) => {
                    const c = l.id ? costs?.find((x: any) => x.id === l.id) : null;
                    return (
                      <tr key={l.id ?? l.label} className="text-xs">
                        <td className="pl-12">
                          <div className="flex items-start justify-between gap-2">
                            <span>
                              {l.label}
                              <span className="block muted">{l.basis}</span>
                            </span>
                            {c && canChange(c) && (
                              <span className="flex shrink-0 gap-1">
                                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${l.label}`} onClick={() => setDialog({ cost: c })}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${l.label}`} onClick={() => setRemoving(c)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                        {months.map((m) => (
                          <td key={m} className="num muted">
                            {l.byMonth[m] ? `−${formatINRCompact(l.byMonth[m])}` : ""}
                          </td>
                        ))}
                        <td className="num">{l.total ? `−${formatINR(l.total)}` : "—"}</td>
                      </tr>
                    );
                  })}
              </Fragment>
            ))}
            {row("Total costs", st.costs, st.totals.costs, {
              bold: true,
              minus: true,
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>
                Profit <Verdict st={st} /> {st.marginPct !== null && <span className="text-xs muted">margin {st.marginPct.toFixed(0)}%</span>}
              </td>
              {months.map((m) => (
                <td key={m} className="num">
                  {st.profit[m] ? signed(st.profit[m]) : ""}
                </td>
              ))}
              <td className="num">{signed(st.totals.profit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {st.missingCost > 0 && <p className="mt-2 text-xs muted">{st.missingCost} medicine lines have no purchase cost, so their margin is counted as ₹0.</p>}
      <CostDialog open={!!dialog} onClose={() => setDialog(null)} onSaved={changed} departmentId={st.id} cost={dialog?.cost ?? null} months={monthOptions} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this cost?"
        message={removing ? `“${removing.label}” will no longer be charged to ${st.name}.` : ""}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          await apiFetch(`/api/departments/costs/${removing.id}`, {
            method: "DELETE",
          });
          toast("success", "Cost removed");
          setRemoving(null);
          changed();
        }}
      />
    </Card>
  );
}

function Contributors({ st, months, onChanged }: { st: any; months: string[]; onChanged: () => void }) {
  const can = useCan();
  const toast = useToast();
  const admin = can("masters.manage");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast("success", ok);
      onChanged();
    } catch (e: any) {
      toast("error", e.message);
    }
  };
  const saveIncome = (id: string, month: string, value: string, old: number | undefined) => {
    const amount = value.trim() === "" ? null : Number(value);
    if ((amount ?? 0) === (old ?? 0) || (amount !== null && !Number.isFinite(amount))) return;
    run(() => apiFetch(`/api/departments/contributors/${id}/income`, { method: "PUT", json: { month, amount } }));
  };
  if (!st.contributors.length && !admin) return <p className="text-sm muted">No one recorded for this department.</p>;
  return (
    <div>
      {admin && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add person
          </Button>
        </div>
      )}
      <p className="mb-3 text-xs muted">
        The income each person generated is entered here only to work out their incentive: it is not added to {st.name}&apos;s income, which comes from the bills. Each incentive
        appears under Costs above.
      </p>
      {st.contributors.length === 0 ? (
        <p className="text-sm muted">No one added yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th className="num">Incentive %</th>
                {months.map((m) => (
                  <th key={m} className="num whitespace-nowrap">
                    {colLabel(m)}
                  </th>
                ))}
                <th className="num">Income generated</th>
                <th className="num">Share of income</th>
                <th className="num">Incentive</th>
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {st.contributors.map((c: any) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap font-medium">{c.name}</td>
                  <td className="num">
                    {admin ? (
                      <input
                        className="input !w-20 text-right"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        defaultValue={c.incentivePct || ""}
                        aria-label={`Incentive % for ${c.name}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value) || 0;
                          if (v !== c.incentivePct)
                            run(
                              () => apiFetch(`/api/departments/contributors/${c.id}`, { method: "PATCH", json: { departmentId: st.id, name: c.name, incentivePct: v } }),
                              "Incentive % saved",
                            );
                        }}
                      />
                    ) : c.incentivePct ? (
                      `${c.incentivePct}%`
                    ) : (
                      "—"
                    )}
                  </td>
                  {months.map((m) => (
                    <td key={m} className="num">
                      {admin ? (
                        <input
                          key={`${c.id}|${m}|${c.generated[m] ?? ""}`}
                          className="input !w-24 text-right"
                          type="number"
                          min={0}
                          defaultValue={c.generated[m] ?? ""}
                          aria-label={`${c.name} income generated ${colLabel(m)}`}
                          onBlur={(e) => saveIncome(c.id, m, e.target.value, c.generated[m])}
                        />
                      ) : c.generated[m] ? (
                        formatINRCompact(c.generated[m])
                      ) : (
                        ""
                      )}
                    </td>
                  ))}
                  <td className="num font-semibold">{money(c.totalGenerated)}</td>
                  <td className="num muted">{c.sharePct === null ? "" : `${c.sharePct.toFixed(0)}%`}</td>
                  <td className="num">{c.totalIncentive ? `−${formatINR(c.totalIncentive)}` : c.incentivePct ? "—" : <span className="text-xs muted">set the %</span>}</td>
                  {admin && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Remove ${c.name}`}
                        onClick={() => {
                          if (window.confirm(`Remove ${c.name} and the income recorded for them?`))
                            run(() => apiFetch(`/api/departments/contributors/${c.id}`, { method: "DELETE" }), "Removed");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a person who brings income"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(async () => {
                  await apiFetch("/api/departments/contributors", { method: "POST", json: { departmentId: st.id, name, incentivePct: Number(pct) || 0 } });
                  setAdding(false);
                  setName("");
                  setPct("");
                }, "Person added")
              }
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required help="One person, or a pair who share an incentive (e.g. Dr. Harika & Deepika — the incentive is then split between them)">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Incentive (% of the income they generate)" help="Leave empty if not decided yet; their income can still be recorded">
            <input className="input" type="number" min={0} max={100} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function Patients({ departmentId, from, to }: { departmentId: string; from: string; to: string }) {
  const [show, setShow] = useState(false);
  const { data, error, loading } = useApi<any>(show ? `/api/departments/patients?departmentId=${departmentId}&from=${from}&to=${to}` : null);
  return (
    <Card
      title="Income patient by patient"
      actions={
        !show && (
          <Button size="sm" variant="secondary" onClick={() => setShow(true)}>
            Show patients
          </Button>
        )
      }
    >
      {!show && <p className="text-sm muted">Every patient who paid this department in the period, with what they paid for. Injection margin is not patient-wise.</p>}
      <ErrorState error={error} />
      {show && loading && !data && <Spinner />}
      {data && (
        <div className="overflow-x-auto">
          <p className="mb-2 text-sm muted">
            {formatNumber(data.patients.length)} patients · {formatINR(data.total)}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Patient ID</th>
                <th>Patient</th>
                <th>Paid for</th>
                <th className="num">Bills</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.patients.slice(0, 500).map((p: any) => (
                <tr key={p.key}>
                  <td className="muted">{p.code ?? "—"}</td>
                  <td>{p.name}</td>
                  <td className="text-xs muted">
                    {Object.entries(p.items)
                      .sort((a: any, b: any) => b[1] - a[1])
                      .map(([k, v]: any) => `${k} ${formatINRCompact(v)}`)
                      .join(" · ")}
                  </td>
                  <td className="num">{formatNumber(p.bills)}</td>
                  <td className="num">{formatINR(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.patients.length > 500 && <p className="mt-2 text-xs muted">Showing the 500 who paid most.</p>}
        </div>
      )}
    </Card>
  );
}

function Overview({ data, selected, onSelect }: { data: any; selected: string; onSelect: (id: string) => void }) {
  return (
    <Card title="All departments at a glance — tap one to open its statement">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Department</th>
              <th className="num">Income</th>
              <th className="num">Costs</th>
              <th className="num">Profit</th>
              <th className="num">Margin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.statements.map((st: any) => (
              <tr key={st.id} style={st.id === selected ? { background: "var(--surface-2, transparent)" } : undefined}>
                <td>
                  <button type="button" className={`text-left hover:underline ${st.id === selected ? "font-semibold" : ""}`} onClick={() => onSelect(st.id)}>
                    {st.name}
                  </button>
                </td>
                <td className="num">{money(st.totals.income)}</td>
                <td className="num">{st.totals.costs ? `−${formatINR(st.totals.costs)}` : "—"}</td>
                <td className="num font-semibold">{signed(st.totals.profit)}</td>
                <td className="num muted">{st.marginPct === null ? "" : `${st.marginPct.toFixed(0)}%`}</td>
                <td>
                  <Verdict st={st} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PartnerCard({ partner, months }: { partner: any; months: string[] }) {
  return (
    <Card title={`${partner.name} — ${partner.pct}% share of profit (${partner.departments.join(" + ")})`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th />
              {months.map((m) => (
                <th key={m} className="num whitespace-nowrap">
                  {colLabel(m)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Profit (income − costs)</td>
              {months.map((m) => (
                <td key={m} className="num">
                  {signed(partner.profit[m] ?? 0)}
                </td>
              ))}
              <td className="num font-semibold">{signed(partner.totals.profit)}</td>
            </tr>
            <tr>
              <td>
                {partner.name} share ({partner.pct}%)
              </td>
              {months.map((m) => (
                <td key={m} className="num">
                  {money(partner.share[m])}
                </td>
              ))}
              <td className="num font-semibold">{formatINR(partner.totals.share)}</td>
            </tr>
            <tr>
              <td>AED keeps</td>
              {months.map((m) => (
                <td key={m} className="num">
                  {signed(round((partner.profit[m] ?? 0) - (partner.share[m] ?? 0)))}
                </td>
              ))}
              <td className="num font-semibold">{signed(partner.totals.aed)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs muted">
        The share is worked out month by month and only on a month in profit; a loss month gives {partner.name} nothing and is not carried forward.
      </p>
    </Card>
  );
}
const round = (v: number) => Math.round(v * 100) / 100;

function GroupRows({ g, months, grand, muted }: { g: any; months: string[]; grand: number; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={muted ? { opacity: 0.85 } : undefined}>
        <td className="whitespace-nowrap">
          <button
            type="button"
            className="flex items-center gap-1 text-left font-medium hover:underline"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            disabled={!g.items.length}
          >
            {g.items.length ? open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" /> : <span className="inline-block w-4" />}
            {g.name}
          </button>
        </td>
        {months.map((m) => (
          <td key={m} className="num">
            {g.byMonth[m] ? formatINRCompact(g.byMonth[m]) : "—"}
          </td>
        ))}
        <td className="num font-semibold">{g.total ? formatINR(g.total) : "—"}</td>
        <td className="num muted">{grand && g.total ? `${((g.total / grand) * 100).toFixed(1)}%` : ""}</td>
        <td className="num muted">{g.count ? formatNumber(g.count) : ""}</td>
      </tr>
      {open &&
        g.items.map((it: any) => (
          <tr key={`${it.stream}|${it.name}`} className="text-xs">
            <td className="pl-8">
              {it.name} <span className="muted">· {STREAM_LABELS[it.stream as keyof typeof STREAM_LABELS] ?? it.stream}</span>
            </td>
            {months.map((m) => (
              <td key={m} className="num muted">
                {it.byMonth[m] ? formatINRCompact(it.byMonth[m]) : ""}
              </td>
            ))}
            <td className="num">{formatINR(it.total)}</td>
            <td />
            <td className="num muted">{formatNumber(it.count)}</td>
          </tr>
        ))}
    </>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const can = useCan();
  const all = can("analytics.view");
  const today = todayISO();
  const months = recentMonths(today, 24);
  const byDay = sp.get("view") === "day";
  const dayMonth = sp.get("month") || today.slice(0, 7);
  const from = byDay ? dayMonth : sp.get("from") || `${today.slice(0, 4)}-01`;
  const to = byDay ? dayMonth : sp.get("to") || today.slice(0, 7);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    n.set(k, v);
    router.replace(`${path}?${n.toString()}`);
  };
  const toDate = endOfMonth(`${to}-01`) < today ? endOfMonth(`${to}-01`) : today;
  const deptParam = sp.get("dept");
  const { data, error, loading, reload } = useApi<any>(from <= to ? `/api/departments?from=${from}-01&to=${toDate}${byDay ? "&granularity=day" : ""}` : null);
  const chart = data ? data.departments.filter((d: any) => d.total).map((d: any) => ({ name: d.name, total: d.total })) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-2">
          View
          <select className="input !w-auto" value={byDay ? "day" : "month"} onChange={(e) => set("view", e.target.value)}>
            <option value="month">Month by month</option>
            <option value="day">Day by day (one month)</option>
          </select>
        </label>
        {byDay && (
          <label className="flex flex-col gap-1 text-xs text-2">
            Month
            <select className="input !w-auto" value={dayMonth} onChange={(e) => set("month", e.target.value)}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!byDay && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              router.replace(`${path}?${new URLSearchParams({ ...Object.fromEntries(sp.entries()), from: `${today.slice(0, 4)}-01`, to: today.slice(0, 7) }).toString()}`)
            }
          >
            This year
          </button>
        )}
        {!byDay &&
          (["from", "to"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-2">
              {k === "from" ? "From" : "To"}
              <select className="input !w-auto" value={k === "from" ? from : to} onChange={(e) => set(k, e.target.value)}>
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {data && all && (
          <p className="text-sm muted">
            AED income {formatINRCompact(data.grandTotal)} · in departments {formatINRCompact(data.departmentsTotal)} (
            {data.grandTotal ? ((data.departmentsTotal / data.grandTotal) * 100).toFixed(0) : 0}
            %)
          </p>
        )}
      </div>
      {from > to && <p className="text-sm">Choose a “From” month before the “To” month.</p>}
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && from <= to && <Spinner />}
      {data && (
        <div className="space-y-4" style={{ opacity: loading ? 0.6 : 1 }}>
          {(() => {
            const st = data.statements.find((x: any) => x.id === deptParam) ?? data.statements.find((x: any) => /jj wellness/i.test(x.name)) ?? data.statements[0];
            if (!st) return null;
            const partner = data.partners.find((p: any) => p.departments.includes(st.name));
            return (
              <>
                <Statement st={st} months={data.months} monthOptions={months} onChanged={reload} />
                {byDay && (
                  <p className="text-xs muted">Day by day: each monthly cost is spread evenly over the days of its month. The partner&apos;s share is worked out month by month.</p>
                )}
                {partner && <PartnerCard partner={partner} months={data.months} />}
                <DepartmentInsights key={st.id} st={st} months={data.months} partner={partner} />
                <Section title={`People bringing income to ${st.name}`} subtitle="Income each person generated and their incentive">
                  <Contributors st={st} months={data.calendarMonths} onChanged={reload} />
                </Section>
                <Patients key={`${st.id}|${from}|${toDate}`} departmentId={st.id} from={`${from}-01`} to={toDate} />
                {all && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                      <h2 className="text-base font-semibold">All departments</h2>
                      {can("masters.manage") && <ImportButton departmentId={null} label="Import costs for all departments" onDone={reload} />}
                    </div>
                    <Overview data={data} selected={st.id} onSelect={(id) => set("dept", id)} />
                    <AllDepartmentsInsights data={data} />
                  </>
                )}
              </>
            );
          })()}
          {all && (
            <Section title="Table: income by department, month by month" subtitle="Tap a department to see its billed items, and the names not in any department">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      {data.months.map((m: string) => (
                        <th key={m} className="num whitespace-nowrap">
                          {colLabel(m)}
                        </th>
                      ))}
                      <th className="num">Total</th>
                      <th className="num">Share</th>
                      <th className="num">Bills / tests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departments.map((g: any) => (
                      <GroupRows key={g.id} g={g} months={data.months} grand={data.grandTotal} />
                    ))}
                    {data.unassigned.length > 0 && (
                      <tr>
                        <td colSpan={data.months.length + 4} className="pt-4 text-xs font-semibold uppercase tracking-wide text-2">
                          Not in any department — consultations, other lab tests, IPD, other income
                        </td>
                      </tr>
                    )}
                    {data.unassigned.map((g: any) => (
                      <Fragment key={g.id}>
                        <GroupRows g={g} months={data.months} grand={data.grandTotal} muted />
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td>AED income (all)</td>
                      {data.months.map((m: string) => (
                        <td key={m} className="num">
                          {formatINRCompact(data.totals[m] ?? 0)}
                        </td>
                      ))}
                      <td className="num">{formatINR(data.grandTotal)}</td>
                      <td className="num">100%</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Section>
          )}
          {all && chart.length > 0 && (
            <Section title="Graph: income by department">
              <ChartCard
                title="Department income for the period"
                height={Math.max(220, chart.length * 34)}
                table={{
                  columns: [
                    { key: "name", label: "Department", format: "text" },
                    { key: "total", label: "Income", format: "money" },
                  ],
                  rows: chart,
                }}
              >
                <BarsChart data={chart} xKey="name" horizontal series={[{ key: "total", label: "Income", color: SLOT(0) }]} />
              </ChartCard>
            </Section>
          )}
          <p className="flex gap-2 text-xs muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Department accounts are an analysis on their own: they never change the hospital&apos;s income or expenditure. A bill belongs to a department by the name it was
              billed under in OneGlance (consultation type, lab test, diet service or IPD admission type). A department&apos;s costs are only the shares entered with “Add cost”,
              plus the incentive on its injections. Hospital-wide areas (reception, administration, lobby) are not charged to departments, so profit here is before those common
              costs. Injection margin comes from the Hormonal Pharmacy&apos;s medicine-wise sales (OneGlance Purchase/Sales report), without GST.{" "}
              {can("masters.manage") && (
                <>
                  To move a billed name or a medicine into a department, edit it under{" "}
                  <Link className="underline" href="/masters?type=serviceDepartments">
                    Master Data → Income departments
                  </Link>
                  .
                </>
              )}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const can = useCan();
  const me = useSession();
  if (!can("analytics.view") && !me.headOfDepartmentId)
    return (
      <EmptyState
        icon={<ShieldAlert className="h-8 w-8" />}
        title="You do not have access to this page"
        detail="Department accounts need the analytics permission, or a login set as a department head. Ask an Admin."
      />
    );
  return (
    <>
      <PageHeader
        title="Department accounts"
        subtitle="Income, own costs and profit of each department — USG, foot & physio, cardiac, JJ Wellness, ophthalmology, diet, SCP, short and long admissions"
      />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </>
  );
}
