"use client";

/**
 * Admin app shell. Routes between admin tabs based on URL search params.
 *
 * URL contract (used by all admin subagents):
 *   ?view=admin&tab=dashboard                      → dashboard
 *   ?view=admin&tab=campaigns                      → campaigns list
 *   ?view=admin&tab=campaigns&sub=editor&id=xxx    → campaign editor (id=new for create)
 *   ?view=admin&tab=campaigns&sub=detail&id=xxx    → campaign detail (with internal sub-tabs)
 *   ?view=admin&tab=questions                      → questions library
 *   ?view=admin&tab=questions&sub=editor&id=xxx    → question editor (id=new for create)
 *   ?view=admin&tab=executives                     → executives registry
 *   ?view=admin&tab=executives&sub=editor&id=xxx   → executive editor (id=new for create)
 *   ?view=admin&tab=reports                        → reports landing (list of campaigns)
 *   ?view=admin&tab=reports&sub=campaign&id=xxx    → campaign reports overview
 *   ?view=admin&tab=reports&sub=executive&id=xxx&execId=yyy → executive report
 *   ?view=admin&tab=audit                          → audit log
 *   ?view=admin&tab=settings                       → system settings
 *   ?view=admin&tab=users                         → admin users (SUPER_ADMIN only)
 *
 * Each tab is a leaf component `export function <Name>()` at a known path.
 * Loaded with next/dynamic so leaf components can be added/replaced
 * independently of this shell.
 */
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Library,
  Users,
  BarChart3,
  ScrollText,
  Settings,
  ShieldCheck,
  ClipboardList,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Menu } from "lucide-react";

// Lazy-load each tab's content. Paths are the contract for the subagents.
const DashboardView = dynamic(
  () => import("@/components/admin/dashboard/dashboard-view").then((m) => m.DashboardView),
  { ssr: false }
);
const CampaignsListView = dynamic(
  () => import("@/components/admin/campaigns/campaigns-list-view").then((m) => m.CampaignsListView),
  { ssr: false }
);
const CampaignEditorView = dynamic(
  () => import("@/components/admin/campaigns/campaign-editor-view").then((m) => m.CampaignEditorView),
  { ssr: false }
);
const CampaignDetailView = dynamic(
  () => import("@/components/admin/campaign-detail/campaign-detail-view").then((m) => m.CampaignDetailView),
  { ssr: false }
);
const QuestionsListView = dynamic(
  () => import("@/components/admin/questions/questions-list-view").then((m) => m.QuestionsListView),
  { ssr: false }
);
const QuestionEditorView = dynamic(
  () => import("@/components/admin/questions/question-editor-view").then((m) => m.QuestionEditorView),
  { ssr: false }
);
const ExecutivesListView = dynamic(
  () => import("@/components/admin/executives/executives-list-view").then((m) => m.ExecutivesListView),
  { ssr: false }
);
const ExecutiveEditorView = dynamic(
  () => import("@/components/admin/executives/executive-editor-view").then((m) => m.ExecutiveEditorView),
  { ssr: false }
);
const ReportsListView = dynamic(
  () => import("@/components/admin/reports/reports-list-view").then((m) => m.ReportsListView),
  { ssr: false }
);
const CampaignReportView = dynamic(
  () => import("@/components/admin/reports/campaign-report-view").then((m) => m.CampaignReportView),
  { ssr: false }
);
const ExecutiveReportView = dynamic(
  () => import("@/components/admin/reports/executive-report-view").then((m) => m.ExecutiveReportView),
  { ssr: false }
);
const TrendReportView = dynamic(
  () => import("@/components/admin/reports/trend-report-view").then((m) => m.TrendReportView),
  { ssr: false }
);
const AuditView = dynamic(
  () => import("@/components/admin/audit/audit-view").then((m) => m.AuditView),
  { ssr: false }
);
const SettingsView = dynamic(
  () => import("@/components/admin/settings/settings-view").then((m) => m.SettingsView),
  { ssr: false }
);
const UsersView = dynamic(
  () => import("@/components/admin/users/users-view").then((m) => m.UsersView),
  { ssr: false }
);

const NAV = [
  { tab: "dashboard",   labelAr: "لوحة التحكم",            icon: LayoutDashboard },
  { tab: "campaigns",   labelAr: "الحملات",                icon: FolderKanban },
  { tab: "questions",   labelAr: "الأسئلة",                icon: Library },
  { tab: "executives",  labelAr: "المسؤولون والمديرون",     icon: Users },
  { tab: "reports",     labelAr: "النتائج / التقارير",      icon: BarChart3 },
  { tab: "audit",       labelAr: "سجل العمليات",            icon: ScrollText },
  { tab: "settings",    labelAr: "إعدادات النظام",          icon: Settings },
  { tab: "users",       labelAr: "مستخدمو الإدارة",          icon: ShieldCheck, superAdminOnly: true },
] as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function AdminApp() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") ?? "dashboard";

  const { data: admin } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () =>
      fetchJson<{ ok: boolean; data: { adminId: string; externalId: string; displayName?: string; role: string } | null }>(
        "/api/admin/me"
      ),
  });

  const isSuperAdmin = admin?.data?.role === "SUPER_ADMIN";

  const [mobileOpen, setMobileOpen] = useState(false);

  // If ?tab=users but not SUPER_ADMIN, redirect to dashboard.
  useEffect(() => {
    if (admin && tab === "users" && !isSuperAdmin) {
      const q = new URLSearchParams(sp.toString());
      q.set("tab", "dashboard");
      router.replace(`/?view=admin&${q.toString()}`);
    }
  }, [admin, isSuperAdmin, tab, router, sp]);

  const sub = sp.get("sub");
  const id = sp.get("id");
  const execId = sp.get("execId");

  let content: React.ReactNode;
  switch (tab) {
    case "campaigns":
      if (sub === "editor" && id) content = <CampaignEditorView campaignId={id} />;
      else if (sub === "detail" && id) content = <CampaignDetailView campaignId={id} />;
      else content = <CampaignsListView />;
      break;
    case "questions":
      if (sub === "editor" && id) content = <QuestionEditorView questionId={id} />;
      else content = <QuestionsListView />;
      break;
    case "executives":
      if (sub === "editor" && id) content = <ExecutiveEditorView executiveId={id} />;
      else content = <ExecutivesListView />;
      break;
    case "reports":
      if (sub === "campaign" && id) content = <CampaignReportView campaignId={id} />;
      else if (sub === "executive" && id && execId) content = <ExecutiveReportView campaignId={id} executiveId={execId} />;
      else if (sub === "trend") content = <TrendReportView />;
      else content = <ReportsListView />;
      break;
    case "audit":      content = <AuditView />; break;
    case "settings":   content = <SettingsView />; break;
    case "users":
      content = isSuperAdmin ? <UsersView /> : null;
      break;
    case "dashboard":
    default:
      content = <DashboardView />;
  }

  const navItems = NAV.filter(
    (n) => !("superAdminOnly" in n && n.superAdminOnly) || isSuperAdmin
  );

  const navList = (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map((n) => {
        const Icon = n.icon;
        const active = tab === n.tab;
        return (
          <button
            key={n.tab}
            onClick={() => {
              setMobileOpen(false);
              router.push(`/?view=admin&tab=${n.tab}`);
            }}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{n.labelAr}</span>
          </button>
        );
      })}
    </nav>
  );

  const header = (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 p-0">
            <div className="flex h-14 items-center gap-2 border-b border-border px-4">
              <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold text-sm">
                الم
              </div>
              <p className="text-sm font-semibold">لوحة تحكم الاستبيان</p>
            </div>
            {navList}
          </SheetContent>
        </Sheet>

        <div className="hidden md:flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold text-sm">
            الم
          </div>
          <p className="text-sm font-semibold">لوحة تحكم استبيان المرشد</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <a
          href="/?view=employee"
          className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          عرض تجربة الموظف
        </a>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            window.location.href = "/?view=employee";
          }}
        >
          <LogOut className="h-4 w-4 ml-1" />
          خروج
        </Button>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {header}
      <div className="flex flex-1 mx-auto w-full max-w-7xl">
        <aside className="hidden md:block w-60 shrink-0 border-l border-border bg-sidebar">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto scroll-rtl">
            {navList}
          </div>
        </aside>
        <main
          key={`${tab}-${sub ?? ""}-${id ?? ""}`}
          className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 animate-in fade-in-50 duration-200"
        >
          {content}
        </main>
      </div>
      <footer className="border-t border-border bg-card mt-auto">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-muted-foreground text-center">
          © مجموعة المرشد — منصة الاستبيان المجهول
        </div>
      </footer>
    </div>
  );
}
