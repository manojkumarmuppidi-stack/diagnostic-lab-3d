"use client";
import { Suspense } from "react";
import { PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleInsights } from "@/components/insights/ModuleInsights";

export default function Page() {
  return (
    <Guard perm="opd.view">
      <PageHeader title="OPD Consultations" subtitle="New / old consultations by specialty and doctor" />
      <Suspense fallback={<Spinner />}>
        <div className="space-y-4">
          <ModuleInsights section="opd" />
          <ModuleList module="opd" embedded />
        </div>
      </Suspense>
    </Guard>
  );
}
