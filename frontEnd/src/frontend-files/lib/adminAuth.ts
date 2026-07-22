import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminUser {
  email: string;
}

interface AdminAuthState {
  token: string | null;
  admin: AdminUser | null;
  setAuth: (token: string, admin: AdminUser) => void;
  logout: () => void;
}

/**
 * Deliberately separate from the clinic auth store so we can never
 * accidentally use one token for the other.  Key name is also distinct
 * so the two sessions can coexist in the same browser.
 */
export const useAdminAuth = create<AdminAuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      setAuth: (token, admin) => set({ token, admin }),
      logout: () => set({ token: null, admin: null }),
    }),
    { name: "clinicos-admin-auth" }
  )
);
