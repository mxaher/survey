"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, ShieldCheck, UserMinus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { toRiyadhDisplay } from "@/lib/time";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function mutationFetch<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; error?: string; data?: T }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type Envelope<T> = { ok: boolean; data: T };

type AdminUser = {
  id: string;
  externalId: string;
  displayName: string | null;
  email: string | null;
  role: "SUPER_ADMIN" | "SURVEY_ADMIN";
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
};

const ROLE_LABEL: Record<AdminUser["role"], string> = {
  SUPER_ADMIN: "مدير عام",
  SURVEY_ADMIN: "مدير استبيان",
};

/** Avatar color palette — deterministic based on the user's display name
 * hash so the same user always gets the same color. */
const AVATAR_COLORS = [
  "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[1][0] ?? "");
}

export function UsersView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const query = useQuery<Envelope<{ users: AdminUser[] }>>({
    queryKey: ["admin-users"],
    queryFn: () => fetchJson<Envelope<{ users: AdminUser[] }>>("/api/admin/users"),
  });

  const users = query.data?.data.users ?? [];

  const createMutation = useMutation({
    mutationFn: (input: {
      externalId: string;
      displayName?: string;
      email?: string;
      role: AdminUser["role"];
    }) =>
      mutationFetch<AdminUser>(`/api/admin/users`, "POST", input),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر إضافة المستخدم",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({
        title: "تمت الإضافة",
        description: "تم إنشاء حساب الإدارة بنجاح.",
      });
      setAddOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر إضافة المستخدم",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<{
        displayName: string | null;
        email: string | null;
        role: AdminUser["role"];
        isActive: boolean;
      }>;
    }) => mutationFetch<AdminUser>(`/api/admin/users/${id}`, "PATCH", body),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر تحديث المستخدم",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "تم التحديث", description: "تم تحديث بيانات المستخدم." });
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر تحديث المستخدم",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      mutationFetch<{ id: string; isActive: boolean }>(
        `/api/admin/users/${id}`,
        "DELETE"
      ),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر تعطيل المستخدم",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "تم التعطيل", description: "تم تعطيل الحساب بنجاح." });
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر تعطيل المستخدم",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="مستخدمو الإدارة"
        description="إدارة حسابات المسؤولين وأدوارهم (المدير العام / مدير الاستبيان)."
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="min-h-11">
                <Plus className="h-4 w-4" />
                إضافة مستخدم
              </Button>
            </DialogTrigger>
            <DialogContent>
              <AddUserForm
                pending={createMutation.isPending}
                onSubmit={(input) => createMutation.mutate(input)}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="تعذّر تحميل المستخدمين"
          description="ربما لا تملك صلاحية الوصول إلى هذه الصفحة. حدث خطأ غير متوقع."
        />
      ) : users.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="لا يوجد مستخدمو إدارة"
          description="ابدأ بإضافة أول مدير للنظام."
          action={
            <Button onClick={() => setAddOpen(true)} className="min-h-11">
              <Plus className="h-4 w-4" />
              إضافة مستخدم
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المستخدم</TableHead>
                <TableHead>المعرّف الخارجي</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>آخر نشاط</TableHead>
                <TableHead>أُنشئ في</TableHead>
                <TableHead className="text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  patchPending={patchMutation.isPending}
                  deactivatePending={deactivateMutation.isPending}
                  onEdit={(body) =>
                    patchMutation.mutate({ id: u.id, body })
                  }
                  onDeactivate={() => deactivateMutation.mutate(u.id)}
                  onPromote={() =>
                    patchMutation.mutate({
                      id: u.id,
                      body: { role: "SUPER_ADMIN" },
                    })
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  patchPending,
  deactivatePending,
  onEdit,
  onDeactivate,
  onPromote,
}: {
  user: AdminUser;
  patchPending: boolean;
  deactivatePending: boolean;
  onEdit: (body: Partial<AdminUser>) => void;
  onDeactivate: () => void;
  onPromote: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <TableRow className="transition-colors hover:bg-muted/40">
      <TableCell>
        <div className="flex items-center gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${avatarColor(
              user.displayName ?? user.externalId
            )}`}
            aria-hidden
          >
            {avatarInitials(user.displayName ?? user.externalId)}
          </span>
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-foreground truncate">
              {user.displayName ?? "—"}
            </span>
            {user.email && (
              <span className="text-xs text-muted-foreground truncate">
                {user.email}
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <code className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
          {user.externalId}
        </code>
      </TableCell>
      <TableCell>
        {user.role === "SUPER_ADMIN" ? (
          <Badge variant="default" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            {ROLE_LABEL.SUPER_ADMIN}
          </Badge>
        ) : (
          <Badge variant="secondary">{ROLE_LABEL.SURVEY_ADMIN}</Badge>
        )}
      </TableCell>
      <TableCell>
        {user.isActive ? (
          <Badge
            variant="outline"
            className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300"
          >
            نشط
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300"
          >
            معطَّل
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {user.lastLoginAt ? (
          <span
            className="tabular-nums"
            style={{ fontFeatureSettings: '"tnum" 1' }}
          >
            {toRiyadhDisplay(user.lastLoginAt)}
          </span>
        ) : (
          <span className="text-xs">لم يسجّل بعد</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {toRiyadhDisplay(user.createdAt)}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-2">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label="تعديل"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <EditUserForm
                user={user}
                pending={patchPending}
                onSubmit={(body) => {
                  onEdit(body);
                  setEditOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>

          {user.role === "SURVEY_ADMIN" && (
            <ActionButton
              label="ترقية"
              icon={<ShieldCheck className="h-4 w-4" />}
              loadingLabel="جارٍ الترقية…"
              variant="outline"
              size="icon"
              confirmMessage={`سيتم منح «${user.displayName ?? user.externalId}» صلاحية مدير عام. متابعة؟`}
              mutationFn={async () => {
                onPromote();
                return { ok: true };
              }}
              queryKeyToInvalidate={["admin-users"]}
              disabled={patchPending}
            />
          )}

          <ActionButton
            label="تعطيل"
            icon={<UserMinus className="h-4 w-4" />}
            loadingLabel="جارٍ التعطيل…"
            variant="destructive"
            size="icon"
            confirmMessage={`هل أنت متأكد من تعطيل حساب «${user.displayName ?? user.externalId}»؟`}
            mutationFn={async () => {
              onDeactivate();
              return { ok: true };
            }}
            queryKeyToInvalidate={["admin-users"]}
            disabled={deactivatePending || !user.isActive}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function AddUserForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (input: {
    externalId: string;
    displayName?: string;
    email?: string;
    role: AdminUser["role"];
  }) => void;
}) {
  const [externalId, setExternalId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("SURVEY_ADMIN");

  const submit = () => {
    if (!externalId.trim()) return;
    onSubmit({
      externalId: externalId.trim(),
      displayName: displayName.trim() || undefined,
      email: email.trim() || undefined,
      role,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>إضافة مستخدم إدارة</DialogTitle>
        <DialogDescription>
          أنشئ حسابًا جديدًا للوصول إلى لوحة الإدارة. سيُسجَّل الإجراء في سجل العمليات.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="au-external">المعرّف الخارجي (إلزامي)</Label>
          <Input
            id="au-external"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder="مثال: ahmad.ali"
            className="min-h-11"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="au-name">الاسم المعروض</Label>
          <Input
            id="au-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="مثال: أحمد علي"
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="au-email">البريد الإلكتروني</Label>
          <Input
            id="au-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="min-h-11"
            dir="ltr"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="au-role">الدور</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as AdminUser["role"])}
            dir="rtl"
          >
            <SelectTrigger id="au-role" className="min-h-11 w-full">
              <SelectValue placeholder="اختر الدور" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SURVEY_ADMIN">مدير استبيان</SelectItem>
              <SelectItem value="SUPER_ADMIN">مدير عام</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={pending || !externalId.trim()} className="min-h-11">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          إضافة
        </Button>
      </DialogFooter>
    </>
  );
}

function EditUserForm({
  user,
  pending,
  onSubmit,
}: {
  user: AdminUser;
  pending: boolean;
  onSubmit: (body: Partial<AdminUser>) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [role, setRole] = useState<AdminUser["role"]>(user.role);

  const dirty =
    displayName.trim() !== (user.displayName ?? "") ||
    email.trim() !== (user.email ?? "") ||
    role !== user.role;

  return (
    <>
      <DialogHeader>
        <DialogTitle>تعديل المستخدم</DialogTitle>
        <DialogDescription>
          تعديل بيانات «{user.displayName ?? user.externalId}».
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="eu-name">الاسم المعروض</Label>
          <Input
            id="eu-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="eu-email">البريد الإلكتروني</Label>
          <Input
            id="eu-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11"
            dir="ltr"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="eu-role">الدور</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as AdminUser["role"])}
            dir="rtl"
          >
            <SelectTrigger id="eu-role" className="min-h-11 w-full">
              <SelectValue placeholder="اختر الدور" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SURVEY_ADMIN">مدير استبيان</SelectItem>
              <SelectItem value="SUPER_ADMIN">مدير عام</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() =>
            onSubmit({
              displayName: displayName.trim() || null,
              email: email.trim() || null,
              role,
            })
          }
          disabled={pending || !dirty}
          className="min-h-11"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Pencil className="h-4 w-4" />
          )}
          حفظ التعديلات
        </Button>
      </DialogFooter>
    </>
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
