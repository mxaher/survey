"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, KeyRound, Plus, UserRound, UserX } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
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

type EmployeeUser = {
  id: string;
  email: string;
  displayName: string | null;
  department: string | null;
  isActive: number | boolean;
  banned: number | boolean;
  emailVerified?: number | boolean;
  createdAt: string;
  updatedAt?: string;
};

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[1][0] ?? "");
}

const isActive = (e: EmployeeUser) => Boolean(Number(e.isActive));
const isBanned = (e: EmployeeUser) => Boolean(Number(e.banned));
const isVerified = (e: EmployeeUser) => Boolean(Number(e.emailVerified));

export function EmployeesView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [resetFor, setResetFor] = useState<EmployeeUser | null>(null);

  const query = useQuery<Envelope<{ employees: EmployeeUser[] }>>({
    queryKey: ["admin-employees"],
    queryFn: () => fetchJson<Envelope<{ employees: EmployeeUser[] }>>(
      "/api/admin/employees"
    ),
  });

  const employees = query.data?.data.employees ?? [];

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-employees"] });
  };

  const createMutation = useMutation({
    mutationFn: (input: {
      email: string;
      displayName: string;
      department?: string | null;
      password: string;
    }) => mutationFetch<EmployeeUser>("/api/admin/employees", "POST", input),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر إنشاء الحساب",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await invalidate();
      toast({
        title: "تم إنشاء الحساب",
        description: "يمكن للموظف تسجيل الدخول باستخدام البريد وكلمة المرور.",
      });
      setAddOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر إنشاء الحساب",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      mutationFetch<EmployeeUser>(`/api/admin/employees/${id}`, "PATCH", body),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر التحديث",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await invalidate();
      toast({ title: "تم التحديث", description: "تم تحديث بيانات الموظف." });
      setResetFor(null);
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر التحديث",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      mutationFetch<{ id: string }>(`/api/admin/employees/${id}`, "DELETE"),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر تعطيل الحساب",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await invalidate();
      toast({ title: "تم التعطيل", description: "تم تعطيل حساب الموظف." });
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر تعطيل الحساب",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="حسابات الموظفين"
        description="حسابات الدخول لموظفي الاستبيان — تُنشأ من هنا، أو يسجّل الموظف نفسه ببريد ‎@almarshad.com‎ ويتطلب ذلك تأكيد البريد. تُستخدم الحسابات لتعريف المشارك دون كشف هويته في الردود."
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="min-h-11">
                <Plus className="h-4 w-4" />
                إضافة موظف
              </Button>
            </DialogTrigger>
            <DialogContent>
              <AddEmployeeForm
                pending={createMutation.isPending}
                onSubmit={(input) => createMutation.mutate(input)}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {query.isLoading ? (
        <LoadingSkeleton />
      ) : query.isError ? (
        <EmptyState
          icon={<UserRound className="h-8 w-8" />}
          title="تعذّر تحميل حسابات الموظفين"
          description="ربما لا تملك صلاحية الوصول إلى هذه الصفحة."
        />
      ) : employees.length === 0 ? (
        <EmptyState
          icon={<UserRound className="h-8 w-8" />}
          title="لا توجد حسابات موظفين"
          description="أنشئ حسابات للموظفين من هنا، أو ادعهم للتسجيل عبر بريد ‎@almarshad.com‎ حتى يتمكنوا من تسجيل الدخول والمشاركة في الاستبيان."
          action={
            <Button onClick={() => setAddOpen(true)} className="min-h-11">
              <Plus className="h-4 w-4" />
              إضافة موظف
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>الإدارة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>أُنشئ في</TableHead>
                <TableHead className="text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        {avatarInitials(e.displayName ?? e.email)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {e.displayName ?? e.email}
                        </p>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {e.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.department ?? "—"}
                  </TableCell>
                  <TableCell>
                    {isBanned(e) ? (
                      <Badge variant="destructive">محظور</Badge>
                    ) : !isActive(e) ? (
                      <Badge variant="outline">معطّل</Badge>
                    ) : !isVerified(e) ? (
                      <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        بانتظار تأكيد البريد
                      </Badge>
                    ) : (
                      <Badge variant="secondary">نشط</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {toRiyadhDisplay(e.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => setResetFor(e)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        إعادة تعيين كلمة المرور
                      </Button>
                      {isActive(e) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-xs text-destructive hover:text-destructive"
                          disabled={deactivateMutation.isPending}
                          onClick={() => deactivateMutation.mutate(e.id)}
                        >
                          <UserX className="h-3.5 w-3.5" />
                          تعطيل
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!resetFor} onOpenChange={(open) => !open && setResetFor(null)}>
        <DialogContent>
          {resetFor ? (
            <ResetPasswordForm
              email={resetFor.email}
              pending={patchMutation.isPending}
              onSubmit={(password) =>
                patchMutation.mutate({ id: resetFor.id, body: { password } })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddEmployeeForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (input: {
    email: string;
    displayName: string;
    department?: string | null;
    password: string;
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [department, setDepartment] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          email,
          displayName,
          department: department.trim() || null,
          password,
        });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>إضافة موظف</DialogTitle>
        <DialogDescription>
          أنشئ حساب دخول للموظف. كلمة المرور تُخزّن مشفّرة (PBKDF2) ولا يمكن
          استرجاعها — يمكن إعادة تعيينها لاحقًا من هذه الصفحة.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="emp-name">اسم الموظف</Label>
        <Input
          id="emp-name"
          dir="rtl"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-email">البريد الإلكتروني</Label>
        <Input
          id="emp-email"
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@almarshad.com"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-dept">الإدارة (اختياري)</Label>
        <Input
          id="emp-dept"
          dir="rtl"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="مثال: المقاولات"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emp-password">كلمة المرور</Label>
        <Input
          id="emp-password"
          type="password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          8 أحرف على الأقل.
        </p>
      </div>

      <DialogFooter>
        <Button type="submit" className="min-h-11 gap-2" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          إنشاء الحساب
        </Button>
      </DialogFooter>
    </form>
  );
}

function ResetPasswordForm({
  email,
  pending,
  onSubmit,
}: {
  email: string;
  pending: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>إعادة تعيين كلمة المرور</DialogTitle>
        <DialogDescription>
          سيتم تسجيل الخروج من جميع الجلسات النشطة لهذا الموظف.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="reset-email">الحساب</Label>
        <Input id="reset-email" dir="ltr" value={email} readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reset-password">كلمة المرور الجديدة</Label>
        <Input
          id="reset-password"
          type="password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <DialogFooter>
        <Button type="submit" className="min-h-11 gap-2" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          إعادة التعيين
        </Button>
      </DialogFooter>
    </form>
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
