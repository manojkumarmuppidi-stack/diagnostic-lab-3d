"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Sparkles } from "lucide-react";
import { qs, useApi } from "@/lib/client";
import { startOfMonth } from "@/lib/dates";
import type { ResolvedPeriod } from "@/lib/periods";
import { useSession } from "../session";
import { Spinner } from "../ui";
import { SectionView, type SectionData } from "./InsightViews";

/**
 * "Insights & comparison" panel for a module page. Uses the list's date range from the URL
 * and compares it with the preceding comparable range.
 */
export function ModuleInsights({
  section,
  defaultOpen = true,
  query,
  title = "Insights & comparison",
}: {
  section: "overview" | "opd" | "ipd" | "lab" | "pharmacy" | "diet" | "expense";
  defaultOpen?: boolean;
  /** Explicit period query (otherwise the page's ?from/&to are used). */
  query?: Record<string, string | undefined>;
  title?: string;
}) {
  const sp = useSearchParams();
  const { today } = useSession();
  const [open, setOpen] = useState(defaultOpen);
  const from = sp.get("from") || startOfMonth(today);
  const to = sp.get("to") || today;
  const { data, loading } = useApi<{ period: ResolvedPeriod; section: SectionData }>(open ? `/api/insights/${section}${qs(query ?? { from, to })}` : null);
  return (
    <section className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "linear-gradient(135deg, color-mix(in srgb, var(--brand) 7%, var(--surface)), var(--surface))" }}>
      <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" style={{ color: "var(--brand)" }} /> {title}
          {data && (
            <span className="font-normal muted">
              · {data.period.current.label} vs {data.period.previous.label}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-4 sm:px-4" style={{ opacity: loading && data ? 0.6 : 1 }}>
          {!data ? <Spinner label="Analysing…" /> : <SectionView s={data.section} curLabel={data.period.current.label} prevLabel={data.period.previous.label} />}
        </div>
      )}
    </section>
  );
}
