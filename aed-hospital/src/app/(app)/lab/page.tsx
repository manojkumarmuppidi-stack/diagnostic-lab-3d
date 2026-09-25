"use client";
import { Suspense } from "react";
import { PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleInsights } from "@/components/insights/ModuleInsights";

export default function Page() {
  return (
    <Guard perm="lab.view">
      <PageHeader title="Laboratory & Diagnostics" subtitle="Investigations performed, volumes and revenue" />
      <Suspense fallback={<Spinner />}>
        <div className="space-y-4">
          <ModuleInsights section="lab" />
          <ModuleList module="lab" embedded />
        </div>
      </Suspense>
    </Guard>
  );
}
