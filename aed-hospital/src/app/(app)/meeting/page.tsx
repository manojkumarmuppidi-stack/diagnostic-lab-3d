"use client";
/**
 * Board Meeting pack: a presentation of the hospital's performance for a period versus the
 * comparison period — headline KPIs, auto-generated insights, trends, mix pies and
 * comparison bars for every department. Works as a scrolling page, as a full-screen
 * slideshow (← → keys) and prints one slide per page (Save as PDF).
 */
import { FreshnessBanner } from "@/components/FreshnessBanner";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Expand, Minimize, Printer, Sparkles } from "lucide-react";
import { qs, useApi } from "@/lib/client";
import { INCOME_STREAMS, STREAM_LABELS } from "@/lib/accounting";
import { formatDateTime } from "@/lib/dates";
import { fmtValue, insightsFromComparison, rankInsights, type Comparison, type Insight, type KpiCompare } from "@/lib/insights";
import type { ResolvedPeriod } from "@/lib/periods";
import { Guard } from "@/components/Guard";
import { ErrorState, Spinner } from "@/components/ui";
import { PeriodPicker, periodQuery, type PeriodValue } from "@/components/PeriodPicker";
import { BarsChart, STREAM_COLORS } from "@/components/charts/Charts";
import { ComparisonBars, InsightList, KpiCompareCard, SharePie, type SectionData } from "@/components/insights/InsightViews";

interface TrendRow {
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  marginPct: number;
  patients: number;
  partial: boolean;
  [k: string]: number | string | boolean;
}
interface Pack {
  hospital: string;
  address: string;
  generatedAt: string;
  generatedBy: string;
  period: ResolvedPeriod;
  sections: SectionData[];
  trend: TrendRow[];
  topInsights: Insight[];
}

const PRIMARY: Record<string, [string, string]> = {
  // [comparison for bars, comparison for pie]
  opd: ["opd-specialty-revenue", "opd-visit"],
  ipd: ["ipd-type-collected", "ipd-type-admissions"],
  lab: ["lab-revenue", "lab-category"],
  pharmacy: ["pharmacy-lines", "pharmacy-lines"],
  diet: ["diet-revenue", "diet-count"],
  expense: ["expense-category", "expense-category"],
};

/** Item-by-item table slide: tests performed, medicines sold … this period, previous, change, per week. */
function TopItemsSlide({ n, total, c, period, curLabel, prevLabel, title, itemLabel }: { n: number; total: number; c: Comparison; period: { current: { from: string; to: string } }; curLabel: string; prevLabel: string; title: string; itemLabel: string }) {
  const days = Math.max(1, Math.round((Date.parse(period.current.to) - Date.parse(period.current.from)) / 86_400_000) + 1);
  const weeks = days / 7;
  const half = Math.ceil(c.rows.length / 2);
  const cols = [c.rows.slice(0, half), c.rows.slice(half)].filter((x) => x.length);
  return (
    <Slide n={n} total={total} kicker="Department review" title={title} subtitle={`${curLabel} vs ${prevLabel}${days >= 7 ? " · per-week average over the period" : ""}`}>
      <div className={`grid gap-4 ${cols.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {cols.map((rows, ci) => (
          <div key={ci} className="panel-present rounded-2xl border p-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-2">
                  <th className="py-1.5">{itemLabel}</th>
                  <th className="py-1.5 text-right">{curLabel}</th>
                  <th className="py-1.5 text-right">{prevLabel}</th>
                  <th className="py-1.5 text-right">Change</th>
                  {days >= 7 && <th className="py-1.5 text-right">Per week</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const diff = r.current - r.previous;
                  return (
                    <tr key={r.key} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1.5">
                        <span className="text-xs text-2">{ci * half + i + 1}. </span>
                        {r.name}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{fmtValue(r.current, c.unit)}</td>
                      <td className="py-1.5 text-right tabular-nums text-2">{fmtValue(r.previous, c.unit)}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: diff > 0 ? "var(--status-good)" : diff < 0 ? "var(--status-critical)" : undefined }}>
                        {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                        {fmtValue(Math.abs(diff), c.unit)}
                        {r.previous > 0 && <span className="text-xs"> ({diff >= 0 ? "+" : ""}{Math.round((diff / r.previous) * 100)}%)</span>}
                      </td>
                      {days >= 7 && <td className="py-1.5 text-right tabular-nums">{c.unit === "money" ? fmtValue(r.current / weeks, "money") : (r.current / weeks).toFixed(1)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Slide>
  );
}

function Slide({ n, total, kicker, title, children, subtitle }: { n: number; total: number; kicker: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="slide">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="slide-kicker">{kicker}</p>
          <h2 className="slide-title">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-2">{subtitle}</p>}
        </div>
        <span className="text-xs tabular-nums muted">
          {n} / {total}
        </span>
      </header>
      <div className="slide-body">{children}</div>
    </section>
  );
}

function Panel({ title, children, h }: { title?: string; children: ReactNode; h?: number }) {
  return (
    <div className="panel-present rounded-2xl border p-4">
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      <div style={h ? { height: h } : undefined}>{children}</div>
    </div>
  );
}

export default function MeetingPage() {
  const [period, setPeriod] = useState<PeriodValue>({ preset: "this_month", compareMode: "like_for_like" });
  const url = period.preset === "custom" && (!period.from || !period.to) ? null : `/api/board-pack${qs(periodQuery(period))}`;
  const { data, error, loading, reload } = useApi<Pack>(url);
  const deckRef = useRef<HTMLDivElement>(null);
  const [presenting, setPresenting] = useState(false);
  const [idx, setIdx] = useState(0);

  const slides = useMemo(() => (data ? buildSlides(data) : []), [data]);
  const go = useCallback((d: number) => setIdx((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);

  useEffect(() => {
    const onFs = () => setPresenting(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(1);
      }
      if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
      if (e.key === "Escape" && !document.fullscreenElement) setPresenting(false);
      if (e.key === "Home") setIdx(0);
      if (e.key === "End") setIdx(slides.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, go, slides.length]);

  // Printing: each slide must fit one A4 landscape page. Real data can make a slide taller than
  // the page, so measure every slide at page width just before printing and zoom it down to fit.
  useEffect(() => {
    const PAGE_W = 1122 - 53; // 297 mm at 96 dpi, minus the 7 mm print padding on each side
    const PAGE_H = 794 - 60; // 210 mm, minus padding and a small safety margin
    const fit = () => {
      const root = document.querySelector<HTMLElement>(".present-root");
      if (!root) return;
      const pages = [...root.querySelectorAll<HTMLElement>(".slide-page")];
      const width = root.style.width;
      root.style.width = `${PAGE_W}px`;
      for (const el of pages) {
        el.style.removeProperty("zoom");
        const slide = el.firstElementChild as HTMLElement | null;
        const h = slide ? slide.scrollHeight : el.scrollHeight;
        if (h > PAGE_H) el.style.setProperty("zoom", String(Math.max(0.45, PAGE_H / h)));
      }
      root.style.width = width;
    };
    const reset = () => document.querySelectorAll<HTMLElement>(".present-root .slide-page").forEach((el) => el.style.removeProperty("zoom"));
    window.addEventListener("beforeprint", fit);
    window.addEventListener("afterprint", reset);
    return () => {
      window.removeEventListener("beforeprint", fit);
      window.removeEventListener("afterprint", reset);
    };
  }, []);

  const present = async () => {
    setIdx(0);
    if (deckRef.current?.requestFullscreen) await deckRef.current.requestFullscreen().catch(() => setPresenting(true));
    else setPresenting(true);
  };
  const exit = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    setPresenting(false);
  };

  return (
    <Guard perm="analytics.view">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 no-print">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <Sparkles className="h-5 w-5" style={{ color: "#c9a227" }} /> Board Meeting Pack
          </h1>
          <p className="text-sm muted">Performance, comparisons and insights — present full-screen or save as PDF</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker value={period} onChange={setPeriod} />
          <button className="btn btn-secondary" onClick={() => window.print()} disabled={!data}>
            <Printer className="h-4 w-4" /> PDF
          </button>
          <button className="btn btn-primary" onClick={present} disabled={!data}>
            <Expand className="h-4 w-4" /> Present
          </button>
        </div>
      </div>
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Spinner label="Preparing the meeting pack…" />}
      {data && (
        <div className="no-print mb-4">
          <FreshnessBanner to={data.period.current.to} />
        </div>
      )}
      {data && (
        <div ref={deckRef} className={`present-root ${presenting ? "is-presenting" : ""}`} style={{ opacity: loading ? 0.6 : 1 }}>
          {presenting ? (
            <>
              <div className="present-stage">{slides[idx]?.(idx + 1, slides.length)}</div>
              <div className="present-controls no-print">
                <button onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous slide">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex gap-1.5">
                  {slides.map((_, i) => (
                    <button key={i} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}`} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-[#c9a227]" : "w-1.5 bg-white/30"}`} />
                  ))}
                </div>
                <button onClick={() => go(1)} disabled={idx === slides.length - 1} aria-label="Next slide">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <button onClick={exit} aria-label="Exit presentation">
                  <Minimize className="h-5 w-5" />
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-6">{slides.map((s, i) => <div key={i} className="slide-page">{s(i + 1, slides.length)}</div>)}</div>
          )}
        </div>
      )}
    </Guard>
  );
}

type SlideFn = (n: number, total: number) => ReactNode;

function buildSlides(p: Pack): SlideFn[] {
  const cur = p.period.current.label;
  const prev = p.period.previous.label;
  const range = (r: { from: string; to: string }) => (r.from === r.to ? r.from : `${r.from} → ${r.to}`);
  const ov = p.sections.find((s) => s.key === "overview");
  const k = (key: string) => ov?.kpis.find((x) => x.key === key);
  const cmp = (s: SectionData | undefined, id: string) => s?.comparisons.find((c) => c.id === id);
  const incomeCmp = cmp(ov, "income-stream");
  const slides: SlideFn[] = [];

  // 1. Cover
  slides.push(() => (
    <section className="slide cover">
      <div className="cover-glow" aria-hidden />
      <p className="slide-kicker">Board meeting · Performance review</p>
      <h1 className="cover-title">{p.hospital}</h1>
      <p className="mt-2 text-lg text-2">{p.address}</p>
      <div className="gold-rule" />
      <p className="text-2xl font-semibold">{cur}</p>
      <p className="mt-1 text-sm text-2">
        {range(p.period.current)} · compared with {prev} ({range(p.period.previous)})
      </p>
      {ov && (
        <div className="mt-10 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          {["totalIncome", "totalExpenses", "netOperatingResult"].map((key) => k(key) && <KpiCompareCard key={key} k={k(key)!} prevLabel={prev} big present />)}
        </div>
      )}
      <p className="mt-10 text-xs muted">
        Prepared {formatDateTime(p.generatedAt)} by {p.generatedBy} · Income on collections basis by transaction date · Active records only
      </p>
    </section>
  ));

  // 2. Executive summary
  if (ov)
    slides.push((n, t) => (
      <Slide n={n} total={t} kicker="Executive summary" title="What changed this period" subtitle={`${cur} vs ${prev}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {["totalIncome", "totalExpenses", "netOperatingResult", "netMarginPct"].map((key) => k(key) && <KpiCompareCard key={key} k={k(key)!} prevLabel={prev} big present />)}
        </div>
        <div className="mt-5">
          <InsightList insights={p.topInsights} limit={8} present />
        </div>
      </Slide>
    ));

  // 3. Six-month trend
  slides.push((n, t) => (
    <Slide n={n} total={t} kicker="Trend" title="Six-month performance" subtitle={p.trend.some((r) => r.partial) ? "Latest month is month-to-date" : undefined}>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="Income by stream, per month" h={320}>
            <BarsChart data={p.trend} xKey="month" stacked granularity="month" series={INCOME_STREAMS.map((s) => ({ key: s, label: STREAM_LABELS[s], color: STREAM_COLORS[s] }))} />
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="Income vs expenses, per month" h={320}>
            <BarsChart data={p.trend} xKey="month" granularity="month" series={[{ key: "income", label: "Income", color: "var(--series-1)" }, { key: "expenses", label: "Expenses", color: "var(--series-2)" }]} />
          </Panel>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {p.trend.map((r) => (
          <div key={r.month} className="panel-present rounded-xl border p-3 text-center">
            <p className="text-xs muted">
              {r.label}
              {r.partial ? " (MTD)" : ""}
            </p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: r.net < 0 ? "var(--bad)" : undefined }}>
              {fmtValue(r.net, "money")}
            </p>
            <p className="text-xs text-2">net · {r.marginPct.toFixed(1)}% margin</p>
          </div>
        ))}
      </div>
    </Slide>
  ));

  // 4. Revenue mix
  if (incomeCmp)
    slides.push((n, t) => (
      <Slide n={n} total={t} kicker="Revenue" title="Revenue mix and movement" subtitle="Share of income by stream, and change versus the comparison period">
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title={cur} h={260}>
            <SharePie c={incomeCmp} />
          </Panel>
          <Panel title={prev} h={260}>
            <SharePie c={incomeCmp} which="previous" />
          </Panel>
          <Panel title="Stream comparison" h={260}>
            <ComparisonBars c={incomeCmp} curLabel={cur} prevLabel={prev} />
          </Panel>
        </div>
        <div className="mt-4">
          <InsightList insights={rankInsights(insightsFromComparison(incomeCmp, prev), 4)} present empty="No material change in the revenue mix." />
        </div>
      </Slide>
    ));

  // 5. Operations & collections
  if (ov)
    slides.push((n, t) => {
      const modes = cmp(ov, "collections-mode");
      const exp = cmp(ov, "expense-kind");
      return (
        <Slide n={n} total={t} kicker="Operations" title="Volumes, collections and spend">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {["patients", "consultations", "labTests", "admissions", "revenuePerPatient"].map((key) => k(key) && <KpiCompareCard key={key} k={k(key)!} prevLabel={prev} present />)}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {modes && (
              <Panel title="How patients paid" h={250}>
                <SharePie c={modes} />
              </Panel>
            )}
            {exp && (
              <Panel title="Expenditure comparison" h={250}>
                <ComparisonBars c={exp} curLabel={cur} prevLabel={prev} />
              </Panel>
            )}
          </div>
        </Slide>
      );
    });

  // 6+. Department slides
  for (const s of p.sections.filter((x) => x.key !== "overview")) {
    const [barId, pieId] = PRIMARY[s.key] ?? [];
    const full = cmp(s, barId) ?? s.comparisons[0];
    // Keep slides readable: at most 8 bars (the rest are in the module page / table view).
    const bars = full ? { ...full, rows: full.rows.slice(0, 8) } : full;
    const pie = cmp(s, pieId) ?? s.comparisons[1] ?? bars;
    slides.push((n, t) => (
      <Slide n={n} total={t} kicker="Department review" title={s.title}>
        <div className={`grid grid-cols-2 gap-3 ${s.kpis.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {s.kpis.slice(0, 5).map((x: KpiCompare) => (
            <KpiCompareCard key={x.key} k={x} prevLabel={prev} present />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          {bars && (
            <div className="lg:col-span-3">
              <Panel title={bars.title} h={Math.max(240, Math.min(360, bars.rows.length * 34 + 60))}>
                <ComparisonBars c={bars as Comparison} curLabel={cur} prevLabel={prev} />
              </Panel>
            </div>
          )}
          {pie && (
            <div className="lg:col-span-2">
              <Panel title={`${pie.title} — share`} h={Math.max(240, Math.min(360, (bars?.rows.length ?? 5) * 34 + 60))}>
                <SharePie c={pie as Comparison} />
              </Panel>
            </div>
          )}
        </div>
        <div className="mt-4">
          <InsightList insights={s.insights} limit={4} present />
        </div>
      </Slide>
    ));
    const volume = s.key === "lab" ? cmp(s, "lab-volume") : undefined;
    if (volume && volume.rows.length) slides.push((n, t) => <TopItemsSlide n={n} total={t} c={volume as Comparison} period={p.period} curLabel={cur} prevLabel={prev} title="Laboratory — tests performed, test by test" itemLabel="Test" />);
    const meds = s.key === "pharmacy" ? cmp(s, "pharmacy-medicine-revenue") : undefined;
    const medUnits = s.key === "pharmacy" ? cmp(s, "pharmacy-medicine-units") : undefined;
    if (meds && meds.rows.length) slides.push((n, t) => <TopItemsSlide n={n} total={t} c={meds as Comparison} period={p.period} curLabel={cur} prevLabel={prev} title="Pharmacy — top medicines by sales value" itemLabel="Medicine" />);
    if (medUnits && medUnits.rows.length) slides.push((n, t) => <TopItemsSlide n={n} total={t} c={medUnits as Comparison} period={p.period} curLabel={cur} prevLabel={prev} title="Pharmacy — top medicines by units sold" itemLabel="Medicine" />);
  }

  // Last: findings & method
  slides.push((n, t) => (
    <Slide n={n} total={t} kicker="Summary" title="Key findings & notes">
      <InsightList insights={p.topInsights} present />
      <div className="panel-present mt-5 rounded-2xl border p-4 text-xs text-2">
        <p className="mb-1 font-semibold">How these numbers are calculated</p>
        <p>
          Total income = OPD + IPD collections + Lab + Pharmacy net sales (after returns) + Diet + Other income. Total expenses = hospital operating + pharmacy purchases + other expenses. Net operating result = income − expenses. Figures use the transaction date, count only active records, and
          compare {range(p.period.current)} with {range(p.period.previous)}. Percentage changes are not shown when the comparison value is zero. Pharmacy margin uses purchases as a proxy for cost of goods sold.
        </p>
      </div>
    </Slide>
  ));
  return slides;
}
