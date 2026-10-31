"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fixed assets: vehicles and equipment recorded at cost (not as expenses), their depreciation per
 * financial year, and posting a finished year's depreciation as an expense.
 */
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { apiFetch, useApi } from "@/lib/client";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Button, Card, EmptyState, ErrorState, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { useCan } from "@/components/session";
import { AssetForm, EMPTY_ASSET } from "@/components/assets/AssetForm";

const inr = (v: number) => formatINR(Math.round(v));
/** Capital purchases that went in as expenses: tick the ones that make up one asset and record it. */
function FromExpenses({ onDone }: { onDone: () => void }) {
  const can = useCan();
  const toast = useToast();
  const { data, reload } = useApi<any[]>("/api/assets/from-expenses");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [v, setV] = useState<any>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data?.length) return null;
  const chosen = data.filter((e) => picked.has(e.id));
  const save = async () => {
    setBusy(true);
    try {
      const r: any = await apiFetch("/api/assets/from-expenses", { method: "POST", json: { ...v, expenseIds: chosen.map((e) => e.id), intoClosedDays: closed } });
      toast("success", `Asset recorded at ${inr(r.cost)}; ${r.voided} expense${r.voided === 1 ? "" : "s"} removed from expenses`);
      setV(null);
      setPicked(new Set());
      reload();
      onDone();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Capital purchases entered as expenses">
      <p className="text-sm muted">
        These are under &quot;Equipment (capital)&quot; in the expenses. Tick the payments that make up one asset (e.g. a vehicle and its advance) and record it: the asset is added
        at their total and the expenses are removed, so the purchase is no longer an expense — its depreciation is, once a year.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Date</th>
              <th>Paid to</th>
              <th>Description</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={picked.has(e.id)}
                    onChange={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        return n;
                      })
                    }
                  />
                </td>
                <td>{formatDate(e.date)}</td>
                <td>{e.vendor}</td>
                <td>{e.description}</td>
                <td className="num">{inr(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(can("masters.manage") || can("accounts.reconcile")) && (
        <Button
          className="mt-2"
          disabled={!chosen.length}
          onClick={() => setV({ ...EMPTY_ASSET, name: chosen[0]?.description?.replace(/ — paid by.*$/, "") ?? "", category: chosen[0]?.sub ?? "Vehicles" })}
        >
          Record {chosen.length || ""} as one asset{chosen.length ? ` · ${inr(chosen.reduce((s, e) => s + e.amount, 0))}` : ""}
        </Button>
      )}
      <Modal
        open={!!v}
        onClose={() => setV(null)}
        title="Record as a fixed asset"
        footer={
          <>
            <Button variant="secondary" onClick={() => setV(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} disabled={!v?.name}>
              Record asset
            </Button>
          </>
        }
      >
        {v && (
          <div className="space-y-3">
            <p className="text-sm">
              Cost {inr(chosen.reduce((s, e) => s + e.amount, 0))}, bought {formatDate(chosen.map((e) => e.date).sort()[0])}. The {chosen.length} expense
              {chosen.length === 1 ? "" : "s"} will be removed from expenses.
            </p>
            <AssetForm v={v} set={(k, val) => setV((x: any) => ({ ...x, [k]: val }))} withCost={false} />
            {can("accounts.reopen") && (
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> allow closed days
              </label>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Assets() {
  const can = useCan();
  const toast = useToast();
  const { data, error, reload } = useApi<any>("/api/assets");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState<any>(EMPTY_ASSET);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const edit = can("masters.manage") || can("accounts.reconcile");
  const set = (k: string, val: any) => setV((x: any) => ({ ...x, [k]: val }));
  const add = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/assets", { method: "POST", json: v });
      toast("success", "Asset added");
      setAdding(false);
      setV(EMPTY_ASSET);
      reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const post = async (fy: string) => {
    if (!confirm(`Post the depreciation for ${fy} as expenses (dated 31 March)?`)) return;
    try {
      const r: any = await apiFetch("/api/assets/depreciation", { method: "POST", json: { fy, intoClosedDays: closed } });
      toast("success", `${r.posted} posted, ${inr(r.amount)}`);
      reload();
    } catch (e: any) {
      toast("error", e.message);
    }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const total = (k: string) => data.assets.reduce((s: number, a: any) => s + a[k], 0);
  return (
    <div className="space-y-4">
      <FromExpenses onDone={reload} />
      <Card
        title="Assets"
        actions={
          edit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add asset
            </Button>
          )
        }
      >
        {!data.assets.length ? (
          <EmptyState title="No assets yet" detail="Add one here, or from Bank statement check → Record as asset on the payments that bought it." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Bought</th>
                  <th className="num">Cost</th>
                  <th>Depreciation</th>
                  <th className="num">Depreciation to date</th>
                  <th className="num">Value today</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.assets.map((a: any) => (
                  <Fragment key={a.id}>
                    <tr className="cursor-pointer" onClick={() => setOpen(open === a.id ? null : a.id)}>
                      <td>
                        {open === a.id ? <ChevronDown className="mr-1 inline h-4 w-4" /> : <ChevronRight className="mr-1 inline h-4 w-4" />}
                        {a.name} <span className="text-xs muted">· {a.category}</span>
                      </td>
                      <td>{formatDate(a.purchaseDate)}</td>
                      <td className="num">{inr(a.cost)}</td>
                      <td className="text-xs">
                        {a.method === "WDV" ? `${a.ratePct}% of the remaining value a year` : `Straight line, ${a.usefulLifeYears} years, ${a.residualPct}% residual`}
                      </td>
                      <td className="num">{inr(a.depreciationToDate)}</td>
                      <td className="num font-semibold">{inr(a.bookValueToday)}</td>
                      <td className="text-right">
                        {edit && (
                          <button
                            className="btn btn-ghost btn-sm"
                            aria-label="Remove"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`Remove ${a.name} from the assets? (Its bank payments show as not found again.)`)) return;
                              await apiFetch(`/api/assets/${a.id}`, { method: "DELETE" });
                              reload();
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === a.id && (
                      <tr>
                        <td colSpan={7}>
                          <table className="table text-xs">
                            <thead>
                              <tr>
                                <th>Financial year</th>
                                <th className="num">Opening value</th>
                                <th className="num">Depreciation</th>
                                <th className="num">Closing value</th>
                                <th>Posted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.schedule.map((s: any) => (
                                <tr key={s.fy}>
                                  <td>
                                    {s.fy} {s.from !== `${s.fy.slice(0, 4)}-04-01` && <span className="muted">(from {formatDate(s.from)})</span>}
                                  </td>
                                  <td className="num">{inr(s.opening)}</td>
                                  <td className="num">{inr(s.depreciation)}</td>
                                  <td className="num">{inr(s.closing)}</td>
                                  <td>{s.posted ? "Yes" : s.ended ? "Not yet" : "Year not ended"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="font-semibold">
                  <td colSpan={2}>Total</td>
                  <td className="num">{inr(total("cost"))}</td>
                  <td />
                  <td className="num">{inr(total("depreciationToDate"))}</td>
                  <td className="num">{inr(total("bookValueToday"))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data.years.length > 0 && (
        <Card title="Depreciation by financial year (April–March)">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num">Depreciation</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.years.map((y: any) => (
                  <tr key={y.fy}>
                    <td>{y.fy}</td>
                    <td className="num">{inr(y.depreciation)}</td>
                    <td>{y.posted ? "Posted as expense" : y.ended ? "Ready to post" : `Year in progress — posted after 31 March ${+y.fy.slice(0, 4) + 1}`}</td>
                    <td className="text-right">
                      {can("expense.write") && y.ended && !y.posted && (
                        <Button size="sm" onClick={() => post(y.fy)}>
                          Post as expense
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can("accounts.reopen") && (
            <label className="mt-2 flex items-center gap-1 text-sm">
              <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> allow closed days (31 March may be closed)
            </label>
          )}
          <p className="mt-2 text-xs muted">
            The year&apos;s depreciation is posted once, as an expense under &quot;Depreciation&quot; dated 31 March. The purchase itself is never an expense.
          </p>
        </Card>
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an asset"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={add} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        <AssetForm v={v} set={set} />
      </Modal>
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="accounts.view">
      <PageHeader title="Fixed assets" subtitle="Vehicles and equipment at cost, with yearly depreciation. Buying an asset is not an expense; its depreciation is, once a year." />
      <Assets />
    </Guard>
  );
}
