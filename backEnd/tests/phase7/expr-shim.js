/* TEST-ONLY (Phase 7) — never shipped. FerretDB (the only database in the verification sandbox) cannot evaluate `$expr` inside a
 * findOneAndUpdate filter, which the payment endpoint uses to make "this payment does not overpay the invoice" part of the SAME
 * database operation that appends the payment:
 *     Invoice.findOneAndUpdate({ _id, clinicId, $expr: { $lte: [ { $add: [ { $sum: "$payments.amount" }, amount ] }, {$add:["$total", 0.0005]} ] } }, { $push: { payments: … } })
 * Without this shim every payment would answer 500 in the sandbox, so the single most important money path could never be exercised.
 *
 * What it does: reads the candidate document (all the other filter conditions), evaluates the SAME $expr with the Phase 6 expression
 * evaluator (agg-emulator.js), and if true runs the real update pinned to that document's _id. The evaluation + update are two
 * round-trips, so cross-request ATOMICITY is NOT provided here: a test that races payments must record that as "NOT VERIFIED on this database"
 * (t.dbLimit). Real MongoDB evaluates $expr inside the one atomic operation.
 *
 * Activated with NODE_OPTIONS="--require …/agg-emulator.js --require …/expr-shim.js" and skipped when EXPR_SHIM=0.
 */
const mongoose = require("mongoose");
const { ev } = require("../analytics/agg-emulator.js");
const origExec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = async function (...args) {
  if (process.env.EXPR_SHIM === "0" || this.op !== "findOneAndUpdate") return origExec.apply(this, args);
  const filter = this.getFilter();
  if (!filter || !filter.$expr) return origExec.apply(this, args);
  const { $expr, ...rest } = filter;
  const doc = await this.model.findOne(rest).lean();
  if (!doc) return null;
  if (!ev($expr, doc)) return null;
  this.setQuery({ ...rest, _id: doc._id });
  return origExec.apply(this, args);
};
