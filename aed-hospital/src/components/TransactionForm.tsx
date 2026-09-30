"use client";
/**
 * Generic entry / correction form for every transaction module. Field layout comes
 * from src/lib/modules.ts; rates come from master data (never hard-coded).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Paperclip, Search } from "lucide-react";
import { monthLabel, searchHeads, suggestModeCode } from "@/lib/expenses";
import { MODULES, type FieldDef, type ModuleKey } from "@/lib/modules";
import { apiFetch, ApiError, cn, useApi } from "@/lib/client";
import { compressImage } from "@/lib/compress-image";
import { formatINR, round2 } from "@/lib/money";
import { Button, Field, Modal, useToast } from "./ui";
import { masterOptions, useCan, useMasters, useSession, type MasterItem } from "./session";

type Values = Record<string, string>;

interface Props {
  module: ModuleKey;
  open: boolean;
  onClose: () => void;
  onSaved?: (result: { id?: string; status?: string }) => void;
  /** Correction mode: id of the record + its current values. */
  correct?: { id: string; values: Record<string, unknown> };
  preset?: Record<string, string>;
}

function initialValues(module: ModuleKey, today: string, masters: ReturnType<typeof useMasters>["masters"], preset?: Record<string, string>, correct?: Props["correct"]): Values {
  const v: Values = {};
  for (const f of MODULES[module].fields) {
    if (f.importOnly) continue;
    v[f.key] = "";
  }
  if (correct) {
    for (const [k, x] of Object.entries(correct.values)) v[k] = x === null || x === undefined ? "" : String(x);
    return v;
  }
  if ("date" in v) v.date = today;
  if ("admissionDate" in v) v.admissionDate = today;
  if ("discount" in v) v.discount = "0";
  if ("quantity" in v) v.quantity = "1";
  const cash = masters?.paymentModes.find((m) => m.code === "CASH" && m.active);
  if ("paymentModeId" in v && cash && module !== "pharmacy-purchase") v.paymentModeId = cash.id;
  if (module === "ipd-payment") v.type = "PAYMENT";
  const out = { ...v, ...(preset ?? {}) };
  // Checklist "Add" passes a head: fill everything from it.
  if (module === "expense" && out.headId && masters) {
    const head = masters.expenseHeads.find((h) => h.id === out.headId);
    if (head) fillFromHead(head, out, masters, !!preset?.amount);
  }
  return out;
}

/** Fill an expense from a recurring head: category, vendor, "Rent – Cash – Sep 2026", typical amount and mode. */
function fillFromHead(head: MasterItem, v: Values, masters: NonNullable<ReturnType<typeof useMasters>["masters"]>, keepAmount = false) {
  v.headId = head.id;
  v.categoryId = String(head.categoryId ?? "");
  v.subcategoryId = head.subcategoryId ? String(head.subcategoryId) : "";
  if (head.departmentId) v.departmentId = String(head.departmentId);
  if (head.vendor) v.vendor = String(head.vendor);
  v.description = `${head.name} – ${monthLabel((v.date || new Date().toISOString()).slice(0, 7))}`;
  if (!keepAmount && typeof head.typicalAmount === "number" && head.typicalAmount > 0) v.amount = String(head.typicalAmount);
  const code = (head.defaultMode as string | null) || suggestModeCode(Number(v.amount) || null);
  const mode = code ? masters.paymentModes.find((m) => m.code === code && m.active) : undefined;
  if (mode) v.paymentModeId = mode.id;
}

export function TransactionForm({ module, open, onClose, onSaved, correct, preset }: Props) {
  const def = MODULES[module];
  const { today } = useSession();
  const { masters } = useMasters();
  const toast = useToast();
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const can = useCan();
  // Once staff pick a payment mode themselves, stop suggesting one from the amount.
  const modeTouched = useRef(false);

  useEffect(() => {
    if (open) {
      modeTouched.current = false;
      setValues(initialValues(module, today, masters, preset, correct));
      setErrors({});
      setFormError(null);
      setReason("");
      setDup(null);
      setFiles([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, module, correct?.id]);

  const set = (k: string, val: string) => {
    if (k === "paymentModeId") modeTouched.current = true;
    setValues((prev) => {
      const next = { ...prev, [k]: val };
      applyDefaults(module, k, val, next, masters);
      if (module === "expense" && k === "amount" && !modeTouched.current && masters) {
        const code = suggestModeCode(Number(val) || null);
        const mode = code ? masters.paymentModes.find((m) => m.code === code && m.active) : undefined;
        if (mode) next.paymentModeId = mode.id;
      }
      return next;
    });
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const pickHead = (head: MasterItem) => {
    if (!masters) return;
    modeTouched.current = false;
    setValues((prev) => {
      const next = { ...prev };
      fillFromHead(head, next, masters);
      return next;
    });
    setErrors({});
  };
  const needsApproval = module === "expense" && !correct && !can("expense.approve");

  const net = useMemo(() => computeNet(module, values, masters), [module, values, masters]);
  const fields = def.fields.filter((f) => !f.importOnly && !(module === "ipd" && correct && f.key.startsWith("initialPayment")));

  async function submit(addAnother: boolean, confirmDuplicate = false) {
    setBusy(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = { ...values, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) };
      let res: { id?: string; status?: string; requestId?: string };
      if (correct) {
        res = await apiFetch(`/api/tx/${module}/${correct.id}/correct`, { method: "POST", json: { ...payload, reason } });
        toast(res.status === "PENDING_APPROVAL" ? "info" : "success", res.status === "PENDING_APPROVAL" ? "Day is closed — correction sent for approval" : "Correction saved (original kept in history)");
      } else {
        res = await apiFetch(`/api/tx/${module}`, { method: "POST", json: payload });
        if (files.length && res.id) {
          for (const f of files) {
            const fd = new FormData();
            fd.append("file", await compressImage(f));
            await apiFetch(`/api/expenses/${res.id}/attachments`, { method: "POST", body: fd }).catch((e) => toast("error", `Attachment ${f.name}: ${e.message}`));
          }
        }
        if ((res as { pending?: boolean }).pending) toast("info", `${def.singular} sent to Admin for approval — it counts once approved`);
        else toast("success", `${def.singular} saved${net !== null ? ` · ${formatINR(net)}` : ""}`);
      }
      onSaved?.(res);
      if (addAnother && !correct) {
        modeTouched.current = false;
        const keep = { date: values.date, admissionDate: values.admissionDate, paymentModeId: values.paymentModeId, doctorId: values.doctorId, specialtyId: values.specialtyId };
        setValues({ ...initialValues(module, today, masters, preset), ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) });
        setFiles([]);
        setDup(null);
      } else onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "CONFLICT" && (e.details as { code?: string })?.code === "POSSIBLE_DUPLICATE") setDup(e.message);
        else {
          setErrors(e.fields ?? {});
          setFormError(e.message);
        }
      } else setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide={fields.length > 8}
      title={correct ? `Correct ${def.singular}` : `New ${def.singular}`}
      footer={
        dup ? (
          <>
            <Button variant="secondary" onClick={() => setDup(null)}>
              Go back
            </Button>
            <Button variant="danger" loading={busy} onClick={() => submit(false, true)}>
              Save anyway
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {!correct && (
              <Button variant="secondary" loading={busy} onClick={() => submit(true)}>
                Save & add another
              </Button>
            )}
            <Button loading={busy} onClick={() => submit(false)} disabled={!!correct && reason.trim().length < 5}>
              {correct ? "Save correction" : "Save"}
            </Button>
          </>
        )
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        className="space-y-4"
      >
        {dup && (
          <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--status-warning)" }} role="alert">
            <p className="font-medium">Possible duplicate</p>
            <p className="muted">{dup}</p>
          </div>
        )}
        {formError && (
          <p className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--bad)", color: "var(--bad)" }} role="alert">
            {formError}
          </p>
        )}
        {module === "expense" && !correct && <HeadPicker heads={masters?.expenseHeads ?? []} selectedId={values.headId} onPick={pickHead} />}
        {needsApproval && (
          <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--surface-2)" }}>
            Expenses you enter go to an Admin for approval. They are not counted in totals until approved.
          </p>
        )}
        <div className={cn("grid gap-3", fields.length > 8 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
          {fields.map((f) => (
            <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2 lg:col-span-3" : f.type === "visitType" ? "sm:col-span-2 lg:col-span-1" : ""}>
              <FieldInput f={f} module={module} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} error={errors[f.key]} values={values} />
            </div>
          ))}
        </div>
        {net !== null && (
          <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm" style={{ background: "var(--surface-2)" }}>
            <span className="muted">{module === "ipd" ? "Net bill" : "Net amount"}</span>
            <span className="text-lg font-semibold tabular-nums">{formatINR(net, { paise: true })}</span>
          </div>
        )}
        {module === "expense" && !correct && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-2">Bill / receipt (optional)</p>
            <div className="flex flex-wrap gap-2">
              <label className="btn btn-secondary btn-sm cursor-pointer">
                <Camera className="h-4 w-4" /> Take photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])])} />
              </label>
              <label className="btn btn-secondary btn-sm cursor-pointer">
                <Paperclip className="h-4 w-4" /> Attach file
                <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])])} />
              </label>
            </div>
            {files.length > 0 && <p className="text-xs muted">{files.map((f) => f.name).join(", ")}</p>}
          </div>
        )}
        {correct && (
          <Field label="Reason for correction" required help="The original record is kept and marked as superseded. On a closed day this becomes a request for approval.">
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

/** Type one word ("rent", "milk", "esi") to pick a recurring expense head and fill the form from it. */
function HeadPicker({ heads, selectedId, onPick }: { heads: MasterItem[]; selectedId?: string; onPick: (h: MasterItem) => void }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchHeads(heads as (MasterItem & { keywords?: string | null; vendor?: string | null; categoryName?: string | null })[], q, 8), [heads, q]);
  const selected = selectedId ? heads.find((h) => h.id === selectedId) : undefined;
  if (!heads.some((h) => h.active)) return null;
  return (
    <div className="space-y-2">
      <Field label="Quick pick — type one word" htmlFor="head-quick" help={selected ? `Filled from “${selected.name}”. Check the amount and mode.` : "e.g. rent, milk, electricity, esi, salary, oxygen"}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 muted" />
          <input id="head-quick" className="input !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search expense heads…" autoComplete="off" />
        </div>
      </Field>
      {hits.length > 0 && (
        <div className="flex flex-wrap gap-2" role="listbox" aria-label="Matching expense heads">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              role="option"
              aria-selected={h.id === selectedId}
              className={cn("btn btn-sm", h.id === selectedId ? "btn-primary" : "btn-secondary")}
              onClick={() => {
                onPick(h);
                setQ("");
              }}
            >
              {h.name}
              {typeof h.typicalAmount === "number" && h.typicalAmount > 0 ? <span className="muted"> · {formatINR(h.typicalAmount)}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldInput({ f, module, value, onChange, error, values }: { f: FieldDef; module: ModuleKey; value: string; onChange: (v: string) => void; error?: string; values: Values }) {
  const { masters } = useMasters();
  const id = `f-${module}-${f.key}`;
  const common = { id, "aria-invalid": error ? true : undefined, className: "input" } as const;
  let control: React.ReactNode;
  switch (f.type) {
    case "date":
      control = <input type="date" {...common} value={value} onChange={(e) => onChange(e.target.value)} max={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} />;
      break;
    case "money":
      control = <input type="number" inputMode="decimal" step="0.01" min="0" {...common} value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" />;
      break;
    case "int":
      control = <input type="number" inputMode="numeric" step="1" min="1" {...common} value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "textarea":
      control = <textarea {...common} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "visitType":
      control = (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={f.label}>
          {(["NEW", "OLD"] as const).map((vt) => (
            <button
              key={vt}
              type="button"
              role="radio"
              aria-checked={value === vt}
              onClick={() => onChange(vt)}
              className={cn("btn", value === vt ? "btn-primary" : "btn-secondary")}
            >
              {vt === "NEW" ? "New" : "Old / Follow-up"}
            </button>
          ))}
        </div>
      );
      break;
    case "ipdTxnType":
      control = (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{module === "ipd" ? "— No payment now —" : "Select…"}</option>
          <option value="ADVANCE">Advance</option>
          <option value="PAYMENT">Part payment</option>
          <option value="FINAL_SETTLEMENT">Final settlement</option>
          {module === "ipd-payment" && <option value="REFUND">Refund</option>}
        </select>
      );
      break;
    case "admission":
      control = <AdmissionSelect value={value} onChange={onChange} id={id} />;
      break;
    case "select": {
      const options = masterOptions(masters, f.master!, { includeId: value, parentId: f.master === "expenseSubcategories" ? values.categoryId : undefined });
      control = (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.required ? "Select…" : "— None —"}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {typeof o.rate === "number" && o.rate > 0 ? ` · ₹${o.rate}` : ""}
            </option>
          ))}
        </select>
      );
      break;
    }
    default:
      control = <input type="text" {...common} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} autoComplete="off" />;
  }
  return (
    <Field label={f.label} required={f.required} error={error} help={f.help} htmlFor={id}>
      {control}
    </Field>
  );
}

function AdmissionSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const { data } = useApi<{ rows: { id: string; patientName: string; patientCode: string; admissionDate: string; balance: number; admissionType: string }[] }>("/api/tx/ipd?pageSize=200");
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select admission…</option>
      {data?.rows.map((a) => (
        <option key={a.id} value={a.id}>
          {a.admissionDate} · {a.patientName ?? a.patientCode ?? "—"} · {a.admissionType} · due {formatINR(a.balance)}
        </option>
      ))}
    </select>
  );
}

/** Auto-fill amounts from master rates when the service changes (user can override). */
function applyDefaults(module: ModuleKey, key: string, val: string, next: Values, masters: ReturnType<typeof useMasters>["masters"]) {
  if (!masters) return;
  const find = (list: { id: string }[], id: string) => list.find((x) => x.id === id) as Record<string, unknown> | undefined;
  if (module === "opd" && key === "consultationTypeId") {
    const ct = find(masters.consultationTypes, val);
    if (ct && Number(ct.defaultRate) > 0) next.grossAmount = String(ct.defaultRate);
  }
  if (module === "opd" && key === "doctorId") {
    const d = find(masters.doctors, val);
    if (d?.specialtyId) next.specialtyId = String(d.specialtyId);
  }
  if (module === "lab" && key === "investigationId") {
    const inv = find(masters.investigations, val);
    if (inv) {
      next.rate = Number(inv.rate) > 0 ? String(inv.rate) : "";
      if (inv.departmentId) next.departmentId = String(inv.departmentId);
    }
  }
  if (module === "ipd" && key === "packageId") {
    const p = find(masters.ipdPackages, val);
    if (p) {
      if (Number(p.rate) > 0) next.grossAmount = String(p.rate);
      if (p.admissionTypeId) next.admissionTypeId = String(p.admissionTypeId);
    }
  }
  if (module === "diet" && key === "serviceId") {
    const s = find(masters.dietServices, val);
    if (s && Number(s.rate) > 0) next.grossAmount = String(s.rate);
  }
  if (module === "expense" && key === "categoryId") next.subcategoryId = "";
}

function computeNet(module: ModuleKey, v: Values, masters: ReturnType<typeof useMasters>["masters"]): number | null {
  const n = (x?: string) => (x === undefined || x === "" ? 0 : Number(x) || 0);
  if (module === "lab") {
    const inv = masters?.investigations.find((i) => i.id === v.investigationId);
    const rate = v.rate !== "" && v.rate !== undefined ? n(v.rate) : Number(inv?.rate ?? 0);
    return round2(rate * Math.max(1, n(v.quantity)) - n(v.discount));
  }
  if ("grossAmount" in v) return round2(n(v.grossAmount) - n(v.discount));
  return null;
}
