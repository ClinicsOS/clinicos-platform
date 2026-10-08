import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyProgressEvent } from "../models/LoyaltyProgressEvent";
import { LoyaltyTierHistory } from "../models/LoyaltyTierHistory";
import { LoyaltyError } from "../services/loyaltyService";
import { recalculateClinic, type ClinicRecalcResult } from "../services/loyaltyTiers";

/**
 * ClinicOS Loyalty — Phase 7 BACKFILL / RECONCILIATION (run by an operator, never at server start).
 *
 * Rebuilds each existing member's progression counters from the AUTHORITATIVE sources and assigns tiers:
 *   lifetimeEarnedPoints  ← the immutable points ledger (earn_visit / earn_spending, net of their reversals)
 *   completedVisitsCount  ← appointments in status "completed"
 *   lifetimePaidAmount    ← real invoice payments (integer fils)
 *   currentTierKey        ← the clinic's tier rules (only if tiers are enabled and fully configured)
 * It is idempotent and safe to re-run: counters are SET from the sources, tier changes are compare-and-set and write
 * history only when the tier really changes. Nothing is ever deleted and the points ledger / balances are never touched.
 *
 * Usage (from backEnd/, after `npm run build`; needs MONGO_URI like the server):
 *   node dist/scripts/loyaltyTierBackfill.js --dry-run                 # report only, writes nothing
 *   node dist/scripts/loyaltyTierBackfill.js                           # all clinics
 *   node dist/scripts/loyaltyTierBackfill.js --clinic <clinicId>       # one clinic
 *   options: --batch 100 (members per DB batch)   --mode full|tiers (default full)
 *
 * Output = per-clinic COUNTS only (no names, no phone numbers). Clinics without an active Loyalty entitlement are skipped and listed.
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const dryRun = flag("dry-run");
  const mode = (arg("mode") ?? "full") as "full" | "tiers";
  if (mode !== "full" && mode !== "tiers") throw new Error('--mode must be "full" or "tiers"');
  const batch = Math.min(500, Math.max(10, Number(arg("batch")) || 100));
  const onlyClinic = arg("clinic");
  if (onlyClinic && !/^[a-f0-9]{24}$/i.test(onlyClinic)) throw new Error("--clinic must be a 24-character clinic id");

  await connectDB();
  // Make sure the new indexes exist before writing (autoIndex may be off in production).
  await Promise.all([LoyaltyAccount.init(), LoyaltyTierHistory.init(), LoyaltyProgressEvent.init()]);

  const clinicIds: string[] = onlyClinic ? [onlyClinic] : (await LoyaltyAccount.distinct("clinicId")).map(String);
  console.log(`Loyalty tier backfill — ${dryRun ? "DRY RUN (nothing is written)" : "LIVE"} — mode ${mode} — ${clinicIds.length} clinic(s)`);

  const total = { processed: 0, promoted: 0, demoted: 0, initial: 0, unchanged: 0, countersCorrected: 0, errors: 0 };
  const skipped: string[] = [];
  for (const clinicId of clinicIds) {
    let cursor: string | null = null;
    const sum: ClinicRecalcResult = {
      processed: 0, promoted: 0, demoted: 0, initial: 0, unchanged: 0, countersCorrected: 0, errors: 0, errorAccountIds: [],
      distribution: { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }, done: false, nextCursor: null, remaining: null, dryRun,
    };
    try {
      do {
        const r: ClinicRecalcResult = await recalculateClinic(clinicId, {
          source: "migration",
          mode,
          dryRun,
          cursor,
          batchSize: batch,
          maxMembers: batch * 10,
          budgetMs: 60_000,
        });
        for (const k of ["processed", "promoted", "demoted", "initial", "unchanged", "countersCorrected", "errors"] as const) sum[k] += r[k];
        for (const t of Object.keys(r.distribution) as (keyof typeof r.distribution)[]) sum.distribution[t] += r.distribution[t];
        sum.errorAccountIds.push(...r.errorAccountIds.slice(0, Math.max(0, 10 - sum.errorAccountIds.length)));
        cursor = r.done ? null : r.nextCursor;
        if (!r.done && !r.nextCursor) break;
      } while (cursor);
    } catch (e) {
      if (e instanceof LoyaltyError && (e.code === "ENTITLEMENT_REQUIRED" || e.code === "TIERS_NOT_READY")) {
        skipped.push(`${clinicId} (${e.code})`);
        continue;
      }
      throw e;
    }
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += sum[k] as number;
    console.log(
      `clinic ${clinicId}: members ${sum.processed}, counters corrected ${sum.countersCorrected}, promoted ${sum.promoted}, initial ${sum.initial}, demoted ${sum.demoted}, unchanged ${sum.unchanged}, errors ${sum.errors}` +
        (sum.errorAccountIds.length ? ` (account ids: ${sum.errorAccountIds.join(", ")})` : "") +
        ` | tiers: ${sum.distribution.tier1}/${sum.distribution.tier2}/${sum.distribution.tier3}/${sum.distribution.tier4}`
    );
  }
  console.log("TOTAL", JSON.stringify(total));
  if (skipped.length) console.log("SKIPPED (not entitled / tiers not ready):", skipped.join(", "));
  await mongoose.disconnect();
  process.exit(total.errors ? 2 : 0);
}

main().catch(async (e) => {
  console.error("Backfill failed:", e instanceof Error ? e.message : e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
