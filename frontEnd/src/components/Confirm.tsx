"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { IconAlertTriangle, IconTrash, IconInfoCircle } from "@tabler/icons-react";

type Variant = "danger" | "warning" | "info";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmCtx = createContext<ConfirmContextValue | null>(null);

interface Pending {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  const answer = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {pending && <ConfirmDialog pending={pending} onAnswer={answer} />}
    </ConfirmCtx.Provider>
  );
}

function ConfirmDialog({
  pending,
  onAnswer,
}: {
  pending: Pending;
  onAnswer: (v: boolean) => void;
}) {
  const { opts } = pending;
  const variant = opts.variant ?? "warning";

  const config = {
    danger: {
      icon: <IconTrash size={22} />,
      iconBg: "bg-red-500/20 text-red-400",
      confirmBtn: "bg-red-500 hover:bg-red-600 text-white",
    },
    warning: {
      icon: <IconAlertTriangle size={22} />,
      iconBg: "bg-amber-500/20 text-amber-400",
      confirmBtn: "bg-amber-500 hover:bg-amber-600 text-navy",
    },
    info: {
      icon: <IconInfoCircle size={22} />,
      iconBg: "bg-blue/20 text-sky",
      confirmBtn: "bg-blue hover:brightness-110 text-white",
    },
  }[variant];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => onAnswer(false)}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-edge bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.iconBg}`}
          >
            {config.icon}
          </span>
          <div className="flex-1 pt-0.5">
            <h3 className="text-sm font-medium text-ink">{opts.title}</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mute">{opts.message}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => onAnswer(false)}
            className="rounded-lg border border-edge bg-card2 px-4 py-2 text-[11px] font-medium text-ink hover:bg-soft"
          >
            {opts.cancelText || "إلغاء"}
          </button>
          <button
            onClick={() => onAnswer(true)}
            className={`rounded-lg px-4 py-2 text-[11px] font-medium ${config.confirmBtn}`}
            autoFocus
          >
            {opts.confirmText || "تأكيد"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
