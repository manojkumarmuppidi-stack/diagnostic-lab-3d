"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Download, FileSpreadsheet, RotateCcw, Upload, XCircle } from "lucide-react";
import { apiFetch, ApiError, download, qs, useApi } from "@/lib/client";
import { IMPORT_TYPES, importFieldsFor, type FieldDef, type ImportType } from "@/lib/modules";
import { formatDateTime } from "@/lib/dates";
import { formatINR, formatNumber } from "@/lib/money";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, Tabs, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan } from "@/components/session";

type Tab = "import" | "history";
type Mapping = Record<string, string | null>;

interface UploadedBatch {
  id: string;
  sheetName: string;
  headerRow: number;
  headers: string[];
  rows: number;
  type: ImportType;
  sample: Record<string, unknown>[];
  suggestion: { mapping: Mapping; confidence: Record<string, number>; unmappedHeaders: string[]; missingRequired: string[] };
  previouslyImported: { batchId: string; at: string }[];
  /** Set when the sheet was converted from a recognised OneGlance HMS report. */
  note?: string | null;
}

/** Admin historical backfill (rows may land on closed days), toggled on the page and kept in the URL. */
function useBackfill() {
  return useSearchParams().get("backfill") === "1";
}

// ─────────────────────────── step 1: upload ───────────────────────────

function UploadStep({ onUploaded }: { onUploaded: (b: UploadedBatch[], fileName: string) => void }) {
  const [type, setType] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const toast = useToast();
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      // Compress large files in the browser: HMS exports compress ~10×, which keeps them under the server's request limit.
      if (file.size > 1_000_000 && typeof CompressionStream !== "undefined") {
        const gz = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
        fd.append("file", new File([gz], file.name));
        fd.append("encoding", "gzip");
      } else fd.append("file", file);
      fd.append("type", type);
      const r = await apiFetch<{ batches: UploadedBatch[]; fileName: string }>("/api/import/upload", { method: "POST", body: fd });
      onUploaded(r.batches, r.fileName);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="1 · Upload historical data" className="lg:col-span-2">
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs text-2">
            What does the file contain?
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Detect from sheet names (multi-sheet workbooks)</option>
              {IMPORT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              upload(e.dataTransfer.files[0]);
            }}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center"
            style={{ borderColor: drag ? "var(--brand)" : "var(--border)", background: drag ? "var(--surface-2)" : undefined }}
          >
            {busy ? <Spinner label="Reading file…" /> : <Upload className="h-8 w-8" style={{ color: "var(--brand)" }} />}
            <span className="font-medium">Tap to choose a file, or drop it here</span>
            <span className="text-xs muted">.xlsx, .xls or .csv · OneGlance HMS exports are recognised automatically · up to 40 MB · every sheet is read</span>
            <input type="file" className="sr-only" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} />
          </label>
          {err && <ErrorState error={{ message: err }} />}
        </div>
      </Card>
      <Card title="Templates">
        <p className="mb-2 text-xs muted">Optional — existing files do not need to match; columns are mapped in the next step.</p>
        <div className="flex flex-col gap-1">
          {IMPORT_TYPES.map((t) => (
            <button key={t.key} className="btn btn-ghost btn-sm justify-start" onClick={() => download(`/api/templates/${t.key}`).catch((e) => toast("error", e.message))}>
              <FileSpreadsheet className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────── step 2: mapping ───────────────────────────

function MappingStep({ batch, onValidated }: { batch: UploadedBatch; onValidated: () => void }) {
  const backfill = useBackfill();
  const [type, setType] = useState<ImportType>(batch.type);
  const fields = useMemo(() => importFieldsFor(type), [type]);
  const [mapping, setMapping] = useState<Mapping>(batch.suggestion.mapping);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggested, setSuggested] = useState(batch.suggestion);

  // Re-suggest when the user changes the import type.
  useEffect(() => {
    if (type === batch.type) {
      setMapping(batch.suggestion.mapping);
      setSuggested(batch.suggestion);
      return;
    }
    import("@/lib/import/mapping").then(({ suggestMapping }) => {
      const s = suggestMapping(batch.headers, importFieldsFor(type));
      setMapping(s.mapping);
      setSuggested(s);
    });
  }, [type, batch]);

  const used = new Set(Object.values(mapping).filter((v) => v && !v.startsWith("=")));
  const validate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/import/${batch.id}/validate`, { method: "POST", json: { type, mapping, intoClosedDays: backfill } });
      onValidated();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {batch.note && (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--status-good)" }} role="status">
          <b>Recognised hospital billing report — converted automatically.</b> {batch.note}
        </div>
      )}
      {batch.previouslyImported.length > 0 && (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--status-warning)" }} role="alert">
          <b>This exact file/sheet was already imported</b> on {batch.previouslyImported.map((p) => formatDateTime(p.at)).join(", ")}. Importing again will be caught by duplicate detection, but check Import History first.
        </div>
      )}
      <Card
        title={`2 · Map columns — sheet “${batch.sheetName}” (${formatNumber(batch.rows)} rows, header on row ${batch.headerRow})`}
        actions={
          <label className="flex items-center gap-2 text-xs text-2">
            Import as
            <select className="input !w-auto !py-1" value={type} onChange={(e) => setType(e.target.value as ImportType)}>
              {IMPORT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f: FieldDef) => {
            const v = mapping[f.key] ?? "";
            const isConst = v.startsWith("=");
            const conf = suggested.confidence[f.key];
            return (
              <div key={f.key} className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">
                    {f.label}
                    {f.required && <span style={{ color: "var(--bad)" }}> *</span>}
                  </span>
                  {v && !isConst && conf !== undefined && mapping[f.key] === suggested.mapping[f.key] && (
                    <Badge tone={conf >= 0.9 ? "green" : "amber"}>{conf >= 0.9 ? "auto" : `guess ${Math.round(conf * 100)}%`}</Badge>
                  )}
                </div>
                <select
                  className="input !py-1.5 text-sm"
                  value={isConst ? "__const" : v}
                  aria-label={`Column for ${f.label}`}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === "__const" ? "=" : e.target.value || null }))}
                >
                  <option value="">— not in file —</option>
                  {batch.headers.map((h) => (
                    <option key={h} value={h} disabled={used.has(h) && v !== h}>
                      {h}
                    </option>
                  ))}
                  <option value="__const">Same value for every row…</option>
                </select>
                {isConst && (
                  <input className="input mt-1 !py-1.5 text-sm" placeholder={f.type === "visitType" ? "New or Old" : f.type === "date" ? "DD-MM-YYYY" : "Value"} value={v.slice(1)} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: `=${e.target.value}` }))} />
                )}
              </div>
            );
          })}
        </div>
        {suggested.unmappedHeaders.length > 0 && <p className="mt-3 text-xs muted">Ignored columns: {suggested.unmappedHeaders.join(", ")}</p>}
      </Card>
      <Card title="Preview (first rows as uploaded)" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {batch.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batch.sample.map((r, i) => (
                <tr key={i}>
                  {batch.headers.map((h) => (
                    <td key={h}>{String(r[h] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {err && <ErrorState error={{ message: err }} />}
      <div className="flex justify-end">
        <Button onClick={validate} loading={busy}>
          Validate {formatNumber(batch.rows)} rows
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────── step 3: review & commit ───────────────────────────

function ReviewStep({ batchId, onDone, onRemap }: { batchId: string; onDone: (r: any) => void; onRemap: () => void }) {
  const backfill = useBackfill();
  const can = useCan();
  const toast = useToast();
  const { data, reload } = useApi<any>(`/api/import/${batchId}`);
  const [status, setStatus] = useState("INVALID,WARNING,DUPLICATE");
  const [page, setPage] = useState(1);
  const rows = useApi<any>(`/api/import/${batchId}/rows${qs({ status, page })}`);
  const [approveWarnings, setApproveWarnings] = useState(false);
  const [dupPolicy, setDupPolicy] = useState<"skip" | "import">("skip");
  const [confirm, setConfirm] = useState(false);

  if (!data) return <Spinner />;
  const s = data.summary;
  const importable = s.valid + (approveWarnings ? s.warnings : 0) + (dupPolicy === "import" ? s.duplicates : 0);

  const toggleDup = async (id: string, force: boolean) => {
    try {
      await apiFetch(`/api/import/${batchId}/rows`, { method: "PATCH", json: { rowIds: [id], forceImport: force } });
      rows.reload();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const commit = async () => {
    const r = await apiFetch<any>(`/api/import/${batchId}/commit`, { method: "POST", json: { approveWarnings, duplicatePolicy: dupPolicy, intoClosedDays: backfill } });
    toast("success", `Imported ${r.imported} rows (${formatINR(r.amount)})`);
    onDone(r);
  };

  const stat = (label: string, v: number, tone?: "red" | "amber" | "green" | "violet") => (
    <div className="card p-3">
      <p className="text-xs muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums" style={tone && v ? { color: tone === "red" ? "var(--bad)" : tone === "green" ? "var(--good)" : undefined } : undefined}>
        {formatNumber(v)}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card title={`3 · Validation — ${data.batch.fileName}${data.batch.sheetName ? ` / ${data.batch.sheetName}` : ""}`} actions={<Button size="sm" variant="ghost" onClick={onRemap}>Change mapping</Button>}>
        <p className="mb-3 text-sm">
          <b>{formatNumber(s.total)}</b> records found · <b style={{ color: "var(--good)" }}>{formatNumber(s.valid)}</b> valid · <b>{formatNumber(s.warnings)}</b> need approval · <b>{formatNumber(s.duplicates)}</b> duplicate candidates · <b style={{ color: "var(--bad)" }}>{formatNumber(s.invalid)}</b> errors
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {stat("Missing dates", s.missingDates, "red")}
          {stat("Missing amounts", s.missingAmounts, "red")}
          {stat("Unknown services", s.unknownServices, "amber")}
          {stat("Unknown categories", s.unknownCategories, "amber")}
          {stat("Invalid payment modes", s.invalidPaymentModes, "amber")}
          {stat("Totals rows skipped", s.totalsRows, "amber")}
        </div>
        <p className="mt-3 text-sm">
          Value of valid + approvable rows: <b>{formatINR(s.validAmount)}</b>
          {Object.keys(s.byModule).length > 1 && <span className="muted"> · {Object.entries(s.byModule).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>}
        </p>
      </Card>

      <Card
        title="Rows needing attention"
        actions={
          <>
            <select className="input !w-auto !py-1 text-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Row filter">
              <option value="INVALID,WARNING,DUPLICATE">Errors, warnings & duplicates</option>
              <option value="INVALID">Errors</option>
              <option value="WARNING">Warnings</option>
              <option value="DUPLICATE">Duplicates</option>
              <option value="VALID">Valid</option>
              <option value="">All rows</option>
            </select>
            <Button size="sm" variant="secondary" onClick={() => download(`/api/import/${batchId}/errors`).catch((e) => toast("error", e.message))}>
              <Download className="h-4 w-4" /> Error file
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        {!rows.data ? (
          <Spinner />
        ) : rows.data.rows.length === 0 ? (
          <EmptyState title="Nothing here" detail="No rows with this status." icon={<CheckCircle2 className="h-8 w-8" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Problems</th>
                  <th>Data</th>
                  {can("import.override_duplicates") && <th>Duplicate decision</th>}
                </tr>
              </thead>
              <tbody>
                {rows.data.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="tabular-nums">{r.rowNumber}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="max-w-[420px] whitespace-normal text-xs">
                      {(r.errors ?? []).map((e: string) => (
                        <p key={e} style={{ color: "var(--bad)" }}>
                          <XCircle className="mr-1 inline h-3 w-3" />
                          {e}
                        </p>
                      ))}
                      {(r.warnings ?? []).map((w: string) => (
                        <p key={w}>⚠ {w}</p>
                      ))}
                      {r.duplicateOf && <p className="muted">Matches {r.duplicateOf.startsWith("row:") ? `row ${r.duplicateOf.slice(4)} in this file` : "an existing record"}</p>}
                    </td>
                    <td className="max-w-[360px] truncate text-xs muted" title={JSON.stringify(r.raw)}>
                      {Object.values(r.raw).filter((x) => x !== null).slice(0, 6).join(" · ")}
                    </td>
                    {can("import.override_duplicates") && (
                      <td>
                        {r.status === "DUPLICATE" && (
                          <select className="input !w-auto !py-1 text-xs" value={r.forceImport ? "import" : "skip"} onChange={(e) => toggleDup(r.id, e.target.value === "import")} aria-label="Duplicate decision">
                            <option value="skip">Skip</option>
                            <option value="import">Import anyway</option>
                          </select>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.data && rows.data.total > rows.data.pageSize && (
          <div className="flex items-center justify-center gap-2 p-2 text-sm">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <span className="muted">
              {page} / {Math.ceil(rows.data.total / rows.data.pageSize)}
            </span>
            <Button size="sm" variant="secondary" disabled={page * rows.data.pageSize >= rows.data.total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>

      <Card title="4 · Confirm import">
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={approveWarnings} onChange={(e) => setApproveWarnings(e.target.checked)} />
            <span>
              I have reviewed the <b>{formatNumber(s.warnings)}</b> rows with warnings and approve importing them (this may add new doctors, tests or categories to master data).
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" disabled={!can("import.override_duplicates")} checked={dupPolicy === "import"} onChange={(e) => setDupPolicy(e.target.checked ? "import" : "skip")} />
            <span>
              Import all <b>{formatNumber(s.duplicates)}</b> duplicate candidates anyway {can("import.override_duplicates") ? "" : "(Admin only)"}. Otherwise duplicates are skipped unless marked “Import anyway” above.
            </span>
          </label>
          <p className="muted">Rows with errors are never imported — download the error file, fix and re-upload them.</p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={() => setConfirm(true)} disabled={importable === 0 && !s.duplicates}>
              Import {formatNumber(importable)} rows
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await apiFetch(`/api/import/${batchId}`, { method: "DELETE" });
                toast("info", "Batch cancelled — nothing was imported");
                onDone(null);
              }}
            >
              Cancel batch
            </Button>
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={confirm}
        onClose={() => {
          setConfirm(false);
          reload();
        }}
        title="Import these records?"
        message={
          <p>
            About <b>{formatNumber(importable)}</b> records will be added using their <b>transaction dates</b>. They immediately appear in dashboards, analytics and reports. The whole batch can be reversed later by an Admin.
          </p>
        }
        confirmLabel="Import now"
        onConfirm={commit}
      />
    </div>
  );
}

// ─────────────────────────── recognised HMS reports: check & import all months ───────────────────────────

type BulkRow = { id: string; name: string; rows: number; state: "pending" | "checking" | "checked" | "importing" | "imported" | "failed"; summary?: any; result?: any; error?: string };

function HmsBulkImport({ batches, onFinished, onReviewOne }: { batches: UploadedBatch[]; onFinished: (r: any) => void; onReviewOne: (id: string) => void }) {
  const toast = useToast();
  const backfill = useBackfill();
  const [items, setItems] = useState<BulkRow[]>(() => batches.map((b) => ({ id: b.id, name: b.sheetName, rows: b.rows, state: "pending" })));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (id: string, patch: Partial<BulkRow>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const checked = items.every((x) => x.state === "checked" || x.state === "imported");
  const totals = items.reduce(
    (a, x) => ({ valid: a.valid + (x.summary?.valid ?? 0), warnings: a.warnings + (x.summary?.warnings ?? 0), invalid: a.invalid + (x.summary?.invalid ?? 0), duplicates: a.duplicates + (x.summary?.duplicates ?? 0) }),
    { valid: 0, warnings: 0, invalid: 0, duplicates: 0 },
  );

  const checkAll = async () => {
    setBusy(true);
    for (const b of batches) {
      const item = items.find((x) => x.id === b.id);
      if (item?.state === "checked" || item?.state === "imported") continue;
      set(b.id, { state: "checking", error: undefined });
      try {
        const v = await apiFetch<any>(`/api/import/${b.id}/validate`, { method: "POST", json: { type: b.type, mapping: b.suggestion.mapping, intoClosedDays: backfill } });
        set(b.id, { state: "checked", summary: v.summary });
      } catch (e) {
        set(b.id, { state: "failed", error: (e as Error).message });
      }
    }
    setBusy(false);
  };

  const importAll = async () => {
    setBusy(true);
    const sum = { imported: 0, rejected: 0, amount: 0, newMasters: 0 };
    for (const x of items) {
      if (x.state !== "checked") continue;
      set(x.id, { state: "importing" });
      try {
        const r = await apiFetch<any>(`/api/import/${x.id}/commit`, { method: "POST", json: { approveWarnings: true, duplicatePolicy: "skip", intoClosedDays: backfill } });
        set(x.id, { state: "imported", result: r });
        sum.imported += r.imported;
        sum.rejected += r.rejected;
        sum.amount += Number(r.amount) || 0;
        sum.newMasters += r.newMasters || 0;
      } catch (e) {
        set(x.id, { state: "failed", error: (e as Error).message });
      }
    }
    setBusy(false);
    toast("success", `Imported ${formatNumber(sum.imported)} records (${formatINR(sum.amount)})`);
    onFinished(sum);
  };

  const label: Record<BulkRow["state"], string> = { pending: "Not checked", checking: "Checking…", checked: "Checked", importing: "Importing…", imported: "Imported", failed: "Failed" };
  return (
    <Card title={`${batches[0]?.note ? "Hospital billing report recognised" : "All columns recognised"} — ${items.length} batch${items.length > 1 ? "es" : ""}, ${formatNumber(items.reduce((a, x) => a + x.rows, 0))} rows`}>
      <div className="space-y-3 text-sm">
        <p className="muted">{batches[0]?.note ?? "Every sheet's columns were matched automatically. Check all sheets, then import them together — or open one with “Review rows”."}</p>
        {backfill && <p style={{ color: "var(--status-warning)" }}>Historical backfill is on: rows on closed days will be added and those days&apos; closing totals refreshed.</p>}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Batch</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Valid</th>
                <th className="text-right">Warnings</th>
                <th className="text-right">Errors</th>
                <th className="text-right">Duplicates</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="text-right tabular-nums">{formatNumber(x.rows)}</td>
                  <td className="text-right tabular-nums">{x.summary ? formatNumber(x.summary.valid) : "—"}</td>
                  <td className="text-right tabular-nums">{x.summary ? formatNumber(x.summary.warnings) : "—"}</td>
                  <td className="text-right tabular-nums">{x.summary ? formatNumber(x.summary.invalid) : "—"}</td>
                  <td className="text-right tabular-nums">{x.summary ? formatNumber(x.summary.duplicates) : "—"}</td>
                  <td>
                    {x.state === "imported" ? `Imported ${formatNumber(x.result.imported)}` : label[x.state]}
                    {x.error && <div className="text-xs" style={{ color: "var(--status-critical)" }}>{x.error}</div>}
                  </td>
                  <td>
                    {(x.state === "checked" || x.state === "failed") && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReviewOne(x.id)}>
                        Review rows
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {checked && (
          <p>
            <b>{formatNumber(totals.valid + totals.warnings)}</b> rows ready. Warnings are mostly new doctors, tests and consultation types that will be added to Master Data — review them there afterwards.
            {totals.invalid > 0 && <> <b>{formatNumber(totals.invalid)}</b> rows have errors and will not be imported (use “Review rows”).</>}
            {totals.duplicates > 0 && <> <b>{formatNumber(totals.duplicates)}</b> rows are already in the system and will be skipped.</>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!checked ? (
            <Button onClick={checkAll} disabled={busy}>
              {busy ? "Checking…" : "Check all months"}
            </Button>
          ) : (
            <Button onClick={() => setConfirm(true)} disabled={busy || items.every((x) => x.state === "imported")}>
              {busy ? "Importing…" : "Import all months"}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Import all months?"
        message={
          <p>
            About <b>{formatNumber(totals.valid + totals.warnings)}</b> records will be added on their bill dates, warnings approved and duplicates skipped. Each month is a separate batch an Admin can reverse from Import history.
          </p>
        }
        confirmLabel="Import all"
        onConfirm={importAll}
      />
    </Card>
  );
}

// ─────────────────────────── history ───────────────────────────

function History({ onContinue }: { onContinue: (id: string) => void }) {
  const can = useCan();
  const toast = useToast();
  const { data, error, reload } = useApi<any>("/api/import/history");
  const [reverse, setReverse] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  if (!data.rows.length) return <div className="card"><EmptyState title="No imports yet" /></div>;
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th>Imported by</th>
            <th>Date / time</th>
            <th className="num">Found</th>
            <th className="num">Imported</th>
            <th className="num">Rejected</th>
            <th className="num">Duplicates</th>
            <th className="num">Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((b: any) => (
            <tr key={b.id}>
              <td className="max-w-[220px] truncate" title={b.fileName}>
                {b.fileName}
                {b.sheetName && <span className="text-xs muted"> / {b.sheetName}</span>}
              </td>
              <td>{b.typeLabel}</td>
              <td>{b.uploadedBy}</td>
              <td>{formatDateTime(b.committedAt ?? b.createdAt)}</td>
              <td className="num">{formatNumber(b.recordsFound)}</td>
              <td className="num">{formatNumber(b.imported)}</td>
              <td className="num">{formatNumber(b.rejected)}</td>
              <td className="num">{formatNumber(b.duplicateRows)}</td>
              <td className="num">{formatINR(b.totalAmount)}</td>
              <td>
                <StatusBadge status={b.status} />
                {b.reversedBy && <p className="text-xs muted">by {b.reversedBy}: {b.reverseReason}</p>}
              </td>
              <td>
                {["UPLOADED", "VALIDATED"].includes(b.status) && (
                  <Button size="sm" variant="secondary" onClick={() => onContinue(b.id)}>
                    Continue
                  </Button>
                )}
                {b.status === "IMPORTED" && can("import.reverse") && (
                  <Button size="sm" variant="ghost" onClick={() => setReverse(b.id)}>
                    <RotateCcw className="h-4 w-4" /> Reverse
                  </Button>
                )}
                {b.status === "IMPORTED" && (
                  <a className="ml-1 text-xs underline" href={`/audit?entityId=${b.id}`}>
                    audit
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={!!reverse}
        onClose={() => setReverse(null)}
        title="Reverse this entire import?"
        message="Every record created by this batch is marked REVERSED (kept for audit, excluded from all figures). Closed days must be reopened first."
        confirmLabel="Reverse batch"
        danger
        requireReason
        onConfirm={async (reason) => {
          const r = await apiFetch<any>(`/api/import/${reverse}/reverse`, { method: "POST", json: { reason } });
          toast("success", `Reversed ${r.reversed} records${r.correctedRowsNotReversed ? ` — ${r.correctedRowsNotReversed} corrected rows remain active` : ""}`);
          reload();
        }}
      />
    </div>
  );
}

// ─────────────────────────── page ───────────────────────────

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (sp.get("tab") as Tab) || "import";
  const [batches, setBatches] = useState<UploadedBatch[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [stage, setStage] = useState<"upload" | "map" | "review" | "done">("upload");
  const [result, setResult] = useState<any>(null);
  const [fileName, setFileName] = useState("");
  const activeBatch = batches.find((b) => b.id === active);
  /** For recognised HMS reports the bulk panel is the default; this switches to the one-batch review. */
  const [reviewOne, setReviewOne] = useState(false);
  // Bulk "check all / import all" for recognised reports and for any multi-sheet file whose columns all matched.
  const bulkReady = batches.length > 0 && batches.every((b) => b.note || (batches.length > 1 && !b.suggestion.missingRequired.length));
  const can = useCan();
  const backfill = sp.get("backfill") === "1";
  const setBackfill = (on: boolean) => {
    const n = new URLSearchParams(sp.toString());
    if (on) n.set("backfill", "1");
    else n.delete("backfill");
    router.replace(`${path}?${n.toString()}`);
  };

  const continueBatch = async (id: string) => {
    const d = await apiFetch<any>(`/api/import/${id}`);
    router.replace(`${path}?tab=import`);
    if (d.batch.status === "VALIDATED") {
      setActive(id);
      setStage("review");
    } else {
      const raw = await apiFetch<any>(`/api/import/${id}/rows?pageSize=5`);
      setBatches([{ id, sheetName: d.batch.sheetName, headerRow: 1, headers: d.batch.headers, rows: d.batch.recordsFound, type: d.batch.module, sample: raw.rows.map((r: any) => r.raw), suggestion: d.suggestion, previouslyImported: [], note: d.batch.options?.note ?? null }]);
      setActive(id);
      setStage("map");
    }
  };

  return (
    <>
      <PageHeader title="Excel Import Centre" subtitle="Bring historical AED data in — analytics use each row's transaction date, never the upload date" />
      <div className="space-y-4">
        <Tabs<Tab> value={tab} onChange={(t) => router.replace(`${path}?tab=${t}${backfill ? "&backfill=1" : ""}`)} tabs={[{ key: "import", label: "Import" }, { key: "history", label: "Import history" }]} />
        {tab === "import" && can("accounts.reopen") && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
            <span>
              Import into closed days (historical backfill — Admin)
              <span className="block text-xs muted">For past months that are already closed: the rows are added, each day stays closed, its closing totals are refreshed and the backfill is recorded in the day&apos;s history and the audit log.</span>
            </span>
          </label>
        )}
        {tab === "history" ? (
          <History onContinue={continueBatch} />
        ) : (
          <>
            {batches.length > 1 && stage !== "upload" && (!bulkReady || reviewOne) && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="muted">{fileName} — sheets:</span>
                {batches.map((b) => (
                  <button
                    key={b.id}
                    className={`btn btn-sm ${b.id === active ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => {
                      setActive(b.id);
                      setStage("map");
                    }}
                  >
                    {b.sheetName} ({b.rows})
                  </button>
                ))}
              </div>
            )}
            {stage === "upload" && (
              <UploadStep
                onUploaded={(bs, name) => {
                  setBatches(bs);
                  setReviewOne(false);
                  setFileName(name);
                  setActive(bs[0].id);
                  setStage("map");
                }}
              />
            )}
            {stage === "map" && batches.length > 0 && bulkReady && !reviewOne && (
              <HmsBulkImport
                key={batches.map((b) => b.id).join()}
                batches={batches}
                onReviewOne={(id) => {
                  setActive(id);
                  setReviewOne(true);
                  setStage("review");
                }}
                onFinished={(r) => {
                  setResult(r);
                  setBatches([]);
                  setStage("done");
                }}
              />
            )}
            {stage === "map" && activeBatch && (!bulkReady || reviewOne) && <MappingStep key={activeBatch.id} batch={activeBatch} onValidated={() => setStage("review")} />}
            {stage === "review" && active && (
              <ReviewStep
                key={active}
                batchId={active}
                onRemap={() => (activeBatch ? setStage("map") : continueBatch(active))}
                onDone={(r) => {
                  setResult(r);
                  const rest = batches.filter((b) => b.id !== active);
                  setBatches(rest);
                  if (rest.length) {
                    setActive(rest[0].id);
                    setStage("map");
                  } else setStage("done");
                }}
              />
            )}
            {stage === "done" && (
              <Card>
                <EmptyState
                  icon={<CheckCircle2 className="h-10 w-10" style={{ color: "var(--status-good)" }} />}
                  title={result ? `Import complete — ${formatNumber(result.imported)} records, ${formatINR(result.amount)}` : "Done"}
                  detail={result ? `${formatNumber(result.rejected)} rows not imported. ${result.newMasters ? `${result.newMasters} new master entries created — review their rates in Master Data.` : ""}` : undefined}
                  action={
                    <div className="flex gap-2">
                      <Button onClick={() => { setStage("upload"); setResult(null); }}>Import another file</Button>
                      <Button variant="secondary" onClick={() => router.push("/analytics?tab=revenue")}>See analytics</Button>
                    </div>
                  }
                />
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Guard perm="import.run">
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
