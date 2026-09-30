"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { apiFetch, useApi } from "@/lib/client";
import { formatINR } from "@/lib/money";
import { Badge, Button, ErrorState, Field, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { masterOptions, useMasters } from "@/components/session";

type FType = "text" | "money" | "int" | "bool" | "select";
interface F {
  key: string;
  label: string;
  type: FType;
  options?: [string, string][];
  master?: string;
  required?: boolean;
}

const DEFS: Record<string, { label: string; fields: F[]; show: string[] }> = {
  specialties: { label: "Specialties", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "sortOrder", label: "Sort order", type: "int" }], show: ["name"] },
  doctors: {
    label: "Doctors & Dieticians",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "kind", label: "Type", type: "select", options: [["DOCTOR", "Doctor"], ["DIETICIAN", "Dietician"], ["OTHER", "Other"]] },
      { key: "specialtyId", label: "Specialty", type: "select", master: "specialties" },
      { key: "departmentId", label: "Department", type: "select", master: "departments" },
    ],
    show: ["name", "kind", "specialtyName", "departmentName"],
  },
  departments: { label: "Departments", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "code", label: "Code", type: "text" }], show: ["name", "code"] },
  consultationTypes: { label: "Consultation Types", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "defaultRate", label: "Default rate (₹)", type: "money" }], show: ["name", "defaultRate"] },
  admissionTypes: { label: "IPD Admission Types", fields: [{ key: "name", label: "Name", type: "text", required: true }], show: ["name"] },
  ipdPackages: {
    label: "IPD Packages",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "admissionTypeId", label: "Admission type", type: "select", master: "admissionTypes" },
      { key: "rate", label: "Rate (₹)", type: "money" },
    ],
    show: ["name", "admissionTypeName", "rate"],
  },
  investigations: {
    label: "Lab Investigations",
    fields: [
      { key: "name", label: "Investigation", type: "text", required: true },
      { key: "code", label: "Code", type: "text" },
      { key: "category", label: "Category", type: "text", required: true },
      { key: "rate", label: "Rate (₹)", type: "money" },
      { key: "departmentId", label: "Department", type: "select", master: "departments" },
    ],
    show: ["name", "category", "rate", "departmentName"],
  },
  dietServices: { label: "Diet Services", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "rate", label: "Rate (₹)", type: "money" }], show: ["name", "rate"] },
  expenseCategories: {
    label: "Expense Categories",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "parentId", label: "Parent category (leave empty for a top-level category)", type: "select", master: "expenseCategories" },
      { key: "group", label: "Accounting group", type: "select", options: [["HOSPITAL", "Hospital operating expense"], ["OTHER", "Other expense"]] },
    ],
    show: ["name", "parentName", "group"],
  },
  expenseHeads: {
    label: "Monthly Expense Heads",
    fields: [
      { key: "name", label: "Head (what staff see, e.g. Rent – Online)", type: "text", required: true },
      { key: "keywords", label: "Keywords to find it (comma-separated, e.g. rent,building)", type: "text" },
      { key: "categoryId", label: "Category", type: "select", master: "expenseCategories", required: true },
      { key: "subcategoryId", label: "Subcategory", type: "select", master: "expenseSubcategories" },
      { key: "departmentId", label: "Department", type: "select", master: "departments" },
      { key: "vendor", label: "Paid to / vendor", type: "text" },
      { key: "defaultMode", label: "Payment mode", type: "select", options: [["", "Suggest from amount (<₹3,000 cash · >₹1 lakh online · else card)"], ["CASH", "Cash"], ["CARD", "Card"], ["UPI", "UPI"], ["BANK", "Bank transfer / online"], ["CHEQUE", "Cheque"]] },
      { key: "typicalAmount", label: "Usual amount (₹, optional — last month's amount is used if empty)", type: "money" },
      { key: "monthly", label: "Expected every month (shows on the monthly checklist)", type: "bool" },
      { key: "sortOrder", label: "Sort order", type: "int" },
    ],
    show: ["name", "categoryName", "vendor", "defaultMode", "typicalAmount"],
  },
  paymentModes: {
    label: "Payment Modes",
    fields: [
      { key: "code", label: "Code", type: "text", required: true },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "reconGroup", label: "Reconciliation bucket", type: "select", options: [["CASH", "Cash"], ["CARD", "Card"], ["UPI", "UPI"], ["BANK", "Bank"], ["OTHER", "Other"]], required: true },
      { key: "sortOrder", label: "Sort order", type: "int" },
    ],
    show: ["code", "name", "reconGroup"],
  },
};

export default function MastersPage() {
  const [type, setType] = useState("investigations");
  const def = DEFS[type];
  const { data, error, loading, reload } = useApi<any[]>(`/api/masters/${type}`);
  const { masters, reload: reloadMasters } = useMasters();
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");

  const open = (row: any | null) => {
    setEdit(row ?? {});
    setValues(row ? { ...row } : { kind: "DOCTOR", group: "HOSPITAL", reconGroup: "OTHER", category: "General", monthly: true });
    setErrs({});
  };
  const save = async () => {
    const payload: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = values[f.key];
      payload[f.key] =
        f.type === "money" || f.type === "int" ? (v === "" || v === undefined || v === null ? (f.key === "typicalAmount" ? null : undefined) : Number(v)) : f.type === "bool" ? v !== false : v ?? (f.type === "select" ? null : undefined);
    }
    try {
      if (edit?.id) await apiFetch(`/api/masters/${type}/${edit.id}`, { method: "PATCH", json: payload });
      else await apiFetch(`/api/masters/${type}`, { method: "POST", json: payload });
      toast("success", "Saved");
      setEdit(null);
      reload();
      reloadMasters();
    } catch (e: any) {
      setErrs(e.fields ?? {});
      toast("error", e.message);
    }
  };
  const toggle = async (row: any) => {
    await apiFetch(`/api/masters/${type}/${row.id}`, { method: "PATCH", json: { active: !row.active } });
    reload();
    reloadMasters();
  };
  const rows = (data ?? []).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  return (
    <Guard perm="masters.manage">
      <PageHeader title="Master Data" subtitle="Rates and lists used by every entry form. Items are deactivated, never deleted, so history keeps its labels." actions={<Button onClick={() => open(null)}><Plus className="h-4 w-4" /> Add</Button>} />
      <div className="space-y-3">
        <Tabs value={type} onChange={setType} tabs={Object.entries(DEFS).map(([k, d]) => ({ key: k, label: d.label }))} />
        <input className="input max-w-sm" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />
        <ErrorState error={error} onRetry={reload} />
        {loading && !data ? (
          <Spinner />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {def.show.map((k) => (
                    <th key={k} className={["rate", "defaultRate", "typicalAmount"].includes(k) ? "num" : ""}>
                      {def.fields.find((f) => f.key === k)?.label ?? k.replace(/Name$/, "")}
                    </th>
                  ))}
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={!r.active ? { opacity: 0.55 } : undefined}>
                    {def.show.map((k) => (
                      <td key={k} className={["rate", "defaultRate", "typicalAmount"].includes(k) ? "num" : ""}>
                        {["rate", "defaultRate"].includes(k) ? (
                          Number(r[k]) > 0 ? formatINR(r[k]) : <Badge tone="amber">rate not set</Badge>
                        ) : k === "typicalAmount" ? (
                          r[k] ? formatINR(r[k]) : "—"
                        ) : k === "defaultMode" ? (
                          r[k] || "by amount"
                        ) : (
                          String(r[k] ?? "—")
                        )}
                      </td>
                    ))}
                    <td>{r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(r)}>
                        {r.active ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`${edit?.id ? "Edit" : "Add"} — ${def.label}`} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="space-y-3">
          {def.fields.map((f) => (
            <Field key={f.key} label={f.label} required={f.required} error={errs[f.key]}>
              {f.type === "bool" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={values[f.key] !== false} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))} /> Yes
                </label>
              ) : f.type === "select" ? (
                <select className="input" value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value, ...(f.key === "categoryId" ? { subcategoryId: "" } : {}) }))}>
                  {!f.options?.some(([k]) => k === "") && <option value="">— None —</option>}
                  {f.options?.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                  {f.master &&
                    masterOptions(masters, f.master, { includeId: values[f.key], parentId: f.master === "expenseSubcategories" ? values.categoryId : undefined })
                      .filter((o) => o.id !== edit?.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                </select>
              ) : (
                <input className="input" type={f.type === "money" || f.type === "int" ? "number" : "text"} step={f.type === "money" ? "0.01" : "1"} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              )}
            </Field>
          ))}
          {(type === "investigations" || type === "consultationTypes" || type === "ipdPackages" || type === "dietServices") && <p className="text-xs muted">Rate changes apply to new entries only; past transactions keep the amount actually charged.</p>}
        </div>
      </Modal>
    </Guard>
  );
}
