import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Patient } from "@/lib/types";

interface SelState {
  selected: Patient | null;
  select: (p: Patient) => void;
}
export const useSelectedPatient = create<SelState>()(
  persist(
    (set) => ({ selected: null, select: (p) => set({ selected: p }) }),
    { name: "clinicos-selected-patient", storage: createJSONStorage(() => sessionStorage) }
  )
);
