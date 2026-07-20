"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { IconCheck, IconAlertTriangle, IconX, IconInfoCircle } from "@tabler/icons-react";

export type ToastKind = "success" | "error" | "warning" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastContextValue {
  show: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, title, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (t, m) => show("success", t, m),
    error: (t, m) => show("error", t, m),
    warning: (t, m) => show("warning", t, m),
    info: (t, m) => show("info", t, m),
  };

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* Toast stack — fixed bottom-right (LTR) / bottom-left (RTL follows page dir) */}
      <div
        className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const config = {
    success: {
      icon: <IconCheck size={16} />,
      accent: "bg-teal text-navy",
      border: "border-teal/40",
    },
    error: {
      icon: <IconX size={16} />,
      accent: "bg-red-500 text-white",
      border: "border-red-500/40",
    },
    warning: {
      icon: <IconAlertTriangle size={16} />,
      accent: "bg-amber-500 text-navy",
      border: "border-amber-500/40",
    },
    info: {
      icon: <IconInfoCircle size={16} />,
      accent: "bg-blue text-white",
      border: "border-blue/40",
    },
  }[toast.kind];

  return (
    <div
      className={`toast-in pointer-events-auto flex items-start gap-3 rounded-xl border ${config.border} bg-card p-3 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${config.accent}`}
      >
        {config.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink">{toast.title}</div>
        {toast.message && (
          <div className="mt-0.5 text-[10px] leading-relaxed text-mute">{toast.message}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-mute hover:text-ink"
        aria-label="Dismiss"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
