"use client";
import { Suspense } from "react";
import { PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleSummary } from "@/components/ModuleSummary";

export default function Page() {
  return (
    <Guard perm="income.view">
      <PageHeader title="Other Income" subtitle="Rent, sponsorships and other non-clinical income" />
      <Suspense fallback={<Spinner />}>
        <div className="space-y-4">
          <ModuleSummary module="other-income" />
          <ModuleList module="other-income" embedded />
        </div>
      </Suspense>
    </Guard>
  );
}
