"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronLeft,
  Filter,
  ScrollText,
  Search,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toRiyadhDisplay } from "@/lib/time";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Envelope<T> = { ok: boolean; data: T };

type CampaignSummary = {
  id: string;
  titleAr: string;
  status: string;
};

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  campaignId: string | null;
  metadata: unknown;
  createdAt: string;
  adminUser: {
    id: string;
    displayName: string;
    externalId: string;
    role: string;
  } | null;
};

type AuditData = {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const ENTITY_TYPES: Array<{ value: string; labelAr: string }> = [
  { value: "all", labelAr: "كل الأنواع" },
  { value: "campaign", labelAr: "حملة" },
  { value: "campaign_question", labelAr: "سؤال الحملة" },
  { value: "campaign_executive", labelAr: "مسؤول الحملة" },
  { value: "question", labelAr: "سؤال" },
  { value: "executive", labelAr: "مسؤول" },
  { value: "system_setting", labelAr: "إعداد" },
  { value: "admin_user", labelAr: "مستخدم إدارة" },
  { value: "campaign_question.reorder", labelAr: "إعادة ترتيب أسئلة" },
  { value: "campaign_executive.reorder", labelAr: "إعادة ترتيب مسؤولين" },
];

const PAGE_SIZE = 25;

export function AuditView() {
  const [campaignId, setCampaignIdRaw] = useState<string>("all");
  const [action, setActionRaw] = useState<string>("");
  const [entityType, setEntityTypeRaw] = useState<string>("all");
  const [page, setPage] = useState<number>(1);

  // Wrap each setter to also reset to page 1 — avoids setState-in-effect.
  const setCampaignId = (v: string) => {
    setCampaignIdRaw(v);
    setPage(1);
  };
  const setAction = (v: string) => {
    setActionRaw(v);
    setPage(1);
  };
  const setEntityType = (v: string) => {
    setEntityTypeRaw(v);
    setPage(1);
  };

  const campaignsQuery = useQuery<Envelope<CampaignSummary[]>>({
    queryKey: ["admin-campaigns"],
    queryFn: () =>
      fetchJson<Envelope<CampaignSummary[]>>("/api/admin/campaigns"),
  });
  const campaigns = campaignsQuery.data?.data ?? [];

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (campaignId !== "all") p.set("campaignId", campaignId);
    if (action.trim()) p.set("action", action.trim());
    if (entityType !== "all") p.set("entityType", entityType);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [campaignId, action, entityType, page]);

  const auditQuery = useQuery<Envelope<AuditData>>({
    queryKey: ["admin-audit", queryParams],
    queryFn: () =>
      fetchJson<Envelope<AuditData>>(`/api/admin/audit?${queryParams}`),
  });

  const data = auditQuery.data?.data;
  const isLoading = auditQuery.isLoading;
  const isError = auditQuery.isError;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="سجل العمليات"
        description="تتبّع كل عمليات الإدارة على الحملات والأسئلة والمسؤولين والإعدادات."
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">الحملة</label>
          <Select
            value={campaignId}
            onValueChange={setCampaignId}
            dir="rtl"
          >
            <SelectTrigger className="w-full lg:w-64" aria-label="تصفية حسب الحملة">
              <SelectValue placeholder="كل الحملات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحملات</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.titleAr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">الإجراء</label>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="مثال: campaign.create"
            className="w-full lg:w-56"
            aria-label="تصفية بالإجراء"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">النوع</label>
          <Select
            value={entityType}
            onValueChange={setEntityType}
            dir="rtl"
          >
            <SelectTrigger className="w-full lg:w-56" aria-label="تصفية حسب النوع">
              <SelectValue placeholder="كل الأنواع" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.labelAr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="min-h-11 lg:ms-auto"
          onClick={() => {
            setCampaignId("all");
            setAction("");
            setEntityType("all");
            setPage(1);
          }}
        >
          <Filter className="h-4 w-4" />
          إعادة ضبط
        </Button>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8" />}
          title="تعذّر تحميل السجل"
          description="حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى."
        />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="لا توجد عمليات مسجَّلة"
          description="لم يتم العثور على أي عمليات مطابقة لعوامل التصفية الحالية."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>المستخدم</TableHead>
                <TableHead>الإجراء</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المعرّف</TableHead>
                <TableHead>الحملة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {toRiyadhDisplay(it.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-foreground">
                      {it.adminUser?.displayName ?? "—"}
                    </span>
                    {it.adminUser && (
                      <span className="ms-1 text-xs text-muted-foreground">
                        ({it.adminUser.role === "SUPER_ADMIN" ? "مدير عام" : "مدير استبيان"})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                      {it.action}
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {it.entityType}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {it.entityId ? (
                      <span className="font-mono text-xs">
                        {it.entityId.slice(0, 8)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {it.campaignId ? (
                      <span className="font-mono text-xs">
                        {it.campaignId.slice(0, 8)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // Build a list of page numbers to render (window of 5 around current).
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-border p-3 sm:flex-row">
      <p className="text-xs text-muted-foreground">
        عرض {from}–{to} من إجمالي {total} عملية
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="min-h-11 min-w-11"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="الصفحة السابقة"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {pages.map((p) => (
          <Button
            key={p}
            variant={p === page ? "default" : "outline"}
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </Button>
        ))}
        <Button
          variant="outline"
          size="icon"
          className="min-h-11 min-w-11"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="الصفحة التالية"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
