/**
 * Per-Bill-Month bill header (Bill No. / Bill Date / NPS Schedule No.),
 * dbo.SalaryEntryBillHeader (migration 49).
 *
 * Deliberately separate from dbo.SalaryBillInstituteWorkflow (see
 * utils/salaryBillInstituteWorkflow.js), which stays exactly one row per
 * (SalaryBillCodeId, InstituteCode) and remains the single source of truth
 * for approval/submit/return/lock status. This table exists purely to let
 * two Bill Month instances of the SAME salary bill (e.g. AUG-2026 salary
 * paid as a JUL-2026 bill and again as an AUG-2026 bill) keep their own
 * Bill No. / Bill Date / NPS Schedule No. without overwriting each other.
 *
 * Lookup/identity key everywhere in this module: SalaryBillCodeId +
 * InstituteCode + canonical BillMonth (e.g. "JUL-2026", the same
 * formatMonthLabel() form resolveSalaryEntryBill already returns as
 * canonicalBillMonth — callers must pass that canonical form here, not a
 * raw user-typed value).
 */
const { sql } = require("../db");

function makeRequest(transaction) {
  return transaction ? new sql.Request(transaction) : new sql.Request();
}

async function getSalaryEntryBillHeader(
  billCodeId,
  instituteCode,
  billMonth,
  transaction
) {
  const req = makeRequest(transaction);
  const result = await req.query`
    SELECT TOP 1 *
    FROM dbo.SalaryEntryBillHeader
    WHERE SalaryBillCodeId = ${Number(billCodeId)}
      AND InstituteCode = ${String(instituteCode || "").trim()}
      AND BillMonth = ${String(billMonth || "").trim()}
  `;
  return result.recordset[0] || null;
}

/**
 * Insert or update the header row for this exact
 * (SalaryBillCodeId, InstituteCode, BillMonth) triple. Never touches any
 * other Bill Month's row for the same bill + institute.
 */
async function upsertSalaryEntryBillHeader(
  transaction,
  { billCodeId, instituteCode, billMonth, billNo, billDate, npsScheduleNo, actor = {} }
) {
  const id = Number(billCodeId);
  const code = String(instituteCode || "").trim();
  const month = String(billMonth || "").trim();
  if (!id || !code || !month) {
    const err = new Error(
      "SalaryBillCodeId, InstituteCode and BillMonth are all required to save a bill header."
    );
    err.status = 400;
    throw err;
  }
  const who = actor.fullName || actor.userName || "SYSTEM";

  const existing = await getSalaryEntryBillHeader(id, code, month, transaction);

  if (!existing) {
    const ins = makeRequest(transaction);
    await ins.query`
      INSERT INTO dbo.SalaryEntryBillHeader
        (SalaryBillCodeId, InstituteCode, BillMonth, BillNo, BillDate, NPSScheduleNo,
         UpdatedDate, UpdatedBy)
      VALUES
        (${id}, ${code}, ${month}, ${billNo || null}, ${billDate || null}, ${npsScheduleNo || null},
         SYSUTCDATETIME(), ${who})
    `;
  } else {
    const upd = makeRequest(transaction);
    await upd.query`
      UPDATE dbo.SalaryEntryBillHeader
      SET
        BillNo = ${billNo || null},
        BillDate = ${billDate || null},
        NPSScheduleNo = ${npsScheduleNo || null},
        UpdatedDate = SYSUTCDATETIME(),
        UpdatedBy = ${who}
      WHERE HeaderId = ${Number(existing.HeaderId)}
    `;
  }

  return getSalaryEntryBillHeader(id, code, month, transaction);
}

module.exports = {
  getSalaryEntryBillHeader,
  upsertSalaryEntryBillHeader,
};
