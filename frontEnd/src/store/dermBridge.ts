import { create } from "zustand";

/**
 * A tiny in-memory bridge between the Patient Profile tabs (Treatment Plan / History -> Clinical Map): "View on map" (from a
 * treatment or follow-up) opens the SAME 3D engine on exactly those regions. Nothing here is persisted and nothing is
 * clinical data: it only carries a UI intent between two screens. `nonce` makes the same request repeatable
 * (focusing the same regions twice still triggers again).
 */
export interface FocusRequest { patientId: string; regionIds: string[]; nonce: number }

interface BridgeState {
  focus: FocusRequest | null;
  requestFocus: (patientId: string, regionIds: string[]) => void;
  clearFocus: () => void;
}
let n = 0;
export const useDermBridge = create<BridgeState>()((set) => ({
  focus: null,
  requestFocus: (patientId, regionIds) => set({ focus: { patientId, regionIds: Array.from(new Set(regionIds)), nonce: ++n } }),
  clearFocus: () => set({ focus: null }),
}));
