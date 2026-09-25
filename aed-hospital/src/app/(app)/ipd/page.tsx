"use client";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader, Spinner, Tabs, Card, EmptyState } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleSummary } from "@/components/ModuleSummary";
import { useApi } from "@/lib/client";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";

type Tab = "admissions" | "payments" | "outstanding";

function Outstanding() {
  type O = { id: string; patientName: string; admissionDate: string; billed: number; collected: number; balance: number };
  const { data: d } = useApi<{ outstandingList: O[]; totals: { outstanding: number } }>("/api/summary/ipd");
  if (!d) return <Spinner />;
  if (!d.outstandingList?.length) return <EmptyState title="No outstanding IPD balances" />;
  return (
    <Card title={`Outstanding balances · ${formatINR(d.totals?.outstanding ?? 0)}`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Admitted</th>
              <th>Patient</th>
              <th className="num">Billed</th>
              <th className="num">Collected</th>
              <th className="num">Balance due</th>
            </tr>
          </thead>
          <tbody>
            {d.outstandingList.map((o) => (
              <tr key={o.id}>
                <td>{formatDate(o.admissionDate)}</td>
                <td>
                  <Link className="underline" href={`/ipd?q=${encodeURIComponent(o.patientName ?? "")}&from=&to=`}>
                    {o.patientName ?? "—"}
                  </Link>
                </td>
                <td className="num">{formatINR(o.billed)}</td>
                <td className="num">{formatINR(o.collected)}</td>
                <td className="num font-semibold">{formatINR(o.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <ModuleSummary module="ipd" />
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
