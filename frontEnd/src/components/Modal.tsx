"use client";
import { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          <button onClick={onClose} className="text-mute hover:text-ink" aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
