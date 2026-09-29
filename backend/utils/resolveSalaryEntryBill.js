/**
 * Resolve the SalaryBillCodes row for Salary Entry using:
 *   Institute + BillMonth + SalaryMonth (+ category/type via source bill)
 *
 * When Bill Month differs from Salary Month, find or create a dedicated
 * Bill Code (e.g. JUN-2026-BM-MAY) so institute workflow / snapshots stay isolated.
 */
const { sql } = require("../db");
const {
  normalizeYearMonth,
  yearMonthKey,
  formatMonthLabel,
  MONTH_SHORT,
} = require("./salaryMonthKey");

function salaryPartsFromBill(bill) {
  return normalizeYearMonth(
    bill.SalaryMonth || bill.BillCode,
    bill.SalaryYear,
    bill.SalaryMonthNumber
  );
}

function billMonthPartsFromRequest(billMonth, salaryParts, fallbackBill) {
  const fromRequest = normalizeYearMonth(
    billMonth,
    salaryParts?.year || fallbackBill?.SalaryYear,
    null
  );
  if (fromRequest) return fromRequest;
  return (
    normalizeYearMonth(
      fallbackBill?.BillMonth,
      fallbackBill?.SalaryYear,
      null
    ) || salaryParts
  );
}

function buildOldBillCode(sourceBillCode, billParts) {
  const base = String(sourceBillCode || "")
    .trim()
    .toUpperCase()
    .replace(/-BM-[A-Z]{3}$/i, "");
  const short = MONTH_SHORT[(billParts?.month || 1) - 1] || "UNK";
  return `${base}-BM-${short}`;
}

async function findBillBySalaryAndBillMonth({
  salaryMonth,
  salaryYear,
  billCategory,
  billType,
  billMonthParts,
}) {
  /*
     MONTH COLUMN FORMAT TRAP (see utils/salaryMonthKey.js header comment):
     SalaryMonth stores either a month NAME ("August", from a canonical bill
     created without an explicit Bill Month) or a short label ("AUG-2026",
     from this file's own INSERT below). Filtering candidates in SQL by a
     literal/uppercase SalaryMonth string match against the caller's
     canonicalSalaryMonth (always the short-label form) therefore missed
     every canonical bill stored as a name and NEVER found it as "existing".

     The caller (resolveSalaryEntryBill) then fell through to createIfMissing,
     hit the BillCode uniqueness conflict on the Bill-Month variant another
     institute had already created for the same period, and minted a second,
     differently-coded duplicate ("...-BM-JUL-<timestamp>") for the SAME
     salary period instead of reusing the existing row — splitting one
     period's data across two Bill Codes.

     Fix: pull every non-archived candidate for the year/category/type (a
     handful of rows) and compare BOTH SalaryMonth and BillMonth in JS via
     normalizeYearMonth/yearMonthKey, exactly like BillMonth already was.
     This is what lets a second institute reuse the SAME Bill-Month variant
     bill code a first institute already created for that period.
  */
  const result = await sql.query`
    SELECT *
    FROM dbo.SalaryBillCodes
    WHERE ISNULL(IsArchived, 0) = 0
      AND SalaryYear = ${String(salaryYear)}
      AND BillCategory = ${billCategory}
      AND BillType = ${billType}
  `;
  const targetSalaryKey = yearMonthKey(
    normalizeYearMonth(salaryMonth, salaryYear, null)
  );
  const targetBillKey = yearMonthKey(billMonthParts);
  for (const row of result.recordset) {
    const rowSalaryKey = yearMonthKey(
      normalizeYearMonth(row.SalaryMonth, row.SalaryYear, row.SalaryMonthNumber)
    );
    const rowBillKey = yearMonthKey(
      normalizeYearMonth(row.BillMonth, row.SalaryYear, null)
    );
    if (rowSalaryKey === targetSalaryKey && rowBillKey === targetBillKey) {
      return row;
    }
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.billCode - selected salary bill code (salary-month source)
 * @param {string} [opts.billMonth] - payment/bill month from Salary Entry
 * @param {string} [opts.salaryMonth] - optional override; defaults from bill code
 * @param {boolean} [opts.createIfMissing=true]
 * @param {object} [opts.actor]
 */
async function resolveSalaryEntryBill({
  billCode,
  billMonth,
  salaryMonth,
  createIfMissing = true,
  actor = {},
} = {}) {
  const code = String(billCode || "").trim();
  if (!code) {
    const err = new Error("Salary Bill Code is required.");
    err.status = 400;
    throw err;
  }

  const sourceRes = await sql.query`
    SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${code}
  `;
  let source = sourceRes.recordset[0] || null;
  let requestedBmRow = null;

  /* If caller already has the BM variant code, keep it as the target and use
     the salary-month master (base code) for month-lock / OPEN checks. */
  if (source && /-BM-[A-Z]{3}$/i.test(code)) {
    requestedBmRow = source;
    const baseCode = code.replace(/-BM-[A-Z]{3}$/i, "");
    const baseRes = await sql.query`
      SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${baseCode}
    `;
    source = baseRes.recordset[0] || source;
  } else if (!source && /-BM-[A-Z]{3}$/i.test(code)) {
    const baseCode = code.replace(/-BM-[A-Z]{3}$/i, "");
    const baseRes = await sql.query`
      SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${baseCode}
    `;
    source = baseRes.recordset[0] || null;
    const existing = await sql.query`
      SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${code}
    `;
    requestedBmRow = existing.recordset[0] || null;
  }

  if (!source) {
    const err = new Error(`Bill Code ${code} not found.`);
    err.status = 404;
    throw err;
  }

  const salaryParts =
    normalizeYearMonth(
      salaryMonth || source.SalaryMonth || source.BillCode,
      source.SalaryYear,
      source.SalaryMonthNumber
    ) || salaryPartsFromBill(source);

  const billParts = billMonthPartsFromRequest(
    billMonth || requestedBmRow?.BillMonth,
    salaryParts,
    requestedBmRow || source
  );
  const canonicalBillMonth = formatMonthLabel(billParts);
  const canonicalSalaryMonth =
    formatMonthLabel(salaryParts) || source.SalaryMonth;

  /*
    BUSINESS RULE (2026-09-24, explicit user instruction): Bill Month must
    never be LATER than Salary Month. Salary Month alone continues to
    determine the SalaryBillCodes master row / employee data; this only
    rejects an invalid Bill Month selection for the general (non "-BM-")
    flow, before anything is read or written. A caller that omits billMonth
    entirely defaults to the same month as Salary Month (billMonthParts
    above falls back to salaryParts), which is always valid, so this only
    fires when the caller actually requested a later month.
  */
  if (!requestedBmRow) {
    const billOrdinal = billParts.year * 12 + billParts.month;
    const salaryOrdinal = salaryParts.year * 12 + salaryParts.month;
    if (billOrdinal > salaryOrdinal) {
      const err = new Error(
        `Bill Month cannot be later than Salary Month. Bill Month ${canonicalBillMonth} is after Salary Month ${canonicalSalaryMonth}.`
      );
      err.status = 400;
      err.code = "BILL_MONTH_AFTER_SALARY_MONTH";
      err.canonicalBillMonth = canonicalBillMonth;
      err.canonicalSalaryMonth = canonicalSalaryMonth;
      throw err;
    }
  }

  /*
    Exact Bill-Month variant codes (e.g. JUN-2026-BM-MAY) are a primary key.
    Never collapse them to the same-month master (JUN-2026) even if a caller
    omits or mis-sends billMonth — that broke Returning Bills reopen.
  */
  if (requestedBmRow) {
    const bmParts = normalizeYearMonth(
      requestedBmRow.BillMonth,
      requestedBmRow.SalaryYear,
      null
    );
    return {
      bill: requestedBmRow,
      sourceBill: source,
      created: false,
      billMonthMatched: true,
      canonicalBillMonth: formatMonthLabel(bmParts) || canonicalBillMonth,
      canonicalSalaryMonth:
        formatMonthLabel(
          normalizeYearMonth(
            requestedBmRow.SalaryMonth,
            requestedBmRow.SalaryYear,
            requestedBmRow.SalaryMonthNumber
          )
        ) || canonicalSalaryMonth,
    };
  }

  /*
     DECISION (2026-09-23, explicit user instruction): Salary Entry no
     longer searches for or creates a Bill-Month variant (e.g.
     AUG-2026-BM-JUL) for the general flow. When the caller passes the
     PLAIN Salary Month bill code (no -BM- suffix — the normal case, e.g.
     "AUG-2026"), it always resolves directly to that master row,
     regardless of whether billMonth differs from salaryMonth. Bill Month
     is informational only in this flow: it is returned for display via
     canonicalBillMonth, but nothing is persisted for it and no new
     SalaryBillCodes row is ever created here.

     Bill-Month variants created BEFORE this change (e.g. the existing
     AUG-2026-BM-JUL / BillCodeId 1019) are left exactly as they are in
     the database — nothing here deletes or alters them — and remain
     reachable exactly as before by requesting that -BM- code directly
     (see the requestedBmRow branch above, e.g. Returned Bills reopen).
     They are simply no longer found or created by the general
     Salary-Month-code + billMonth lookup below.

     createIfMissing is accepted for backward compatibility with existing
     callers but no longer triggers an INSERT from this function; Salary
     Bill Code Master (routes/salaryBillCodes.js) remains the only place
     a new Bill Code can be created.

     UPDATE (2026-09-24): canonicalBillMonth returned below is no longer
     purely informational. The caller (routes/salaryEntry.js) now persists
     it on the institute-specific dbo.SalaryBillInstituteWorkflow row
     (BillMonth column, migration 48) — never on this shared master
     `source` row, and never by creating a "-BM-" variant. This function
     itself still writes nothing; it only resolves and validates.
  */
  return {
    bill: source,
    sourceBill: source,
    created: false,
    billMonthMatched: true,
    canonicalBillMonth,
    canonicalSalaryMonth,
  };
}

module.exports = {
  resolveSalaryEntryBill,
  findBillBySalaryAndBillMonth,
  buildOldBillCode,
};
