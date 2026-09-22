"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BarChart3, Eye, FolderKanban, Search } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toRiyadhDate } from "@/lib/time";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type CampaignSummary = {
  id: string;
  titleAr: string;
  descriptionAr: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  minimumReportingThreshold: number;
  enableEnvironmentSurvey: boolean;
  enableFutureSurvey: boolean;
  createdAt: string;
  counts: {
    executives: number;
    questions: number;
    responses: number;
    participationLedger: number;
    questionSnapshots: number;
  };
};

type Envelope<T> = { ok: boolean; data: T };

const STATUS_FILTERS: Array<{ value: string; labelAr: string }> = [
  { value: "all", labelAr: "كل الحالات" },
  { value: "draft", labelAr: "مسودة" },
  { value: "scheduled", labelAr: "مجدولة" },
  { value: "active", labelAr: "نشطة" },
  { value: "closed", labelAr: "مغلقة" },
  { value: "archived", labelAr: "مؤرشفة" },
];

export function ReportsListView() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const { data, isLoading, isError } = useQuery<Envelope<CampaignSummary[]>>({
    queryKey: ["admin-campaigns"],
    queryFn: () => fetchJson<Envelope<CampaignSummary[]>>("/api/admin/campaigns"),
  });

  const campaigns = data?.data ?? [];

  const filtered = useMemo(() => {
    let list = campaigns;
    if (statusFilter !== "all") {
      list = list.filter((c) => c.status === statusFilter);
    }
    const q = search.trim();
    if (q) {
      list = list.filter((c) => c.titleAr.includes(q));
    }
    return list;
  }, [campaigns, statusFilter, search]);

  const openReport = (id: string) => {
    router.push(`/?view=admin&tab=reports&sub=campaign&id=${id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="النتائج / التقارير"
        description="عرض تقارير الحملات وتحليلاتها التفصيلية بصورة إجمالية مع الحفاظ على سرية المشاركين."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم الحملة…"
            className="ps-9"
            aria-label="بحث باسم الحملة"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          dir="rtl"
        >
          <SelectTrigger className="w-full sm:w-48" aria-label="تصفية حسب الحالة">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.labelAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          title="تعذّر تحميل قائمة الحملات"
          description="يرجى تحديث الصفحة أو المحاولة مرة أخرى لاحقًا."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-8 w-8" />}
          title={
            campaigns.length === 0
              ? "لا توجد حملات بعد"
              : "لا توجد نتائج مطابقة"
          }
          description={
            campaigns.length === 0
              ? "لم تُنشأ أي حملات استبيان بعد. يمكنك إنشاء حملة جديدة من تبويب الحملات."
              : "جرّب تعديل عوامل التصفية أو البحث بكلمات مختلفة."
          }
          action={
            campaigns.length === 0 ? (
              <Button
                variant="outline"
                onClick={() => router.push("/?view=admin&tab=campaigns")}
              >
                إنشاء حملة جديدة
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اسم الحملة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>عدد المشاركات</TableHead>
                <TableHead>عدد المسؤولين المشمولين</TableHead>
                <TableHead>تاريخ الإنشاء</TableHead>
                <TableHead className="text-center">الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {c.titleAr}
                      </span>
                      {c.descriptionAr && (
                        <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {c.descriptionAr}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-foreground">
                      {c.counts.responses}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-foreground">
                      {c.counts.executives}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {toRiyadhDate(c.createdAt)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openReport(c.id)}
                      className="min-h-11"
                    >
                      <Eye className="h-4 w-4" />
                      عرض التقرير
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
