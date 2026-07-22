import axios from "axios";
import { useAdminAuth } from "./adminAuth";

/**
 * Dedicated axios instance for admin endpoints.  We use a separate instance
 * (instead of the clinic-facing `api`) so:
 *   1. The two tokens never leak into each other's requests
 *   2. Admin-specific interceptors (like the auto-redirect to /admin/login on
 *      401) don't fire on clinic requests
 */
export const adminApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api",
});

adminApi.interceptors.request.use((config) => {
  const token = useAdminAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

adminApi.interceptors.response.use(
  (r) => r,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !error.config?.url?.includes("/admin/auth/login")
    ) {
      const { token, logout } = useAdminAuth.getState();
      if (token) {
        logout();
        window.setTimeout(() => {
          if (
            typeof window !== "undefined" &&
            !window.location.pathname.startsWith("/admin/login")
          ) {
            window.location.replace("/admin/login?expired=1");
          }
        }, 50);
      }
    }
    return Promise.reject(error);
  },
);

export const adminErrMsg = (e: unknown, fallback: string): string => {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message || fallback;
  }
  return fallback;
};
