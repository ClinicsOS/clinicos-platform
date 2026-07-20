import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified?: boolean;
}
interface AuthClinic { id: string; name: string; slug: string; }
interface AuthState {
  token: string | null;
  user: AuthUser | null;
  clinic: AuthClinic | null;
  setAuth: (t: string, u: AuthUser, c?: AuthClinic) => void;
  patchUser: (fields: Partial<AuthUser>) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      clinic: null,
      setAuth: (token, user, clinic) => set({ token, user, clinic: clinic ?? null }),
      patchUser: (fields) =>
        set((s) => ({ user: s.user ? { ...s.user, ...fields } : null })),
      logout: () => set({ token: null, user: null, clinic: null }),
    }),
    { name: "clinicos-auth" }
  )
);
