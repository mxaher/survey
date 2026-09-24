"use client";

import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { EmployeeApp } from "@/components/employee/employee-app";

const AdminApp = dynamic(
  () => import("@/components/admin/admin-app").then((m) => m.AdminApp),
  { ssr: false }
);

function ViewSwitchInner() {
  const sp = useSearchParams();
  const view = sp.get("view") ?? "employee";
  if (view === "admin") return <AdminApp />;
  return <EmployeeApp />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ViewSwitchInner />
    </Suspense>
  );
}
