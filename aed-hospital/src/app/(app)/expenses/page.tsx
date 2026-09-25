"use client";
import { Suspense } from "react";
import { PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleInsights } from "@/components/insights/ModuleInsights";

export default function Page() {
  return (
    <Guard perm="expense.view">
      <PageHeader title="Expenses" subtitle="Hospital operating and other expenses, with bills" />
      <Suspense fallback={<Spinner />}>
        <div className="space-y-4">
          <ModuleInsights section="expense" />
          <ModuleList module="expense" embedded />
        </div>
      </Suspense>
    </Guard>
  );
}
