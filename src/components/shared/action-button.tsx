"use client";

import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ButtonProps = React.ComponentProps<typeof Button>;

/** Generic confirm-and-mutate button — used for lifecycle actions
 * (activate, close, archive, schedule, copy, delete) on campaigns,
 * questions, executives. */
export function ActionButton({
  label,
  icon,
  loadingLabel,
  confirmMessage,
  mutationFn,
  queryKeyToInvalidate,
  variant = "default",
  size = "default",
  disabled,
  onSuccess,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  loadingLabel?: string;
  confirmMessage?: string;
  mutationFn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>;
  queryKeyToInvalidate?: unknown[];
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  disabled?: boolean;
  onSuccess?: (data: unknown) => void;
  className?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn,
    onMutate: async () => {
      if (confirmMessage && !window.confirm(confirmMessage)) {
        throw new Error("cancelled");
      }
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر تنفيذ العملية",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      if (queryKeyToInvalidate) {
        await qc.invalidateQueries({ queryKey: queryKeyToInvalidate });
      } else {
        await qc.invalidateQueries();
      }
      toast({ title: label, description: "تم تنفيذ العملية بنجاح." });
      onSuccess?.(res.data);
    },
    onError: (err: Error) => {
      if (err.message === "cancelled") return;
      toast({
        title: "تعذّر تنفيذ العملية",
        description: err.message ?? "حدث خطأ غير متوقع.",
        variant: "destructive",
      });
    },
  });

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || mutation.isPending}
      onClick={() => mutation.mutate()}
      className={className}
    >
      {mutation.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
      {!mutation.isPending && icon}
      {mutation.isPending ? (loadingLabel ?? label) : label}
    </Button>
  );
}
