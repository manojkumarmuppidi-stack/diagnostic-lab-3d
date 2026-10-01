"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Today at AED" — a one-page A4 daily summary designed to be saved as PDF (browser print).
 * Always printed on white paper, whatever the screen theme.
 */
import { FreshnessBanner } from "@/components/FreshnessBanner";
import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FileDown } from "lucide-react";
import { useApi } from "@/lib/client";
import { STREAM_LABELS, AED_INCOME_STREAMS } from "@/lib/accounting";
import { addDays, formatDate, formatDateTime, formatDayMonth, todayISO } from "@/lib/dates";
import { formatINR, formatINRCompact, formatNumber } from "@/lib/money";
import { ErrorState, Spinner } from "@/components/ui";
import { BarsChart, SLOT, STREAM_COLORS } from "@/components/charts/Charts";

const MODE_LABELS: Record<string, string> = { CASH: "Cash", CARD: "Card", UPI: "UPI", BANK: "Bank / cheque", OTHER: "Other / not recorded" };

function Delta({ cur, prev, money }: { cur: number; prev: number; money?: boolean }) {
  const diff = cur - prev;
  if (prev === 0 && cur === 0) return <span className="ds-muted">—</span>;
  const pct = prev === 0 ? null : Math.round((diff / Math.abs(prev)) * 100);
  const color = diff > 0 ? "var(--good)" : diff < 0 ? "var(--bad)" : "var(--text-3)";
  return (
    <span style={{ color }}>
      {diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} {pct === null ? "new" : `${Math.abs(pct)}%`}
      <span className="ds-muted"> ({money ? formatINRCompact(prev) : formatNumber(prev)})</span>
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="ds-stat">
      <div className="ds-label">{label}</div>
      <div className="ds-value">{value}</div>
      {sub && <div className="ds-sub">{sub}</div>}
    </div>
  );
}

function Sheet({ d }: { d: any }) {
  const t = d.today;
  const lw = d.lastWeek;
  const streams = AED_INCOME_STREAMS.map((s) => ({ key: s, name: STREAM_LABELS[s], today: t.byStream[s], lastWeek: lw.byStream[s] })).filter((x) => x.today || x.lastWeek);
  const modes = Object.entries(d.modes as Record<string, number>)
    .filter(([, v]) => v > 0)
    .map(([k, v], i) => ({ key: k, name: MODE_LABELS[k] ?? k, value: v, color: k === "OTHER" ? "var(--other-slice)" : SLOT(i) }));
  const total = modes.reduce((a, m) => a + m.value, 0);
  const empty = t.income === 0 && t.counts.consultations === 0 && t.counts.labTests === 0;
  return (
    <article className="ds-sheet">
      <header className="ds-head">
        <div>
          <div className="ds-kicker">AED Hospital · KPHB, Hyderabad</div>
          <h1 className="ds-title">Daily summary — {d.weekday}, {formatDate(d.date)}</h1>
          <div className="ds-muted">
            Compared with {d.compare.lastWeekLabel} ({formatDayMonth(d.compare.lastWeek)}) and yesterday · day status: <b>{String(d.status).toLowerCase()}</b>
          </div>
        </div>
        <div className="ds-total">
          <div className="ds-label">AED Hospital income</div>
          <div className="ds-big">{formatINR(t.income)}</div>
          <div className="ds-sub">
            vs {d.compare.lastWeekLabel}: <Delta cur={t.income} prev={lw.income} money /> · yesterday <Delta cur={t.income} prev={d.yesterday.income} money />
          </div>
          {d.typical !== null && <div className="ds-sub ds-muted">Typical {d.weekday}: {formatINRCompact(d.typical)} (avg of last {d.compare.typicalOver})</div>}
        </div>
      </header>
      <FreshnessBanner to={d.date} print />

      {empty ? (
        <p className="ds-empty">No income or activity is recorded for this day yet. Upload the day&apos;s OneGlance reports (Excel Import) or enter bills, then download again.</p>
      ) : (
        <>
          <section className="ds-grid6">
            <Stat label="Patients" value={formatNumber(t.counts.patients)} sub={<Delta cur={t.counts.patients} prev={lw.counts.patients} />} />
            <Stat label="Consultations" value={formatNumber(t.counts.consultations)} sub={<span>New {formatNumber(t.counts.newConsultations)} · Old {formatNumber(t.counts.oldConsultations)}</span>} />
            <Stat label="Lab tests" value={formatNumber(t.counts.labTests)} sub={<Delta cur={t.counts.labTests} prev={lw.counts.labTests} />} />
            <Stat
              label="Hormonal Pharmacy (separate)"
              value={formatINRCompact(t.pharmacySales ?? 0)}
              sub={<span>{t.pharmacyBills === null ? "" : `${formatNumber(t.pharmacyBills)} bills · `}not in AED totals</span>}
            />
            <Stat label="IPD admissions" value={formatNumber(t.counts.admissions)} sub={<Delta cur={t.counts.admissions} prev={lw.counts.admissions} />} />
            <Stat label="AED expenses · Net" value={formatINRCompact(t.expenses)} sub={<span>Net {formatINRCompact(t.net ?? t.income - t.expenses)}</span>} />
          </section>

          <section className="ds-row">
            <div className="ds-panel ds-wide">
              <h2>Income by stream — today vs {d.compare.lastWeekLabel}</h2>
              <div style={{ height: 190 }}>
                <BarsChart
                  data={streams}
                  xKey="name"
                  horizontal
                  series={[
                    { key: "lastWeek", label: d.compare.lastWeekLabel, color: "var(--prev-bar)" },
                    { key: "today", label: "Today", color: SLOT(0) },
                  ]}
                />
              </div>
            </div>
            <div className="ds-panel">
              <h2>Collections by payment mode</h2>
              {modes.length ? (
                <table className="ds-table">
                  <tbody>
                    {modes.map((m) => {
                      const pct = total ? (m.value / total) * 100 : 0;
                      return (
                        <tr key={m.key}>
                          <td style={{ width: "38%" }}>{m.name}</td>
                          <td style={{ width: "30%" }}>
                            <div className="ds-bar">
                              <span style={{ width: `${Math.max(2, pct)}%`, background: m.color }} />
                            </div>
                          </td>
                          <td className="num">{formatINRCompact(m.value)}</td>
                          <td className="num ds-muted">{Math.round(pct)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="ds-muted">No collections.</p>
              )}
            </div>
          </section>

          <section className="ds-row">
            <div className="ds-panel ds-wide">
              <h2>Last 14 days — income</h2>
              <div style={{ height: 150 }}>
                <BarsChart data={d.trend} xKey="bucket" granularity="day" series={[{ key: "income", label: "Income", color: SLOT(0) }]} />
              </div>
            </div>
            <div className="ds-panel">
              <h2>Stream split</h2>
              <table className="ds-table">
                <tbody>
                  {streams.map((s) => (
                    <tr key={s.key}>
                      <td>
                        <span className="ds-dot" style={{ background: STREAM_COLORS[s.key as keyof typeof STREAM_COLORS] }} />
                        {s.name}
                      </td>
                      <td className="num">{formatINR(s.today)}</td>
                      <td className="num ds-muted">{t.income ? `${Math.round((s.today / t.income) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(d.topTests || d.topMedicines) && (
            <section className="ds-row">
              {d.topTests && (
                <div className="ds-panel">
                  <h2>Top tests today</h2>
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th className="num">Today</th>
                        <th className="num">{d.compare.lastWeekLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topTests.map((x: any) => (
                        <tr key={x.name}>
                          <td>{x.name}</td>
                          <td className="num">{formatNumber(x.tests)}</td>
                          <td className="num ds-muted">{formatNumber(x.lastWeek)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.topMedicines && (
                <div className="ds-panel">
                  <h2>Top medicines today</h2>
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th className="num">Units</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topMedicines.map((x: any) => (
                        <tr key={x.name}>
                          <td>{x.name}</td>
                          <td className="num">{formatNumber(x.units)}</td>
                          <td className="num">{formatINR(x.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="ds-panel">
            <h2>What stands out</h2>
            {d.insights.length ? (
              <ul className="ds-insights">
                {d.insights.map((i: any) => (
                  <li key={i.id} data-tone={i.tone}>
                    <b>{i.headline}.</b> <span className="ds-muted">{i.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ds-muted">No significant change versus {d.compare.lastWeekLabel}.</p>
            )}
          </section>
        </>
      )}

      <footer className="ds-foot">
        AED Hospital income = collections on the day (OPD + IPD collections + Lab + Diet + Other); Hormonal Pharmacy is a separate entity and is not included. Expenses include the day&apos;s share of monthly expenses. Generated {formatDateTime(d.generatedAt)}.
      </footer>
    </article>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const date = sp.get("date") || todayISO();
  const autoPrint = sp.get("print") === "1";
  const { data, error, loading, reload } = useApi<any>(`/api/daily-summary?date=${date}`);
  const printed = useRef(false);
  const go = (d: string) => router.replace(`${path}?date=${d}`);

  useEffect(() => {
    // ?print=1 (the Dashboard button) opens the print dialog once charts have drawn.
    if (autoPrint && data && !printed.current) {
      printed.current = true;
      const h = setTimeout(() => window.print(), 900);
      return () => clearTimeout(h);
    }
  }, [autoPrint, data]);

  return (
    <div className="ds-root">
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Daily summary (PDF)</h1>
          <p className="text-sm muted">One A4 page — in the print window choose “Save as PDF”.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-secondary" onClick={() => go(addDays(date, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input type="date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Date" />
          <button className="btn btn-secondary" onClick={() => go(addDays(date, 1))} disabled={date >= todayISO()} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!data || loading}>
            <FileDown className="h-4 w-4" /> Download PDF
          </button>
        </div>
      </div>
      <ErrorState error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && data.date === date && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <Sheet d={data} />
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner />
    </Suspense>
  );
}
