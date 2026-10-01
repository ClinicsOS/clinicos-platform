import { Request, Response } from "express";

/**
 * Runs an EXISTING (req, res, next) middleware programmatically and reports whether it would have rejected the request,
 * without ever letting it write to the real response. Used so an optional section of a report (e.g. the financial summary)
 * is gated by the very same middleware the real endpoint uses (never a second, drifting permission check).
 */
export function runGate(
  req: Request,
  mw: (req: Request, res: Response, next: (err?: unknown) => void) => unknown
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  return new Promise((resolve) => {
    let settled = false;
    let code = 200;
    const fakeRes = {
      status(c: number) { code = c; return fakeRes; },
      json(body: unknown) { if (!settled) { settled = true; resolve({ ok: false, status: code, body }); } return fakeRes; },
    } as unknown as Response;
    Promise.resolve(mw(req, fakeRes, (err) => { if (!settled) { settled = true; resolve(err ? { ok: false, status: 500, body: { message: "Server error" } } : { ok: true }); } }))
      .catch(() => { if (!settled) { settled = true; resolve({ ok: false, status: 500, body: { message: "Server error" } }); } });
  });
}
