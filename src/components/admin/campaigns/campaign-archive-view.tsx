"use client";

/**
 * Campaign archive view — a read-only grid of archived campaigns.
 *
 * Archived campaigns are fully read-only (spec §7: "Fully read-only;
 * excluded from active-campaign selection"). This view shows them in
 * a card grid (not a table) so they're visually distinct from the
 * active campaigns list. Each card shows:
 *  - Title + status badge
 *  - Activation + closure dates
 *  - Response count + executive count + question count
 *  - A "عرض التقرير" button linking to the campaign report
 *
 * No edit/delete/lifecycle actions — archived campaigns can only be
 * viewed (and their reports exported).
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Archive,
  Eye,
  FolderKanban,
  Users,
  Library,
  MessageSquareText,
  CalendarClock,
  ArrowRight,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toRiyadhDate } from "@/lib/time";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Envelope<T> = { ok: boolean; data: T };

type ArchivedCampaign = {
  id: string;
  titleAr: string;
  descriptionAr: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    executives: number;
    questions: number;
    responses: number;
    participationLedger: number;
    questionSnapshots: number;
  };
};

export function CampaignArchiveView() {
  const router = useRouter();

  const { data, isLoading, isError } = useQuery<Envelope<ArchivedCampaign[]>>({
    queryKey: ["admin-campaigns"],
    queryFn: () => fetchJson<Envelope<ArchivedCampaign[]>>("/api/admin/campaigns"),
  });

  const allCampaigns = data?.data ?? [];
  const archivedCampaigns = allCampaigns.filter((c) => c.status === "archived");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="أرشيف الحملات"
        description="الحملات المؤرشفة — للقراءة فقط. يمكن عرض التقارير ولكن لا يمكن تعديلها أو إعادة تفعيلها."
        eyebrow="سجل تاريخي"
        actions={
          <Button
            variant="ghost"
            onClick={() => router.push("/?view=admin&tab=campaigns")}
            className="min-h-11"
          >
            <ArrowRight className="h-4 w-4" />
            عودة للحملات
          </Button>
        }
      />

      {isError ? (
        <EmptyState
          icon={<Archive className="h-10 w-10" />}
          title="تعذّر تحميل الأرشيف"
          description="حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقًا."
        />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : archivedCampaigns.length === 0 ? (
        <EmptyState
          icon={<Archive className="h-10 w-10" />}
          title="لا توجد حملات مؤرشفة"
          description="عندما تُؤرشَف حملة، ستظهر هنا تلقائيًا كجزء من السجل التاريخي. الحملات المؤرشفة للقراءة فقط — يمكن عرض تقاريرها ولكن لا يمكن تعديلها."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {archivedCampaigns.map((c) => (
            <Card
              key={c.id}
              className="flex flex-col transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
            >
              <CardHeader className="gap-2 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(c.id)}`
                      )
                    }
                    className="text-base font-semibold text-foreground hover:underline text-start line-clamp-2"
                  >
                    {c.titleAr}
                  </button>
                  <StatusBadge status={c.status} />
                </div>
                {c.descriptionAr && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {c.descriptionAr}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                {/* Date row */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>تفعيل: {c.activatedAt ? toRiyadhDate(c.activatedAt) : "—"}</span>
                  </span>
                  <span className="text-border">·</span>
                  <span>إغلاق: {c.closedAt ? toRiyadhDate(c.closedAt) : "—"}</span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2">
                  <StatChip
                    icon={<MessageSquareText className="h-3.5 w-3.5" />}
                    value={c.counts.responses}
                    label="إجابة"
                  />
                  <StatChip
                    icon={<Users className="h-3.5 w-3.5" />}
                    value={c.counts.executives}
                    label="مسؤول"
                  />
                  <StatChip
                    icon={<Library className="h-3.5 w-3.5" />}
                    value={c.counts.questions}
                    label="سؤال"
                  />
                </div>

                {/* Action */}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto w-full min-h-10"
                  onClick={() =>
                    router.push(
                      `/?view=admin&tab=reports&sub=campaign&id=${encodeURIComponent(c.id)}`
                    )
                  }
                >
                  <Eye className="h-4 w-4" />
                  عرض التقرير
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatChip({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-2 py-1.5 text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
      </div>
      <p
        className="mt-0.5 text-sm font-bold text-foreground tabular-nums"
        style={{ fontFeatureSettings: '"tnum" 1' }}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
