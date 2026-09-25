"use client";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Spinner, Tabs } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleInsights } from "@/components/insights/ModuleInsights";

type Tab = "sales" | "purchases" | "returns";

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (sp.get("tab") as Tab) || "sales";
  const setTab = (t: Tab) => {
    const n = new URLSearchParams(sp.toString());
    n.set("tab", t);
    ["q", "page", "paymentModeId"].forEach((k) => n.delete(k));
    router.replace(`${path}?${n.toString()}`);
  };
  return (
    <div className="space-y-4">
      <ModuleInsights section="pharmacy" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "sales", label: "Sales" },
          { key: "purchases", label: "Purchases" },
          { key: "returns", label: "Returns" },
        ]}
      />
      {tab === "sales" && <ModuleList module="pharmacy-sale" embedded />}
      {tab === "purchases" && <ModuleList module="pharmacy-purchase" embedded />}
      {tab === "returns" && <ModuleList module="pharmacy-return" embedded />}
    </div>
  );
}

export default function Page() {
  return (
    <Guard perm="pharmacy.view">
      <PageHeader title="Pharmacy" subtitle="Sales, stock purchases and returns — kept separate from hospital operating expenses" />
      <Suspense fallback={<Spinner />}>
        <Inner />
      </Suspense>
    </Guard>
  );
}
