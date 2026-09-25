"use client";
import { Suspense } from "react";
import { PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleSummary } from "@/components/ModuleSummary";

export default function Page() {
  return (
    <Guard perm="diet.view">
      <PageHeader title="Diet & Nutrition" subtitle="Diet counselling and nutrition services" />
      <Suspense fallback={<Spinner />}>
        <div className="space-y-4">
          <ModuleSummary module="diet" />
          <ModuleList module="diet" embedded />
        </div>
      </Suspense>
    </Guard>
  );
}
