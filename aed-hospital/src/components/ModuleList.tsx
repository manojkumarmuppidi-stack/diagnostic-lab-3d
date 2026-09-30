"use client";
/**
 * Generic transaction list: filters (synced to the URL so dashboards can deep-link /
 * drill down), totals, responsive table/cards, record drawer with history,
 * correction, void, IPD payments/discharge and expense attachments.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FileText, History, Paperclip, Pencil, Plus, Trash2, Camera, LogOut as DischargeIcon } from "lucide-react";
import { MODULES, writePerm, type ColumnDef, type ModuleKey } from "@/lib/modules";
import { apiFetch, download, qs, useApi } from "@/lib/client";
import { compressImage } from "@/lib/compress-image";
import { formatDate, formatDateTime, addDays, startOfMonth } from "@/lib/dates";
import { formatINR, formatNumber } from "@/lib/money";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Modal, Spinner, StatusBadge, useToast } from "./ui";
import { masterOptions, useCan, useMasters, useSession } from "./session";
import { TransactionForm } from "./TransactionForm";

type Row = Record<string, unknown> & { id: string; status: string };
interface ListResponse {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  totals: Record<string, number>;
}

const FILTERS: Partial<Record<ModuleKey, { key: string; label: string; master?: string; options?: [string, string][] }[]>> = {
  opd: [
    { key: "specialtyId", label: "Specialty", master: "specialties" },
    { key: "doctorId", label: "Doctor", master: "doctors" },
    { key: "visitType", label: "New/Old", options: [["NEW", "New"], ["OLD", "Old"]] },
    { key: "paymentModeId", label: "Mode", master: "paymentModes" },
  ],
  ipd: [
    { key: "admissionTypeId", label: "Type", master: "admissionTypes" },
    { key: "doctorId", label: "Doctor", master: "doctors" },
    { key: "open", label: "Status", options: [["1", "Not discharged"]] },
  ],
  "ipd-payment": [
    { key: "type", label: "Type", options: [["ADVANCE", "Advance"], ["PAYMENT", "Payment"], ["FINAL_SETTLEMENT", "Final settlement"], ["REFUND", "Refund"]] },
    { key: "paymentModeId", label: "Mode", master: "paymentModes" },
  ],
  lab: [
    { key: "investigationId", label: "Investigation", master: "investigations" },
    { key: "doctorId", label: "Doctor", master: "doctors" },
    { key: "departmentId", label: "Department", master: "departments" },
    { key: "paymentModeId", label: "Mode", master: "paymentModes" },
  ],
  diet: [
    { key: "serviceId", label: "Service", master: "dietServices" },
    { key: "paymentModeId", label: "Mode", master: "paymentModes" },
  ],
  expense: [
    { key: "categoryId", label: "Category", master: "expenseCategories" },
    { key: "departmentId", label: "Department", master: "departments" },
    { key: "group", label: "Group", options: [["HOSPITAL", "Hospital operating"], ["OTHER", "Other"]] },
    { key: "paymentModeId", label: "Mode", master: "paymentModes" },
  ],
  "pharmacy-sale": [{ key: "paymentModeId", label: "Mode", master: "paymentModes" }],
  "pharmacy-purchase": [{ key: "paymentModeId", label: "Mode", master: "paymentModes" }],
  "pharmacy-return": [{ key: "paymentModeId", label: "Mode", master: "paymentModes" }],
  "other-income": [{ key: "paymentModeId", label: "Mode", master: "paymentModes" }],
};

const PASSTHROUGH = ["importBatchId", "reconGroup", "admissionId", "category", "subcategoryId", "dieticianId", "packageId", "consultationTypeId"];

function cell(c: ColumnDef, v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  switch (c.type) {
    case "money":
      return formatINR(Number(v), { paise: Number(v) % 1 !== 0 });
    case "int":
      return formatNumber(Number(v));
    case "date":
      return formatDate(String(v));
    case "badge":
      return typeof v === "string" && /^[A-Z_]+$/.test(v) ? <StatusBadge status={v} /> : <Badge tone="blue">{String(v)}</Badge>;
    default:
      return String(v);
  }
}

export function ModuleList({ module, title, embedded, defaultRange = "month" }: { module: ModuleKey; title?: string; embedded?: boolean; defaultRange?: "month" | "all" | "30" }) {
  const def = MODULES[module];
  const can = useCan();
  const { today } = useSession();
  const { masters } = useMasters();
  const toast = useToast();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();

  // Filters live in the URL (so dashboard drill-downs and shared links work).
  const get = (k: string) => sp.get(k) ?? "";
  const defaults = { from: defaultRange === "all" ? "" : defaultRange === "30" ? addDays(today, -29) : startOfMonth(today), to: defaultRange === "all" ? "" : today };
  const from = sp.has("from") ? get("from") : defaults.from;
  const to = sp.has("to") ? get("to") : defaults.to;
  const page = Number(get("page")) || 1;
  const [q, setQ] = useState(get("q"));
  const filters = FILTERS[module] ?? [];

  const setParam = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(sp.toString());
      next.set("from", from);
      next.set("to", to);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in patch)) next.delete("page");
      router.replace(`${path}?${next.toString()}`, { scroll: false });
    },
    [sp, path, router, from, to],
  );

  const query = useMemo(() => {
    const p: Record<string, string> = { from, to, page: String(page), pageSize: "50", q: get("q"), status: get("status") };
    for (const f of filters) if (get(f.key)) p[f.key] = get(f.key);
    for (const k of PASSTHROUGH) if (get(k)) p[k] = get(k);
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, from, to, page]);

  const { data, error, loading, reload } = useApi<ListResponse>(`/api/tx/${module}${qs(query)}`);
  const [adding, setAdding] = useState(get("new") === "1");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const h = () => reload();
    window.addEventListener("aed:tx-saved", h);
    return () => window.removeEventListener("aed:tx-saved", h);
  }, [reload]);

  const columns = def.columns;
  const amountKey = columns.find((c) => ["netAmount", "amount"].includes(c.key))?.key ?? "amount";
  const passthroughActive = PASSTHROUGH.filter((k) => get(k));

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-2">
            From
            <input type="date" className="input !w-auto" value={from} onChange={(e) => setParam({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-2">
            To
            <input type="date" className="input !w-auto" value={to} onChange={(e) => setParam({ to: e.target.value })} />
          </label>
          <div className="flex gap-1 pb-0.5">
            <Button size="sm" variant="secondary" onClick={() => router.replace(`${path}?from=${today}&to=${today}`)}>
              Today
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.replace(`${path}?from=${startOfMonth(today)}&to=${today}`)}>
              Month
            </Button>
          </div>
          {filters.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs text-2">
              {f.label}
              <select className="input !w-auto max-w-[180px]" value={get(f.key)} onChange={(e) => setParam({ [f.key]: e.target.value })}>
                <option value="">All</option>
                {f.options?.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
                {f.master &&
                  masterOptions(masters, f.master, { includeId: get(f.key) }).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <form
            className="flex flex-1 items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ q });
            }}
          >
            <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-2">
              Search
              <input className="input" placeholder="Patient, ID, reference…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </form>
          <label className="flex items-center gap-2 pb-3 text-xs text-2">
            <input type="checkbox" checked={get("status") === "ALL"} onChange={(e) => setParam({ status: e.target.checked ? "ALL" : "" })} />
            Show voided/corrected
          </label>
        </div>
        {passthroughActive.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="muted">Drill-down filter:</span>
            {passthroughActive.map((k) => (
              <Badge key={k} tone="blue">
                {k} = {get(k).slice(0, 12)}
              </Badge>
            ))}
            <button className="underline muted" onClick={() => setParam(Object.fromEntries(passthroughActive.map((k) => [k, ""])))}>
              clear
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          {!embedded && title && <h2 className="font-semibold">{title}</h2>}
          {data && (
            <>
              <span>
                <span className="muted">Records </span>
                <span className="font-semibold tabular-nums">{formatNumber(data.total)}</span>
              </span>
              <span>
                <span className="muted">Total </span>
                <span className="font-semibold tabular-nums">{formatINR(data.totals[amountKey] ?? 0)}</span>
              </span>
              {data.totals.discount ? (
                <span>
                  <span className="muted">Discounts </span>
                  <span className="tabular-nums">{formatINR(data.totals.discount)}</span>
                </span>
              ) : null}
              {module === "ipd" && (
                <>
                  <span>
                    <span className="muted">Collected </span>
                    <span className="font-semibold tabular-nums">{formatINR(data.totals.collected ?? 0)}</span>
                  </span>
                  <span>
                    <span className="muted">Balance due </span>
                    <span className="font-semibold tabular-nums">{formatINR(data.totals.balance ?? 0)}</span>
                  </span>
                </>
              )}
              {module === "lab" && (
                <span>
                  <span className="muted">Tests </span>
                  <span className="font-semibold tabular-nums">{formatNumber(data.totals.quantity ?? 0)}</span>
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          {can("reports.export") && (
            <>
              <Button size="sm" variant="secondary" onClick={() => download(`/api/export/${module}${qs({ ...query, format: "xlsx", page: "", pageSize: "" })}`).catch((e) => toast("error", e.message))}>
                <Download className="h-4 w-4" /> Excel
              </Button>
              <Button size="sm" variant="secondary" onClick={() => download(`/api/export/${module}${qs({ ...query, format: "csv", page: "", pageSize: "" })}`).catch((e) => toast("error", e.message))}>
                CSV
              </Button>
            </>
          )}
          {can(writePerm(module)) && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add {def.singular}
            </Button>
          )}
        </div>
      </div>

      <ErrorState error={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : data && data.rows.length === 0 ? (
        <div className="card">
          <EmptyState title={`No ${def.label.toLowerCase()} in this period`} detail="Change the dates or filters, or add a new entry." icon={<FileText className="h-8 w-8" />} />
        </div>
      ) : data ? (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={c.type === "money" || c.type === "int" ? "num" : ""}>
                      {c.label}
                    </th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody style={{ opacity: loading ? 0.6 : 1 }}>
                {data.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setSelected(r.id)} style={r.status !== "ACTIVE" ? { opacity: 0.55, textDecoration: "line-through" } : undefined}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.type === "money" || c.type === "int" ? "num" : "max-w-[220px] truncate"}>
                        {c.key === "attachments" ? (Number(r[c.key]) > 0 ? <Paperclip className="inline h-4 w-4" aria-label={`${r[c.key]} attachment(s)`} /> : "") : cell(c, r[c.key])}
                      </td>
                    ))}
                    <td>
                      {r.status !== "ACTIVE" && <StatusBadge status={r.status} />}
                      {Boolean(r.importBatchId) && <Badge className="ml-1">imported</Badge>}
                      {Boolean(r.correctionOfId) && <Badge tone="violet" className="ml-1">corrected</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {data.rows.map((r) => {
              const mcols = columns.filter((c) => c.mobile);
              const money = mcols.find((c) => c.type === "money");
              return (
                <li key={r.id}>
                  <button className="card w-full p-3 text-left active:scale-[0.99]" onClick={() => setSelected(r.id)} style={r.status !== "ACTIVE" ? { opacity: 0.6 } : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {mcols
                            .filter((c) => c !== money && c.type !== "date")
                            .map((c) => (
                              <span key={c.key} className="truncate">
                                {cell(c, r[c.key])}
                              </span>
                            ))}
                        </div>
                        <p className="text-xs muted">
                          {formatDate(String(r.date ?? r.admissionDate ?? ""))}
                          {r.paymentMode ? ` · ${r.paymentMode}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{money ? cell(money, r[money.key]) : null}</p>
                        {r.status !== "ACTIVE" && <StatusBadge status={r.status} />}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {data.total > data.pageSize && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="muted">
                Page {page} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <Button size="sm" variant="secondary" disabled={page * data.pageSize >= data.total} onClick={() => setParam({ page: String(page + 1) })}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      ) : null}

      <TransactionForm module={module} open={adding} onClose={() => setAdding(false)} onSaved={() => reload()} />
      {selected && <RecordDrawer module={module} id={selected} onClose={() => setSelected(null)} onChanged={reload} />}
    </div>
  );
}

interface Detail {
  row: Row;
  input: Record<string, unknown> | null;
  chain: { id: string; status: string; createdAt: string }[];
  successor: { id: string; status: string } | null;
  history: { id: string; action: string; userName: string; createdAt: string; reason: string | null; before: unknown; after: unknown }[];
  requests: { id: string; status: string; reason: string; requestedAt: string; reviewNote: string | null }[];
}

export function RecordDrawer({ module, id, onClose, onChanged }: { module: ModuleKey; id: string; onClose: () => void; onChanged: () => void }) {
  const def = MODULES[module];
  const can = useCan();
  const toast = useToast();
  const { today } = useSession();
  const { data, error, loading, reload } = useApi<Detail>(`/api/tx/${module}/${id}`);
  const [correcting, setCorrecting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [discharging, setDischarging] = useState(false);
  const [dischargeDate, setDischargeDate] = useState(today);
  const writable = can(writePerm(module)) && data?.row.status === "ACTIVE";

  const done = () => {
    reload();
    onChanged();
  };

  return (
    <Modal open onClose={onClose} title={def.singular} wide>
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.row.status} />
            {Boolean(data.row.importBatchId) && <Badge>Imported (batch {String(data.row.importBatchId).slice(-6)})</Badge>}
            {data.successor && <Badge tone="violet">Superseded by a correction</Badge>}
            {data.chain.length > 0 && <Badge tone="violet">Correction of {data.chain.length} earlier version(s)</Badge>}
            {Boolean(data.row.voidReason) && <Badge tone="red">Void reason: {String(data.row.voidReason)}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {def.columns.map((c) => (
              <div key={c.key}>
                <dt className="text-xs muted">{c.label}</dt>
                <dd className="font-medium">{cell(c, data.row[c.key])}</dd>
              </div>
            ))}
            {Boolean(data.row.remarks) && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs muted">Remarks</dt>
                <dd>{String(data.row.remarks)}</dd>
              </div>
            )}
          </dl>

          {writable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCorrecting(true)}>
                <Pencil className="h-4 w-4" /> Correct
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setVoiding(true)}>
                <Trash2 className="h-4 w-4" /> Void
              </Button>
              {module === "ipd" && (
                <>
                  <Button size="sm" onClick={() => setPaying(true)}>
                    <Plus className="h-4 w-4" /> Payment / Refund
                  </Button>
                  {!data.row.dischargeDate && (
                    <Button size="sm" variant="secondary" onClick={() => setDischarging(true)}>
                      <DischargeIcon className="h-4 w-4" /> Discharge
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {module === "ipd" && <IpdPayments admissionId={id} key={String(paying)} />}
          {module === "expense" && <Attachments expenseId={id} canAdd={!!writable} />}

          {data.requests.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Correction requests</h3>
              <ul className="space-y-1 text-sm">
                {data.requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.status} /> {r.reason} <span className="muted">{formatDateTime(r.requestedAt)}</span>
                    {r.reviewNote && <span className="muted">· {r.reviewNote}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="mb-1 flex items-center gap-1 text-sm font-semibold">
              <History className="h-4 w-4" /> Audit history
            </h3>
            <ol className="space-y-1 border-l pl-3 text-sm" style={{ borderColor: "var(--border)" }}>
              {data.history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{h.action.replace(/_/g, " ").toLowerCase()}</span> by {h.userName} <span className="muted">· {formatDateTime(h.createdAt)}</span>
                  {h.reason && <p className="text-xs muted">Reason: {h.reason}</p>}
                </li>
              ))}
              {!data.history.length && <li className="muted">Imported / seeded — see the import batch in Audit Log.</li>}
            </ol>
          </div>
        </div>
      )}
      {data?.input && (
        <TransactionForm
          module={module}
          open={correcting}
          onClose={() => setCorrecting(false)}
          correct={{ id, values: data.input }}
          onSaved={() => {
            onChanged();
            onClose();
          }}
        />
      )}
      <ConfirmDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        title={`Void this ${def.singular.toLowerCase()}?`}
        message="The record stays in the database (marked VOIDED) and is excluded from all totals. On a closed day this becomes a request for approval."
        confirmLabel="Void"
        danger
        requireReason
        onConfirm={async (reason) => {
          const r = await apiFetch<{ status: string }>(`/api/tx/${module}/${id}/void`, { method: "POST", json: { reason } });
          toast(r.status === "PENDING_APPROVAL" ? "info" : "success", r.status === "PENDING_APPROVAL" ? "Day closed — void sent for approval" : "Record voided");
          done();
        }}
      />
      {module === "ipd" && <TransactionForm module="ipd-payment" open={paying} onClose={() => setPaying(false)} preset={{ admissionId: id }} onSaved={done} />}
      <Modal
        open={discharging}
        onClose={() => setDischarging(false)}
        title="Record discharge"
        footer={
          <Button
            onClick={async () => {
              try {
                await apiFetch(`/api/ipd/${id}/discharge`, { method: "POST", json: { dischargeDate } });
                toast("success", "Discharge recorded");
                setDischarging(false);
                done();
              } catch (e) {
                toast("error", (e as Error).message);
              }
            }}
          >
            Save
          </Button>
        }
      >
        <Field label="Discharge date" required>
          <input type="date" className="input" value={dischargeDate} onChange={(e) => setDischargeDate(e.target.value)} />
        </Field>
      </Modal>
    </Modal>
  );
}

function IpdPayments({ admissionId }: { admissionId: string }) {
  const { data } = useApi<ListResponse>(`/api/tx/ipd-payment?admissionId=${admissionId}&pageSize=100&status=ALL`);
  if (!data) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">Payments</h3>
      {data.rows.length === 0 ? (
        <p className="text-sm muted">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Mode</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id} style={p.status !== "ACTIVE" ? { opacity: 0.5 } : undefined}>
                  <td>{formatDate(String(p.date))}</td>
                  <td>
                    <StatusBadge status={String(p.type)} />
                  </td>
                  <td className="num">{formatINR(Number(p.amount))}</td>
                  <td>{String(p.paymentMode ?? "—")}</td>
                  <td>{p.status !== "ACTIVE" && <StatusBadge status={p.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Attachments({ expenseId, canAdd }: { expenseId: string; canAdd: boolean }) {
  const toast = useToast();
  const { data, reload } = useApi<{ id: string; fileName: string; mimeType: string; size: number }[]>(`/api/expenses/${expenseId}/attachments`);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", await compressImage(f));
        await apiFetch(`/api/expenses/${expenseId}/attachments`, { method: "POST", body: fd });
      }
      toast("success", "Bill attached");
      reload();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">Bills & receipts</h3>
      <ul className="mb-2 space-y-1 text-sm">
        {data?.map((a) => (
          <li key={a.id}>
            <a className="underline" href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">
              <Paperclip className="mr-1 inline h-3.5 w-3.5" />
              {a.fileName}
            </a>{" "}
            <span className="muted">({Math.round(a.size / 1024)} KB)</span>
          </li>
        ))}
        {data && !data.length && <li className="muted">No attachments.</li>}
      </ul>
      {canAdd && (
        <div className="flex flex-wrap gap-2">
          <label className="btn btn-secondary btn-sm cursor-pointer">
            <Camera className="h-4 w-4" /> {busy ? "Uploading…" : "Take photo"}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => upload(e.target.files)} />
          </label>
          <label className="btn btn-secondary btn-sm cursor-pointer">
            <Paperclip className="h-4 w-4" /> Attach file
            <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
          </label>
        </div>
      )}
    </div>
  );
}
