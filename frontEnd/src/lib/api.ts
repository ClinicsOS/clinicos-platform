import axios from "axios";
import { useAuth } from "@/store/auth";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api",
});

api.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Global 401 handler — if the server tells us the token is invalid or expired,
 * clear the auth state and send the user back to the sign-in page.  We flag the
 * redirect with a query param so the sign-in page can show a helpful message.
 */
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      // Don't fire this on the initial sign-in POST (wrong credentials is expected 401)
      !error.config?.url?.includes("/auth/login")
    ) {
      const { token, logout } = useAuth.getState();
      if (token) {
        logout();
        // Small delay to let React unmount authenticated components cleanly
        window.setTimeout(() => {
          if (typeof window !== "undefined" && !window.location.pathname.startsWith("/signin")) {
            window.location.replace("/signin?expired=1");
          }
        }, 50);
      }
    }
    return Promise.reject(error);
  }
);

export const errMsg = (e: unknown, fallback: string) => {
  if (axios.isAxiosError(e)) return (e.response?.data as { message?: string })?.message || fallback;
  return fallback;
};
