/**
 * DA Difference engine.
 *
 * For every employee and every month of the difference period:
 *
 *   Historical Basic = that month's SalaryEmployeeDetails.TotalBasic
 *                      (the snapshot actually paid in that month)
 *   Old DA           = that month's SalaryEmployeeDetails.DA
 *                      (the DA actually paid in that month)
 *   Revised DA       = Historical Basic x revised DA rate for that month
 *   Difference       = Revised DA - Old DA
 *
 * The historical Basic is read per month, so an increment inside the period
 * is honoured automatically: months before it keep the old Basic, months
 * from its effective month keep the new one.
 *
 * The revised rate comes from dbo.DAMaster resolved by effective date.
 * DAMaster already IS the DA rate history — no percentage is hard-coded
 * anywhere, in this file or in React.
 */

const { sql } = require("../db");
const { toNum, roundMoney, buildMonthRange, monthLabel } = require("./employeeIncrement");
const { normalizeYearMonth, yearMonthKey } = require("./salaryMonthKey");

/**
 * Resolve the paid month key for a salary bill row.
 * BillMonth is authoritative; SalaryMonth is only a legacy fallback when
 * BillMonth was never stored (older same-month bills).
 */
function billMonthPartsFromSalaryBill(row) {
  if (!row) return null;
  const fromBillMonth = normalizeYearMonth(
    row.BillMonth,
    row.SalaryYear,
    null
  );
  if (fromBillMonth) return fromBillMonth;
  return normalizeYearMonth(
    row.SalaryMonth || row.BillCode,
    row.SalaryYear,
    row.SalaryMonthNumber
  );
}

function workflowPriority(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "LOCKED":
      return 0;
    case "APPROVED":
      return 1;
    case "COMPLETED":
      return 2;
    case "VERIFIED":
      return 3;
    case "SUBMITTED":
    case "RESUBMITTED":
      return 4;
    default:
      return 5;
  }
}

/**
 * Pick the salary SED row whose ACTUAL BillMonth matches the DA month.
 * Never match on SalaryMonth alone — multiple bills can share one SalaryMonth.
 */
function pickSnapshotForBillMonth(rows, year, monthNumber) {
  const targetKey = yearMonthKey({
    year: Number(year),
    month: Number(monthNumber),
  });
  if (!targetKey || !Array.isArray(rows) || rows.length === 0) return null;

  const matches = rows.filter((row) => {
    const parts = billMonthPartsFromSalaryBill(row);
    return yearMonthKey(parts) === targetKey;
  });
  if (!matches.length) return null;

  matches.sort((a, b) => {
    const wf =
      workflowPriority(a.InstituteWorkflowStatus) -
      workflowPriority(b.InstituteWorkflowStatus);
    if (wf !== 0) return wf;
    const master =
      workflowPriority(a.BillMasterStatus || a.Status) -
      workflowPriority(b.BillMasterStatus || b.Status);
    if (master !== 0) return master;
    return Number(a.SalaryBillCodeId || 0) - Number(b.SalaryBillCodeId || 0);
  });

  return matches[0];
}

/**
 * Revised DA percentage in force for a given month.
 * Same resolution rule the salary engine uses: latest EffectiveFrom on or
 * before the date, preferring a row tied to the employee's pay revision.
 */
async function getRevisedDaRateForMonth(asOfDate, payRevisionId = null) {
  const result = await sql.query`
    SELECT TOP 1 DAId, DAPercentage, EffectiveFrom, EffectiveTo, PayRevisionId
    FROM dbo.DAMaster
    WHERE (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
      AND EffectiveFrom <= ${asOfDate}
      AND (EffectiveTo IS NULL OR EffectiveTo >= ${asOfDate})
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY
      CASE WHEN PayRevisionId = ${payRevisionId} THEN 0 ELSE 1 END,
      EffectiveFrom DESC
  `;

  const row = result.recordset[0];
  if (!row) return { rate: null, daId: null, found: false };

  return {
    rate: toNum(row.DAPercentage),
    daId: Number(row.DAId),
    effectiveFrom: row.EffectiveFrom,
    found: true,
  };
}

/** Cache the rate per month so a 200-employee bill does one query per month. */
async function buildRateMap(months, payRevisionId = null) {
  const map = new Map();
  for (const month of months) {
    if (map.has(month.key)) continue;
    map.set(month.key, await getRevisedDaRateForMonth(month.asOfDate, payRevisionId));
  }
  return map;
}

/**
 * The salary snapshot actually paid to an employee for one historical Bill Month.
 *
 * Match key:
 *   InstituteCode + EmployeeId + BillMonth
 *
 * SalaryMonth is processing metadata only. Bills such as JUN-2026-BM-MAY
 * (SalaryMonth=JUN-2026, BillMonth=MAY-2026) must be selected for DA month
 * MAY-2026, never via SalaryMonthNumber = 06.
 */
async function getHistoricalSnapshot({
  employeeId,
  instituteCode,
  year,
  monthNumber,
}) {
  const result = await sql.query`
    SELECT
      d.Id,
      d.SalaryBillCodeId,
      d.EmployeeId,
      d.InstituteCode,
      d.EmployeeName,
      d.Designation,
      d.EmployeeType,
      d.BasicPay,
      d.GradePay,
      d.TotalBasic,
      d.DA,
      d.HRA,
      d.MA,
      d.TA,
      d.PayLevel,
      d.DARate,
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      b.Status AS BillMasterStatus,
      w.Status AS InstituteWorkflowStatus
    FROM dbo.SalaryEmployeeDetails d
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = d.SalaryBillCodeId
    LEFT JOIN dbo.SalaryBillInstituteWorkflow w
      ON w.SalaryBillCodeId = d.SalaryBillCodeId
     AND w.InstituteCode = d.InstituteCode
     /* The saved snapshot belongs to the canonical instance: join only its
        workflow row (migration 51 labelled it with the bill's own Salary
        Month - "-BM-" variant bills included), so an earlier Bill Month
        instance of the same bill can neither duplicate the snapshot nor
        lend it its status. */
     AND w.BillMonth = UPPER(LEFT(LTRIM(RTRIM(b.SalaryMonth)), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))
    WHERE d.EmployeeId = ${Number(employeeId)}
      AND d.InstituteCode = ${String(instituteCode)}
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) = N'SALARY'
      AND ISNULL(b.IsArchived, 0) = 0
  `;

  return pickSnapshotForBillMonth(result.recordset, year, monthNumber);
}

/**
 * DA rate actually paid in a historical month.
 * Prefers the stored DARate column; otherwise derives it from the amounts
 * that were paid, so old snapshots taken before DARate existed still work.
 */
function deriveOldDaRate(snapshot) {
  const stored = snapshot && snapshot.DARate != null ? toNum(snapshot.DARate) : null;
  if (stored != null && stored > 0) return stored;

  const totalBasic = toNum(snapshot?.TotalBasic);
  const oldDa = toNum(snapshot?.DA);
  if (totalBasic <= 0) return 0;
  return Number(((oldDa / totalBasic) * 100).toFixed(4));
}

/**
 * NPS deduction on a DA arrears amount.
 *
 * Uses the same shape as the salary engine's NPS rule in
 * utils/salaryBasicCalc.js — CEILING(amount x 10%, 1) — applied to the DA
 * difference, because arrears carry NPS only on the DA that was short-paid.
 * HRA, MA, TA and CLA are not part of a DA difference at all, so nothing
 * needs excluding here.
 */
const NPS_RATE = 0.1;

function calculateNpsOnDifference(differenceAmount) {
  const amount = toNum(differenceAmount);
  if (amount <= 0) return 0;
  return Math.ceil(amount * NPS_RATE);
}

/**
 * Validate an NPS value a user typed.
 * Returns { valid, value, message }. Non-numeric or negative is rejected;
 * zero is allowed; the deduction may not exceed the difference itself.
 */
function validateNpsOverride(value, differenceAmount) {
  if (value == null || value === "") {
    return { valid: false, value: 0, message: "NPS deduction is empty." };
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return { valid: false, value: 0, message: "NPS deduction must be numeric." };
  }
  if (amount < 0) {
    return { valid: false, value: 0, message: "NPS deduction cannot be negative." };
  }
  const difference = roundMoney(differenceAmount);
  if (roundMoney(amount) > difference) {
    return {
      valid: false,
      value: 0,
      message: `NPS deduction cannot exceed the DA difference of ${difference}.`,
    };
  }
  return { valid: true, value: roundMoney(amount), message: null };
}

/**
 * One month's DA difference for one employee.
 * Pure arithmetic — takes the snapshot and the rate, returns the row.
 */
function calculateMonthDifference({ month, snapshot, revisedRate, savedNps = null }) {
  if (!snapshot) {
    return {
      salaryMonth: month.label,
      salaryMonthNumber: month.monthNumber,
      salaryYear: month.year,
      sourceSalaryBillCodeId: null,
      sourceBillCode: null,
      sourceBillMonth: null,
      sourceSalaryMonth: null,
      historicalBasic: 0,
      oldDARate: null,
      oldDA: 0,
      revisedDARate: toNum(revisedRate),
      revisedDA: 0,
      differenceAmount: 0,
      npsDeduction: 0,
      npsManual: false,
      netDifferenceAmount: 0,
      snapshotMissing: true,
      remarks: `No salary snapshot found for ${month.label}.`,
    };
  }

  /* Historical Basic = Total Basic Pay actually paid that month. */
  const historicalBasic = roundMoney(snapshot.TotalBasic);
  const oldDA = roundMoney(snapshot.DA);
  const oldDARate = deriveOldDaRate(snapshot);
  const rate = toNum(revisedRate);

  /* Same rounding rule the salary engine uses (roundMoney, 2dp). */
  const revisedDA = roundMoney((historicalBasic * rate) / 100);
  const differenceAmount = roundMoney(revisedDA - oldDA);

  /*
    NPS default is derived, but a value a user already saved WINS.
    savedNps is only passed in when the stored row was flagged NPSManual,
    so a recalculation can never silently overwrite a manual entry.
  */
  let npsDeduction = calculateNpsOnDifference(differenceAmount);
  let npsManual = false;
  let npsRejected = null;

  if (savedNps != null) {
    const checked = validateNpsOverride(savedNps, differenceAmount);
    if (checked.valid) {
      npsDeduction = checked.value;
      npsManual = true;
    } else {
      /* Reported to the caller rather than silently replaced, so a bad
         value is refused instead of quietly reverting to the default. */
      npsRejected = checked.message;
    }
  }

  const netDifferenceAmount = roundMoney(differenceAmount - npsDeduction);
  const sourceBillParts = billMonthPartsFromSalaryBill(snapshot);

  return {
    salaryMonth: month.label,
    salaryMonthNumber: month.monthNumber,
    salaryYear: month.year,
    sourceSalaryBillCodeId: Number(snapshot.SalaryBillCodeId),
    sourceBillCode: snapshot.BillCode || null,
    sourceBillMonth: snapshot.BillMonth || yearMonthKey(sourceBillParts) || null,
    sourceSalaryMonth: snapshot.SalaryMonth || null,
    historicalBasic,
    oldDARate,
    oldDA,
    revisedDARate: rate,
    revisedDA,
    differenceAmount,
    npsDeduction,
    npsManual,
    npsRejected,
    netDifferenceAmount,
    snapshotMissing: false,
    remarks: null,
  };
}

/**
 * Full DA difference for one employee across the period.
 * Total = sum of the independent monthly differences.
 */
async function calculateEmployeeDifference({
  employeeId,
  instituteCode,
  months,
  rateMap,
  savedNpsByMonth = null,
}) {
  const monthRows = [];
  const npsErrors = [];
  let total = 0;
  let totalNps = 0;
  let totalNet = 0;
  let identity = null;

  for (const month of months) {
    const snapshot = await getHistoricalSnapshot({
      employeeId,
      instituteCode,
      year: month.year,
      monthNumber: month.monthNumber,
    });

    if (snapshot && !identity) identity = snapshot;

    const rateInfo = rateMap.get(month.key) || { rate: 0, found: false };
    const row = calculateMonthDifference({
      month,
      snapshot,
      revisedRate: rateInfo.rate,
      savedNps: savedNpsByMonth ? savedNpsByMonth.get(month.key) ?? null : null,
    });

    if (!rateInfo.found) {
      row.remarks = row.remarks
        ? `${row.remarks} No DA rate configured for ${month.label}.`
        : `No DA rate configured in DA Master for ${month.label}.`;
    }

    if (row.npsRejected) {
      npsErrors.push(`${month.label}: ${row.npsRejected}`);
    }

    monthRows.push(row);
    total += row.differenceAmount;
    totalNps += row.npsDeduction;
    totalNet += row.netDifferenceAmount;
  }

  return {
    employeeId: Number(employeeId),
    instituteCode,
    employeeName: identity?.EmployeeName || "",
    designation: identity?.Designation || "",
    employeeType: identity?.EmployeeType || "",
    payLevel: identity?.PayLevel || null,
    months: monthRows,
    totalDifferenceAmount: roundMoney(total),
    totalNpsDeduction: roundMoney(totalNps),
    totalNetDifferenceAmount: roundMoney(totalNet),
    npsErrors,
    hasAnySnapshot: Boolean(identity),
  };
}

/**
 * Every employee that has at least one salary snapshot in the period for
 * this institute. Discovery uses ACTUAL BillMonth (with SalaryMonth only as
 * a legacy fallback when BillMonth is blank).
 */
async function listEmployeesForPeriod({ instituteCode, months }) {
  if (!months.length) return [];

  const monthKeys = new Set(months.map((m) => m.key));

  const result = await sql.query`
    SELECT
      d.EmployeeId,
      d.EmployeeName,
      d.Designation,
      d.EmployeeType,
      e.EmployeeCode,
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear
    FROM dbo.SalaryEmployeeDetails d
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = d.SalaryBillCodeId
    LEFT JOIN dbo.EmployeeMaster e
      ON e.EmployeeId = d.EmployeeId
    WHERE d.InstituteCode = ${String(instituteCode)}
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) = N'SALARY'
      AND ISNULL(b.IsArchived, 0) = 0
  `;

  const byEmployee = new Map();
  for (const row of result.recordset) {
    const parts = billMonthPartsFromSalaryBill(row);
    const key = yearMonthKey(parts);
    if (!key || !monthKeys.has(key)) continue;

    const employeeId = Number(row.EmployeeId);
    if (!byEmployee.has(employeeId)) {
      byEmployee.set(employeeId, {
        EmployeeId: employeeId,
        EmployeeName: row.EmployeeName,
        Designation: row.Designation,
        EmployeeType: row.EmployeeType,
        EmployeeCode: row.EmployeeCode,
      });
    }
  }

  return [...byEmployee.values()].sort(
    (a, b2) =>
      String(a.EmployeeName || "").localeCompare(String(b2.EmployeeName || "")) ||
      Number(a.EmployeeId) - Number(b2.EmployeeId)
  );
}

module.exports = {
  buildMonthRange,
  monthLabel,
  getRevisedDaRateForMonth,
  buildRateMap,
  getHistoricalSnapshot,
  pickSnapshotForBillMonth,
  billMonthPartsFromSalaryBill,
  deriveOldDaRate,
  calculateNpsOnDifference,
  validateNpsOverride,
  calculateMonthDifference,
  calculateEmployeeDifference,
  listEmployeesForPeriod,
};
