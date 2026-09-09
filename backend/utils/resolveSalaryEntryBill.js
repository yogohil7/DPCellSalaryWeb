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
  const result = await sql.query`
    SELECT *
    FROM dbo.SalaryBillCodes
    WHERE ISNULL(IsArchived, 0) = 0
      AND SalaryYear = ${String(salaryYear)}
      AND BillCategory = ${billCategory}
      AND BillType = ${billType}
      AND (
        SalaryMonth = ${salaryMonth}
        OR UPPER(LTRIM(RTRIM(SalaryMonth))) = ${String(salaryMonth).toUpperCase()}
      )
  `;
  const targetKey = yearMonthKey(billMonthParts);
  for (const row of result.recordset) {
    const rowParts = normalizeYearMonth(row.BillMonth, row.SalaryYear, null);
    if (yearMonthKey(rowParts) === targetKey) {
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

  const sameMonth =
    yearMonthKey(billParts) &&
    yearMonthKey(salaryParts) &&
    yearMonthKey(billParts) === yearMonthKey(salaryParts);

  if (sameMonth) {
    const sourceBillParts = normalizeYearMonth(
      source.BillMonth,
      source.SalaryYear,
      null
    );
    if (
      yearMonthKey(sourceBillParts) === yearMonthKey(salaryParts) ||
      !/-BM-[A-Z]{3}$/i.test(String(source.BillCode))
    ) {
      return {
        bill: source,
        sourceBill: source,
        created: false,
        billMonthMatched: true,
        canonicalBillMonth,
        canonicalSalaryMonth,
      };
    }
  }

  const existing = await findBillBySalaryAndBillMonth({
    salaryMonth: canonicalSalaryMonth,
    salaryYear: String(salaryParts.year || source.SalaryYear),
    billCategory: source.BillCategory || "Salary",
    billType: source.BillType || "Regular Salary",
    billMonthParts: billParts,
  });

  if (existing) {
    return {
      bill: existing,
      sourceBill: source,
      created: false,
      billMonthMatched: true,
      canonicalBillMonth,
      canonicalSalaryMonth,
    };
  }

  if (!createIfMissing) {
    const err = new Error(
      `No Salary Bill Code exists for Bill Month ${canonicalBillMonth} / Salary Month ${canonicalSalaryMonth}.`
    );
    err.status = 404;
    throw err;
  }

  const newBillCode = sameMonth
    ? String(source.BillCode).replace(/-BM-[A-Z]{3}$/i, "")
    : buildOldBillCode(source.BillCode, billParts);

  const conflict = await sql.query`
    SELECT TOP 1 BillCodeId FROM dbo.SalaryBillCodes WHERE BillCode = ${newBillCode}
  `;
  let finalCode = newBillCode;
  if (conflict.recordset[0]) {
    finalCode = `${newBillCode}-${Date.now().toString().slice(-4)}`;
  }

  const who = actor.fullName || actor.userName || "SYSTEM";
  const inserted = await sql.query`
    INSERT INTO dbo.SalaryBillCodes
      (
        BillCode, BillMonth, SalaryMonth, SalaryMonthNumber, SalaryYear,
        BillCategory, BillType, Description, Status, CreatedBy
      )
    OUTPUT INSERTED.*
    VALUES
      (
        ${finalCode},
        ${canonicalBillMonth},
        ${canonicalSalaryMonth},
        ${source.SalaryMonthNumber || String(salaryParts.month).padStart(2, "0")},
        ${String(salaryParts.year || source.SalaryYear)},
        ${source.BillCategory || "Salary"},
        ${source.BillType || "Regular Salary"},
        ${`Auto-created for Bill Month ${canonicalBillMonth} / Salary Month ${canonicalSalaryMonth}`},
        N'OPEN',
        ${who}
      )
  `;

  return {
    bill: inserted.recordset[0],
    sourceBill: source,
    created: true,
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
