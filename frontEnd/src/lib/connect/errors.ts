// CLINICOS CONNECT (C2) — what went wrong, in the few categories the UI treats differently. Never reads or echoes message text.
export type ConnectErrorKind = "plan" | "suspended" | "forbidden" | "gone" | "validation" | "rate" | "inactive" | "network" | "server";

interface MaybeAxios {
  isAxiosError?: boolean;
  response?: { status?: number; data?: { code?: string } };
}

export function classifyError(e: unknown): { kind: ConnectErrorKind; status: number; code?: string } {
  const err = (e ?? {}) as MaybeAxios;
  if (!err.isAxiosError) return { kind: "network", status: 0 };
  const status = err.response?.status ?? 0;
  const code = err.response?.data?.code;
  if (status === 0) return { kind: "network", status, code };
  if (status === 402) return { kind: code === "PLAN_LIMIT" ? "plan" : "suspended", status, code };
  if (status === 403) return { kind: "forbidden", status, code };
  if (status === 404) return { kind: "gone", status, code };
  if (status === 409 && code === "PARTICIPANT_INACTIVE") return { kind: "inactive", status, code };
  if (status === 429) return { kind: "rate", status, code };
  if (status >= 400 && status < 500) return { kind: "validation", status, code };
  return { kind: "server", status, code };
}

/** A request that got no answer at all: the server may or may not have processed it. */
export const isUncertain = (e: unknown): boolean => classifyError(e).kind === "network" || classifyError(e).kind === "server";
