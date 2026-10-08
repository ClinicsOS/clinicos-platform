"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCircleCheck, IconClockHour4, IconGift, IconRefresh } from "@tabler/icons-react";
import { fmtNum, pointsWord, useLT } from "@/lib/loyalty";
import { fetchRewards, publicError, requestReward, type PublicRewardsState } from "@/lib/loyaltyPublic";

/**
 * Rewards on the patient's Loyalty page (Phase 6) — TEMPORARY and minimal: just enough to ask for a reward through the
 * current phone-based session. The final patient experience is designed in a later phase.
 *
 *  • Asking for a reward creates a PENDING request. It NEVER deducts points — reception confirms at the desk, and only
 *    then does the server deduct (through the central ledger).
 *  • Everything shown (cost, "can I ask?", missing points, request status) comes from the server.
 *  • Renders nothing when the clinic has no rewards on offer and the member has no requests.
 */

type Problem = "rate" | "limit" | "unavailable" | "insufficient" | "busy" | "network" | null;
const POLL_MS = 8000;

export default function PatientRewards({ slug, token, onExpired, onChanged }: { slug: string; token: string; onExpired: () => void; onChanged: () => void }) {
  const { t, lang, date } = useLT();
  const [state, setState] = useState<PublicRewardsState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string | null; why: Problem }>({ id: null, why: null });
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  const last = useRef<string>("");

  const refresh = useCallback(async () => {
    try {
      const s = await fetchRewards(slug, token);
      if (!alive.current) return;
      setState(s);
      // a request was answered (or the balance moved) → let the page refresh the card balance
      const sig = `${s.balance}|${s.requests.map((r) => r.key + r.status).join(",")}`;
      if (last.current && last.current !== sig) onChanged();
      last.current = sig;
    } catch (e) {
      const er = publicError(e);
      if (er.status === 401) onExpired();
      else if (er.status === 429) setProblem({ id: null, why: "rate" });
    }
  }, [slug, token, onExpired, onChanged]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const waiting = !!state?.requests.some((r) => r.status === "pending");
  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [waiting, refresh]);

  const ask = async (id: string, name: string) => {
    if (busyId) return;
    setBusyId(id);
    setProblem({ id: null, why: null });
    setNotice(null);
    try {
      const r = await requestReward(slug, token, id);
      setNotice(r.state === "created" ? t(`Request sent for “${name}”. No points are deducted until reception confirms.`, `تم إرسال طلب «${name}». لا تُخصم النقاط حتى يؤكد الاستقبال.`) : t("You already have a request for this reward.", "لديك طلب لهذه الجائزة بالفعل."));
      await refresh();
    } catch (e) {
      const er = publicError(e);
      if (er.status === 401) onExpired();
      else {
        const why: Problem = er.code === "INSUFFICIENT_BALANCE" ? "insufficient" : er.code === "REWARD_UNAVAILABLE" || er.code === "REWARD_NOT_FOUND" ? "unavailable" : er.code === "REDEMPTION_LIMIT" ? "limit" : er.code === "REDEMPTION_QUEUE_FULL" ? "busy" : er.status === 429 ? "rate" : "network";
        setProblem({ id, why });
        if (why === "insufficient" || why === "unavailable") refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (!state || (state.rewards.length === 0 && state.requests.length === 0)) return null;
  const statusText = (s: string) => (s === "pending" ? t("Waiting for reception", "بانتظار الاستقبال") : s === "confirmed" ? t("Redeemed", "تم الصرف") : s === "rejected" ? t("Not approved", "لم تتم الموافقة") : t("Cancelled by clinic", "ألغتها العيادة"));

  return (
    <section className="pr-wrap pl-rise" style={{ animationDelay: "0.65s" }} aria-label={t("Rewards", "الجوائز")} data-testid="pr-section">
      <style dangerouslySetInnerHTML={{ __html: PR_CSS }} />
      <h2 className="pr-title">
        <IconGift size={16} aria-hidden="true" /> {t("Rewards", "الجوائز")}
      </h2>

      {notice && (
        <p className="pr-notice pl-pop" role="status" data-testid="pr-notice">
          <IconCircleCheck size={15} aria-hidden="true" /> {notice}
        </p>
      )}

      <ul className="pr-list">
        {state.rewards.map((r) => {
          const pct = Math.max(0, Math.min(100, Math.round((state.balance / r.pointsRequired) * 100)));
          const err = problem.id === r.id ? problem.why : null;
          return (
            <li key={r.id} className="pr-card pl-glass" data-testid="pr-reward" data-can={r.canRedeem ? "1" : "0"}>
              <div className="pr-head">
                <div className="pr-name">{r.name}</div>
                <div className="pr-pts" data-testid="pr-pts">
                  {fmtNum(r.pointsRequired)}
                  <small>{lang === "ar" ? "نقطة" : r.pointsRequired === 1 ? "pt" : "pts"}</small>
                </div>
              </div>
              {r.description && <p className="pr-desc">{r.description}</p>}
              <div className="pr-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Progress towards this reward", "التقدم نحو هذه الجائزة")}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="pr-foot">
                <span className="pr-sub">
                  {r.pending
                    ? t("Request sent — waiting for reception", "تم إرسال الطلب — بانتظار الاستقبال")
                    : r.canRedeem
                    ? r.validUntil
                      ? t(`Available until ${date(r.validUntil)}`, `متاحة حتى ${date(r.validUntil)}`)
                      : t("You have enough points", "لديك نقاط كافية")
                    : t(`${pointsWord(r.missingPoints, "en")} to go`, `تحتاج ${pointsWord(r.missingPoints, "ar")} أخرى`)}
                </span>
                {r.pending ? (
                  <span className="pr-chip is-wait">
                    <IconClockHour4 size={13} aria-hidden="true" /> {t("Requested", "تم الطلب")}
                  </span>
                ) : (
                  <button type="button" className="pl-btn pr-ask" disabled={!r.canRedeem || busyId !== null} onClick={() => ask(r.id, r.name)} data-testid="pr-ask">
                    {busyId === r.id && <span className="pl-spin" aria-hidden="true" />}
                    {t("Request reward", "اطلب الجائزة")}
                  </button>
                )}
              </div>
              {err && (
                <p className="pl-error pl-pop pr-err" role="alert">
                  {err === "insufficient" && t("You don't have enough points for this yet.", "لا تملك نقاطًا كافية لهذه الجائزة بعد.")}
                  {err === "unavailable" && t("This reward isn't available right now.", "هذه الجائزة غير متاحة حاليًا.")}
                  {err === "limit" && t("Too many requests. Please ask reception.", "طلبات كثيرة. يرجى سؤال الاستقبال.")}
                  {err === "busy" && t("Rewards are very busy right now. Please ask reception.", "الجوائز مزدحمة الآن. يرجى سؤال الاستقبال.")}
                  {err === "rate" && t("Please wait a moment and try again.", "يرجى الانتظار لحظة ثم المحاولة مجددًا.")}
                  {err === "network" && (
                    <>
                      {t("Something went wrong. ", "حدث خطأ ما. ")}
                      <button type="button" className="pr-retry" onClick={() => ask(r.id, r.name)}>
                        <IconRefresh size={13} aria-hidden="true" /> {t("Retry", "إعادة المحاولة")}
                      </button>
                    </>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {state.requests.length > 0 && (
        <div className="pr-reqs pl-glass">
          <h3>{t("Your requests", "طلباتك")}</h3>
          <ul data-testid="pr-requests">
            {state.requests.map((r) => (
              <li key={r.key} data-status={r.status}>
                <span className="pr-rname">{r.rewardName}</span>
                <span className="pr-rpts">{pointsWord(r.points, lang)}</span>
                <span className={`pr-chip is-${r.status}`}>{statusText(r.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const PR_CSS = `
.pr-wrap{margin:18px 0 6px}
.pr-title{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:rgb(var(--accent));font-weight:600}
.pr-notice{display:flex;gap:8px;align-items:flex-start;margin:0 0 10px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.55;color:#c8f5d9;background:rgba(120,220,160,.1);border:1px solid rgba(120,220,160,.3)}
.pr-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.pr-card{padding:14px 16px;position:relative;overflow:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .35s}
.pr-card:hover{transform:translateY(-2px);border-color:rgba(var(--accent),.45)}
.pr-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}
.pr-name{min-width:0;font-size:15px;font-weight:650;color:#fbf0d2;overflow-wrap:anywhere}
.pr-pts{flex:none;font-size:22px;font-weight:650;color:rgb(var(--accent));font-variant-numeric:tabular-nums;line-height:1}
.pr-pts small{font-size:10px;margin-inline-start:4px;color:#a9a08a;font-weight:500}
.pr-desc{margin:6px 0 0;font-size:12.5px;line-height:1.55;color:#a9a08a;overflow-wrap:anywhere}
.pr-meter{margin:12px 0 8px;height:5px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.pr-meter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,rgba(var(--accent),.6),rgb(var(--accent)));transition:width .8s cubic-bezier(.2,.8,.2,1)}
.pr-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.pr-sub{font-size:12px;color:#a9a08a;min-width:0}
.pr-ask{min-height:40px;padding:0 16px;font-size:13px;width:auto}
.pr-ask:disabled{opacity:.45;cursor:not-allowed}
.pr-err{margin-top:8px}
.pr-retry{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 6px;background:none;border:0;color:#f3e3b5;text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:13px}
.pr-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
.pr-chip.is-wait,.pr-chip.is-pending{color:#f1dcab;background:rgba(241,220,171,.1);border:1px solid rgba(241,220,171,.25)}
.pr-chip.is-confirmed{color:#c8f5d9;background:rgba(120,220,160,.12);border:1px solid rgba(120,220,160,.3)}
.pr-chip.is-rejected,.pr-chip.is-reversed{color:#d9b8b8;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}
.pr-reqs{margin-top:10px;padding:14px 16px}
.pr-reqs h3{margin:0 0 8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a9a08a;font-weight:600}
.pr-reqs ul{list-style:none;margin:0;padding:0}
.pr-reqs li{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)}
.pr-reqs li:first-child{border-top:0}
.pr-rname{flex:1 1 120px;min-width:0;font-size:13px;color:#fbf0d2;overflow-wrap:anywhere}
.pr-rpts{font-size:12px;color:#a9a08a;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion: reduce){
  .pr-card,.pr-card:hover{transition:none;transform:none}
  .pr-meter i{transition:none}
}
`;
