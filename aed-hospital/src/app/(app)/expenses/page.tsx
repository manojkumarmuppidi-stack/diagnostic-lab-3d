"use client";
import { Suspense } from "react";
import { PageHeader, Spinner } from "@/components/ui";
import { Guard } from "@/components/Guard";
import { ModuleList } from "@/components/ModuleList";
import { ModuleSummary } from "@/components/ModuleSummary";

export default function Page() {
  return (
    <Guard perm="expense.view">
      <PageHeader title="Expenses" subtitle="Hospital operating and other expenses, with bills" />
      <Suspense fallback={<Spinner />}>
        <div className="space-y-4">
          <ModuleSummary module="expense" />
          <ModuleList module="expense" embedded />
        </div>
      </Suspense>
    </Guard>
  );
}
