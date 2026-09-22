"use client";

/**
 * Cmd+K / Ctrl+K global command palette.
 *
 * Opens a Dialog with a search input. Searches across:
 *  - Navigation items (dashboard, campaigns, questions, executives, reports, audit, settings, users)
 *  - Campaigns (by title/description) → navigates to detail
 *  - Questions (by text/code) → navigates to questions list
 *  - Executives (by name/title/department) → navigates to executives list
 *
 * Keyboard:
 *  - Cmd+K / Ctrl+K: open/close
 *  - Escape: close
 *  - ↑/↓: navigate results
 *  - Enter: select + navigate
 *
 * The palette is rendered inside the admin shell. It's a client-only
 * component (uses window event listeners + Dialog state).
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  FolderKanban,
  Library,
  Users,
  LayoutDashboard,
  BarChart3,
  ScrollText,
  Settings,
  ShieldCheck,
  ArrowLeft,
  CornerDownLeft,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  { tab: "dashboard", labelAr: "لوحة التحكم", icon: LayoutDashboard, group: "تنقل" },
  { tab: "campaigns", labelAr: "الحملات", icon: FolderKanban, group: "تنقل" },
  { tab: "questions", labelAr: "الأسئلة", icon: Library, group: "تنقل" },
  { tab: "executives", labelAr: "المسؤولون والمديرون", icon: Users, group: "تنقل" },
  { tab: "reports", labelAr: "النتائج / التقارير", icon: BarChart3, group: "تنقل" },
  { tab: "audit", labelAr: "سجل العمليات", icon: ScrollText, group: "تنقل" },
  { tab: "settings", labelAr: "إعدادات النظام", icon: Settings, group: "تنقل" },
  { tab: "users", labelAr: "مستخدمو الإدارة", icon: ShieldCheck, group: "تنقل" },
];

const SECTION_LABELS: Record<string, string> = {
  environment: "بيئة العمل",
  leadership: "تقييم القيادات",
  future: "البيئة المستقبلية",
};

const EXEC_CATEGORY_LABELS: Record<string, string> = {
  ceo: "الرئيس التنفيذي",
  executive: "مسؤول تنفيذي",
  manager: "مدير",
  department_head: "رئيس قسم",
};

interface SearchResult {
  type: "nav" | "campaign" | "question" | "executive";
  id: string;
  titleAr: string;
  subtitleAr?: string;
  badgeAr?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recently-viewed items — persisted to localStorage so they survive
  // page refreshes. Capped at 5 entries. Each entry: { href, titleAr,
  // type, recordedAt }. We read on mount (lazy initializer) and write
  // on every navigation.
  const [recent, setRecent] = useState<SearchResult[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("almrshd-recent");
      return raw ? (JSON.parse(raw) as SearchResult[]) : [];
    } catch {
      return [];
    }
  });

  const recordRecent = (r: SearchResult) => {
    setRecent((prev) => {
      // Dedupe by href, prepend, cap at 5.
      const filtered = prev.filter((x) => x.href !== r.href);
      const next = [r, ...filtered].slice(0, 5);
      try {
        window.localStorage.setItem("almrshd-recent", JSON.stringify(next));
      } catch {
        // localStorage might be full or disabled — non-fatal.
      }
      return next;
    });
  };

  // Open/close toggle — also resets the query + active index when opening.
  const toggleOpen = () => {
    setOpen((prev) => {
      if (!prev) {
        setQuery("");
        setActiveIndex(0);
      }
      return !prev;
    });
  };

  // Global Cmd+K / Ctrl+K listener.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opening.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced search query (min 2 chars).
  const { data, isFetching } = useQuery<{
    ok: boolean;
    data: {
      campaigns: Array<{ id: string; titleAr: string; status: string }>;
      questions: Array<{
        id: string;
        code: string;
        questionAr: string;
        section: string;
      }>;
      executives: Array<{
        id: string;
        nameAr: string;
        titleAr: string;
        category: string;
        departmentAr: string | null;
      }>;
    };
  }>({
    queryKey: ["admin-search", query],
    queryFn: () =>
      fetchJson(`/api/admin/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2 && open,
    staleTime: 10_000,
  });

  // Build the flat results list: nav items (always) + search results (if query ≥ 2 chars).
  const results = useMemo<SearchResult[]>(() => {
    const navResults: SearchResult[] = NAV_ITEMS.filter(
      (n) =>
        query.length < 2 ||
        n.labelAr.includes(query) ||
        n.tab.includes(query.toLowerCase())
    ).map((n) => ({
      type: "nav" as const,
      id: `nav-${n.tab}`,
      titleAr: n.labelAr,
      subtitleAr: n.group,
      href: `/?view=admin&tab=${n.tab}`,
      icon: n.icon,
    }));

    // When the query is empty, show recently-viewed items at the top.
    // Once the user starts typing, hide recents (they'd be redundant
    // with the search results).
    const recentResults: SearchResult[] =
      query.length < 2
        ? recent.map((r, i) => ({
            ...r,
            id: `recent-${i}-${r.id}`,
            subtitleAr: `زيارة سابقة · ${r.subtitleAr ?? r.type}`,
          }))
        : [];

    if (query.length < 2 || !data?.data)
      return [...recentResults, ...navResults];

    const campaignResults: SearchResult[] = data.data.campaigns.map((c) => ({
      type: "campaign" as const,
      id: `campaign-${c.id}`,
      titleAr: c.titleAr,
      subtitleAr: "حملة",
      badgeAr: c.status,
      href: `/?view=admin&tab=campaigns&sub=detail&id=${c.id}`,
      icon: FolderKanban,
    }));

    const questionResults: SearchResult[] = data.data.questions.map((q) => ({
      type: "question" as const,
      id: `question-${q.id}`,
      titleAr: q.questionAr,
      subtitleAr: SECTION_LABELS[q.section] ?? q.section,
      badgeAr: q.code,
      href: `/?view=admin&tab=questions`,
      icon: Library,
    }));

    const executiveResults: SearchResult[] = data.data.executives.map((e) => ({
      type: "executive" as const,
      id: `executive-${e.id}`,
      titleAr: e.nameAr,
      subtitleAr:
        [
          e.titleAr,
          EXEC_CATEGORY_LABELS[e.category],
          e.departmentAr,
        ]
          .filter(Boolean)
          .join(" — ") || undefined,
      href: `/?view=admin&tab=executives`,
      icon: Users,
    }));

    return [...navResults, ...campaignResults, ...questionResults, ...executiveResults];
  }, [query, data, recent]);

  // Clamp active index to valid range when results change — computed at
  // render time (no setState-in-effect).
  const safeActiveIndex =
    results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  // Keyboard navigation.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[safeActiveIndex];
      if (r) {
        router.push(r.href);
        setOpen(false);
      }
    }
  };

  const select = (r: SearchResult) => {
    recordRecent(r);
    router.push(r.href);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">بحث سريع</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في الحملات والأسئلة والمسؤولين... (أو اكتب اسم قسم للتنقل)"
            className="border-0 focus-visible:ring-0 px-0"
          />
          <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto scroll-rtl">
          {results.length === 0 && !isFetching ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              لا توجد نتائج. جرّب كلمات مختلفة.
            </div>
          ) : isFetching ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <ul className="py-2">
              {results.map((r, i) => {
                const Icon = r.icon;
                const active = i === safeActiveIndex;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => select(r)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors ${
                        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {r.titleAr}
                        </p>
                        {r.subtitleAr && (
                          <p className="text-xs text-muted-foreground truncate">
                            {r.subtitleAr}
                          </p>
                        )}
                      </div>
                      {r.badgeAr && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {r.badgeAr}
                        </Badge>
                      )}
                      {active && (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono">↑</kbd>
              <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono">↓</kbd>
              تنقل
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono">↵</kbd>
              اختيار
            </span>
          </div>
          <div className="flex items-center gap-3">
            {recent.length > 0 && query.length < 2 && (
              <button
                type="button"
                onClick={() => {
                  setRecent([]);
                  try {
                    window.localStorage.removeItem("almrshd-recent");
                  } catch {
                    // non-fatal
                  }
                }}
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                مسح السجل
              </button>
            )}
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono">⌘K</kbd>
              فتح/إغلاق
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
