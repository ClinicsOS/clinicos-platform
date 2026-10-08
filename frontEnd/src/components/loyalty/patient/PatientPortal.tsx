"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a sheet in the app column itself (`.pw-col`), OUTSIDE the screen stack: the screens recede (scale / blur) while a sheet is open, and a
 * sheet that lived inside them would recede with them.
 */
export default function PatientPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    setHost(document.querySelector(".pw-col") ?? document.body);
  }, []);
  return host ? createPortal(children, host) : null;
}
