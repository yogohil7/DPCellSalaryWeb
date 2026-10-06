/**
 * Cheque Register — approved/locked institute salary bills only.
 * TYPE = REGULAR when SalaryMonth == BillMonth (normalized), else OLD.
 */
const express = require("express");
const { sql } = require("../db");
const {
  instanceEmployeeRowsSql,
  queryReport,
  instanceBillMonthPartsOf,
  loadInstanceHeaders,
  resolveInstanceHeader,
} = require("../utils/reportBillInstance");
const {
  normalizeYearMonth,
  resolveChequeSalaryType,
  billTypeMatchesFilter,
  matchesFilterMonthYear,
  yearMonthKey,
  formatMonthLabel,
} = require("../utils/salaryMonthKey");
const { calculateChequeAmount } = require("../utils/salaryBasicCalc");
const { getSalaryEntryBillHeader } = require("../utils/salaryEntryBillHeader");

const router = express.Router();

const APPROVED_WORKFLOW_STATUSES = new Set(["APPROVED", "LOCKED"]);

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isDaDifference(billCategory, billType) {
  const cat = String(billCategory || "").trim().toUpperCase();
  const typ = String(billType || "").trim().toUpperCase();
  return cat === "DIFFERENCE" || typ === "DA DIFFERENCE";
}

function moneyRound(n) {
  return Number(toNum(n).toFixed(2));
}

function emptyTotals() {
  return {
    emp: 0,
    basic: 0,
    gradePay: 0,
    totalPay: 0,
    da: 0,
    hra: 0,
    cla: 0,
    medical: 0,
    specialAllowance: 0,
    ta: 0,
    grossAmount: 0,
    gpfAmount: 0,
    nps: 0,
    incomeTax: 0,
    professionalTax: 0,
    otherDeductions: 0,
    netAmount: 0,
    chequeAmount: 0,
  };
}

function addTotals(acc, row) {
  const keys = Object.keys(acc);
  for (const key of keys) {
    acc[key] = moneyRound(acc[key] + toNum(row[key]));
  }
  return acc;
}

async function loadSections() {
  const result = await sql.query`
    SELECT SectionId, SectionCode, SectionName
    FROM dbo.Sections
    WHERE ISNULL(IsActive, 1) = 1
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY SectionName, SectionId
  `;
  return result.recordset.map((row) => ({
    sectionId: Number(row.SectionId),
    sectionCode: row.SectionCode || "",
    sectionName: row.SectionName || "",
  }));
}

/**
 * Institute-level aggregates from approved SalaryEmployeeDetails.
 */
async function loadSalaryAggregates() {
  /*
     ONE ROW PER APPROVED BILL MONTH INSTANCE (migration 51).

     dbo.SalaryBillInstituteWorkflow is keyed by (SalaryBillCodeId,
     InstituteCode, BillMonth): the AUG-2026 salary bill (BillCodeId 1018)
     can have an AUG-2026 instance AND a JUL-2026 instance for the same
     institute. Each is a separate Cheque Register row, identified by the
     workflow row's own BillMonth (w.BillMonth) - never by the shared
     SalaryBillCodes.BillMonth, which is the same for both.

     The amounts come from the instance's own employee rows:
       - canonical instance (w.BillMonth = the bill's own Salary Month, the
         label migration 51 wrote) and every pre-existing "-BM-" variant
         bill -> dbo.SalaryEmployeeDetails, exactly as before;
       - earlier Bill Month instance -> dbo.SalaryEntryBillEmployeeDetails
         for that exact Bill Month (migration 50). Joining the canonical
         table here would report the AUG-2026 bill's amounts under the
         JUL-2026 row.
  */
  const canonical = await sql.query`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      w.BillMonth AS WorkflowBillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      b.BillCategory,
      b.BillType,
      b.CreatedDate AS BillCreatedDate,
      w.WorkflowId,
      w.InstituteCode,
      w.Status AS WorkflowStatus,
      w.ApprovedDate,
      w.ApprovedBy,
      w.LockedDate,
      w.BillNo,
      w.BillDate,
      i.InstituteId,
      i.InstituteName,
      ISNULL(i.InstituteDistrict, ISNULL(i.District, N'')) AS Place,
      i.SectionId,
      s.SectionName,
      COUNT_BIG(d.Id) AS EmpCount,
      ISNULL(SUM(d.BasicPay), 0) AS BasicPay,
      ISNULL(SUM(d.GradePay), 0) AS GradePay,
      ISNULL(SUM(d.TotalBasic), 0) AS TotalBasic,
      ISNULL(SUM(d.DA), 0) AS DA,
      ISNULL(SUM(d.HRA), 0) AS HRA,
      ISNULL(SUM(ISNULL(d.CLA, 0)), 0) AS CLA,
      ISNULL(SUM(d.MA), 0) AS MA,
      ISNULL(SUM(d.TA), 0) AS TA,
      ISNULL(SUM(d.SpecialAllowance), 0) AS SpecialAllowance,
      ISNULL(SUM(d.GrossSalary), 0) AS GrossSalary,
      ISNULL(SUM(d.NPS), 0) AS NPS,
      ISNULL(SUM(d.GPFSubscription), 0) AS GPFSubscription,
      ISNULL(SUM(d.GPFAdvance), 0) AS GPFAdvance,
      ISNULL(SUM(d.IncomeTax), 0) AS IncomeTax,
      ISNULL(SUM(d.ProfessionalTax), 0) AS ProfessionalTax,
      ISNULL(SUM(d.OtherDeduction), 0) AS OtherDeduction,
      ISNULL(SUM(d.NetSalary), 0) AS NetSalary,
      ISNULL(SUM(
        ISNULL(d.NetSalary, 0) +
        ISNULL(d.IncomeTax, 0) +
        ISNULL(d.ProfessionalTax, 0)
      ), 0) AS ChequeAmount
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN dbo.SalaryEmployeeDetails d
      ON d.SalaryBillCodeId = w.SalaryBillCodeId
     AND d.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections s ON s.SectionId = i.SectionId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
      AND (
            w.BillMonth = UPPER(LEFT(LTRIM(RTRIM(b.SalaryMonth)), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))
         OR b.BillCode LIKE N'%-BM-%'
      )
    GROUP BY
      b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryMonthNumber,
      b.SalaryYear, b.BillCategory, b.BillType, b.CreatedDate,
      w.WorkflowId, w.InstituteCode, w.BillMonth, w.Status, w.ApprovedDate, w.ApprovedBy, w.LockedDate,
      w.BillNo, w.BillDate,
      i.InstituteId, i.InstituteName, i.InstituteDistrict, i.District, i.SectionId, s.SectionName
    `;

  let instances = { recordset: [] };
  try {
    instances = await sql.query`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      w.BillMonth AS WorkflowBillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      b.BillCategory,
      b.BillType,
      b.CreatedDate AS BillCreatedDate,
      w.WorkflowId,
      w.InstituteCode,
      w.Status AS WorkflowStatus,
      w.ApprovedDate,
      w.ApprovedBy,
      w.LockedDate,
      w.BillNo,
      w.BillDate,
      i.InstituteId,
      i.InstituteName,
      ISNULL(i.InstituteDistrict, ISNULL(i.District, N'')) AS Place,
      i.SectionId,
      s.SectionName,
      COUNT_BIG(d.Id) AS EmpCount,
      ISNULL(SUM(d.BasicPay), 0) AS BasicPay,
      ISNULL(SUM(d.GradePay), 0) AS GradePay,
      ISNULL(SUM(d.TotalBasic), 0) AS TotalBasic,
      ISNULL(SUM(d.DA), 0) AS DA,
      ISNULL(SUM(d.HRA), 0) AS HRA,
      ISNULL(SUM(ISNULL(d.CLA, 0)), 0) AS CLA,
      ISNULL(SUM(d.MA), 0) AS MA,
      ISNULL(SUM(d.TA), 0) AS TA,
      ISNULL(SUM(d.SpecialAllowance), 0) AS SpecialAllowance,
      ISNULL(SUM(d.GrossSalary), 0) AS GrossSalary,
      ISNULL(SUM(d.NPS), 0) AS NPS,
      ISNULL(SUM(d.GPFSubscription), 0) AS GPFSubscription,
      ISNULL(SUM(d.GPFAdvance), 0) AS GPFAdvance,
      ISNULL(SUM(d.IncomeTax), 0) AS IncomeTax,
      ISNULL(SUM(d.ProfessionalTax), 0) AS ProfessionalTax,
      ISNULL(SUM(d.OtherDeduction), 0) AS OtherDeduction,
      ISNULL(SUM(d.NetSalary), 0) AS NetSalary,
      ISNULL(SUM(
        ISNULL(d.NetSalary, 0) +
        ISNULL(d.IncomeTax, 0) +
        ISNULL(d.ProfessionalTax, 0)
      ), 0) AS ChequeAmount
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN dbo.SalaryEntryBillEmployeeDetails d
      ON d.SalaryBillCodeId = w.SalaryBillCodeId
     AND d.InstituteCode = w.InstituteCode
     AND d.BillMonth = w.BillMonth
    LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections s ON s.SectionId = i.SectionId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
      AND w.BillMonth <> UPPER(LEFT(LTRIM(RTRIM(b.SalaryMonth)), 3)) + N'-' + CAST(b.SalaryYear AS NVARCHAR(4))
      AND b.BillCode NOT LIKE N'%-BM-%'
    GROUP BY
      b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryMonthNumber,
      b.SalaryYear, b.BillCategory, b.BillType, b.CreatedDate,
      w.WorkflowId, w.InstituteCode, w.BillMonth, w.Status, w.ApprovedDate, w.ApprovedBy, w.LockedDate,
      w.BillNo, w.BillDate,
      i.InstituteId, i.InstituteName, i.InstituteDistrict, i.District, i.SectionId, s.SectionName
    `;
  } catch (err) {
    /* dbo.SalaryEntryBillEmployeeDetails absent before migration 50. */
    if (!/invalid object name/i.test(String(err.message))) throw err;
  }
  return [...canonical.recordset, ...instances.recordset];
}

/**
 * DA Difference institute aggregates from approved DADifferenceEmployeeDetails.
 */
async function loadDaAggregates() {
  const result = await sql.query`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      w.BillMonth AS WorkflowBillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      b.BillCategory,
      b.BillType,
      b.CreatedDate AS BillCreatedDate,
      w.WorkflowId,
      w.InstituteCode,
      w.Status AS WorkflowStatus,
      w.ApprovedDate,
      w.ApprovedBy,
      w.LockedDate,
      w.BillNo,
      w.BillDate,
      i.InstituteId,
      i.InstituteName,
      ISNULL(i.InstituteDistrict, ISNULL(i.District, N'')) AS Place,
      i.SectionId,
      s.SectionName,
      COUNT_BIG(e.DADifferenceEmployeeDetailId) AS EmpCount,
      CAST(0 AS DECIMAL(18,2)) AS BasicPay,
      CAST(0 AS DECIMAL(18,2)) AS GradePay,
      CAST(0 AS DECIMAL(18,2)) AS TotalBasic,
      ISNULL(SUM(e.TotalDifferenceAmount), 0) AS DA,
      CAST(0 AS DECIMAL(18,2)) AS HRA,
      CAST(0 AS DECIMAL(18,2)) AS CLA,
      CAST(0 AS DECIMAL(18,2)) AS MA,
      CAST(0 AS DECIMAL(18,2)) AS TA,
      CAST(0 AS DECIMAL(18,2)) AS SpecialAllowance,
      ISNULL(SUM(e.TotalDifferenceAmount), 0) AS GrossSalary,
      ISNULL(SUM(e.TotalNPSDeduction), 0) AS NPS,
      CAST(0 AS DECIMAL(18,2)) AS GPFSubscription,
      CAST(0 AS DECIMAL(18,2)) AS GPFAdvance,
      CAST(0 AS DECIMAL(18,2)) AS IncomeTax,
      CAST(0 AS DECIMAL(18,2)) AS ProfessionalTax,
      CAST(0 AS DECIMAL(18,2)) AS OtherDeduction,
      ISNULL(SUM(e.TotalNetDifferenceAmount), 0) AS NetSalary,
      ISNULL(SUM(e.TotalNetDifferenceAmount), 0) AS ChequeAmount
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN dbo.DADifferenceBill db ON db.SalaryBillCodeId = b.BillCodeId
    INNER JOIN dbo.DADifferenceEmployeeDetails e
      ON e.DADifferenceBillId = db.DADifferenceBillId
     AND e.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections s ON s.SectionId = i.SectionId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND (
        UPPER(ISNULL(b.BillCategory, N'')) = N'DIFFERENCE'
        OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
      )
      AND ISNULL(b.IsArchived, 0) = 0
    GROUP BY
      b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth, b.SalaryMonthNumber,
      b.SalaryYear, b.BillCategory, b.BillType, b.CreatedDate,
      w.WorkflowId, w.InstituteCode, w.BillMonth, w.Status, w.ApprovedDate, w.ApprovedBy, w.LockedDate,
      w.BillNo, w.BillDate,
      i.InstituteId, i.InstituteName, i.InstituteDistrict, i.District, i.SectionId, s.SectionName
  `;
  return result.recordset;
}

/**
 * The parts of a bill's REAL Bill Month.
 *
 * normalizeYearMonth short-circuits on its third argument: given a valid
 * month number and year it returns those and never parses the month string.
 * So passing SalaryMonthNumber while normalizing BillMonth silently yields
 * the SALARY month — for JUN-2026-BM-MAY (BillMonth MAY-2026,
 * SalaryMonthNumber 06) it returned June, not May.
 *
 * The Bill Month is therefore parsed on its own, and only a bill that
 * genuinely has no BillMonth (older rows) falls back to the salary month.
 * This is the same rule utils/daDifference.js already uses.
 */
function billMonthPartsOf(billMonth, salaryMonth, salaryYear, salaryMonthNumber) {
  const fromBillMonth = normalizeYearMonth(billMonth, salaryYear, null);
  if (fromBillMonth) return fromBillMonth;
  return normalizeYearMonth(salaryMonth, salaryYear, salaryMonthNumber);
}

/**
 * The parts of a bill's SALARY MONTH - the month the bill represents, which
 * is what the report period is chosen by.
 *
 * One salary month can hold several bills with different Bill Months
 * (JUN-2026 and JUN-2026-BM-MAY are both salary month June), and all of them
 * belong in that month's report. Here the salary month number IS the right
 * fallback, because it describes this very month.
 */
function salaryMonthPartsOf(salaryMonth, salaryYear, salaryMonthNumber) {
  return normalizeYearMonth(salaryMonth, salaryYear, salaryMonthNumber);
}

/**
 * The Bill Month of the approved instance a Cheque Register row reports.
 *
 *   - Normal bill (e.g. AUG-2026): the workflow row's own BillMonth
 *     (w.BillMonth) - JUL-2026 for the JUL instance, AUG-2026 for the AUG
 *     instance of the same BillCodeId. SalaryBillCodes.BillMonth is shared
 *     by both instances and is never used for them.
 *   - Pre-existing "-BM-" variant bill (e.g. AUG-2026-BM-JUL): that bill
 *     IS the earlier-month bill; its Bill Month is part of its own
 *     identity (SalaryBillCodes.BillMonth), while migration 51 labelled its
 *     workflow row with its Salary Month. Its own BillMonth is kept, so it
 *     still reports as OLD, exactly as before.
 *   - Only a row with neither (pre-migration data) falls back to its
 *     Salary Month.
 */
/* Shared with every report: utils/reportBillInstance.js. */

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function mapAggregateRow(row, srNo) {
  const billCategory = row.BillCategory || "";
  const billType = row.BillType || "";
  const daDiff = isDaDifference(billCategory, billType);
  const billYm = instanceBillMonthPartsOf(row);
  const salaryYm = normalizeYearMonth(
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );
  /* REGULAR when the instance's Bill Month equals the Salary Month, else
     OLD - from the instance Bill Month, never SalaryBillCodes.BillMonth. */
  const salaryType = resolveChequeSalaryType({
    salaryMonth: row.SalaryMonth,
    billMonth: formatMonthLabel(billYm),
    salaryYear: row.SalaryYear,
    billYear: billYm ? billYm.year : row.SalaryYear,
    salaryMonthNumber: row.SalaryMonthNumber,
  });

  const emp = toNum(row.EmpCount);
  const basic = moneyRound(row.BasicPay);
  const gradePay = moneyRound(row.GradePay);
  const totalPay = moneyRound(row.TotalBasic) || moneyRound(basic + gradePay);
  const da = moneyRound(row.DA);
  const hra = moneyRound(row.HRA);
  const cla = moneyRound(row.CLA);
  const medical = moneyRound(row.MA);
  const ta = moneyRound(row.TA);
  const specialAllowance = moneyRound(row.SpecialAllowance);
  const grossAmount = moneyRound(row.GrossSalary);
  const nps = moneyRound(row.NPS);
  /* GPF AMT = rounded saved subscription + rounded saved advance.
     Each component is rounded on its own so a fractional advance is not
     absorbed into the subscription before rounding. */
  const gpfAmount = moneyRound(row.GPFSubscription) + moneyRound(row.GPFAdvance);
  const incomeTax = moneyRound(row.IncomeTax);
  const professionalTax = moneyRound(row.ProfessionalTax);
  const otherDeductions = moneyRound(row.OtherDeduction);
  const netAmount = moneyRound(row.NetSalary);
  const chequeAmount = calculateChequeAmount({
    netSalary: netAmount,
    incomeTax,
    professionalTax,
  });

  const billNoRaw = row.BillNo != null ? String(row.BillNo).trim() : "";
  const billDate = row.BillDate || null;

  return {
    srNo,
    billCodeId: Number(row.BillCodeId),
    workflowId: row.WorkflowId != null ? Number(row.WorkflowId) : null,
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || row.InstituteCode || "",
    place: row.Place || "",
    /* billNo/date/billDate here are the legacy single-instance values
       (dbo.SalaryBillInstituteWorkflow.BillNo/BillDate) and npsScheduleNo
       starts blank. ALL THREE are overwritten below in
       buildChequeRegisterReport with the Bill-Month-specific values from
       dbo.SalaryEntryBillHeader, keyed by the exact Bill Month being
       reported for this row — never left as this fallback. */
    billNo: billNoRaw || "",
    billCode: row.BillCode || "",
    date: billDate,
    billDate,
    npsScheduleNo: "",
    approvedDate: row.ApprovedDate || null,
    salaryMonth: row.SalaryMonth || "",
    /* Salary Month column: the month name, e.g. AUGUST. */
    salaryMonthName: salaryYm ? MONTH_NAMES[salaryYm.month - 1] : String(row.SalaryMonth || "").toUpperCase(),
    salaryMonthLabel: formatMonthLabel(salaryYm) || "",
    /* Bill Month column: the approved INSTANCE's Bill Month (MON-YYYY). */
    billMonth: formatMonthLabel(billYm) || "",
    workflowBillMonth: row.WorkflowBillMonth || "",
    /*
      The Bill Month of THIS bill, normalised to a MON-YYYY label.

      BillMonth is stored inconsistently — 'MAY-2026' on Bill-Month variants,
      but a bare month name on rows created without an explicit bill month.
      billYm has already been through normalizeYearMonth, so formatting from
      it gives one dependable label. The report's "Salary Month" column
      displays this; SalaryMonth itself is untouched and still drives the
      Month/Year filter and the REGULAR/OLD type.
    */
    billMonthLabel: formatMonthLabel(billYm) || row.BillMonth || "",
    salaryYear: row.SalaryYear || "",
    salaryMonthNumber: row.SalaryMonthNumber || null,
    salaryMonthKey: yearMonthKey(salaryYm),
    billMonthKey: yearMonthKey(billYm),
    type: salaryType,
    salaryType,
    /*
      The Group column shows the row's own Institute Code (OGE-01, OGE-05, ...),
      taken from the InstituteCode already joined on the workflow row, so two
      institutes inside the same section get different Group values.

      SectionName is deliberately NOT used here — it is still returned as
      `sectionName` below and still drives the Section Name filter.
      The previous value falls through only when a row genuinely has no
      institute code.
    */
    group:
      row.InstituteCode ||
      row.SectionName ||
      (daDiff ? "DA Difference" : "Salary"),
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    sectionName: row.SectionName || "",
    billCategory,
    billType,
    isDaDifference: daDiff,
    workflowStatus: String(row.WorkflowStatus || "").toUpperCase(),
    emp,
    basic,
    gradePay,
    gp: gradePay,
    totalPay,
    tPay: totalPay,
    da,
    hra,
    cla,
    medical,
    ma: medical,
    specialAllowance,
    ta,
    grossAmount,
    gpfAmount,
    nps,
    incomeTax,
    itTax: incomeTax,
    professionalTax,
    pTax: professionalTax,
    otherDeductions,
    netAmount,
    chequeAmount,
  };
}

function filterRows(rows, query) {
  const table = String(query.table || query.salaryType || "ALL")
    .trim()
    .toUpperCase();
  const sectionId = query.sectionId != null && query.sectionId !== ""
    ? Number(query.sectionId)
    : null;
  const sectionName = String(query.sectionName || "").trim().toUpperCase();
  const month = query.month != null && query.month !== "" ? Number(query.month) : null;
  const year = query.year != null && query.year !== "" ? Number(query.year) : null;
  const salaryTime = String(query.salaryTime || "ALL").trim().toUpperCase();
  const explicitBillMonthKey = yearMonthKey(
    normalizeYearMonth(parseExplicitBillMonth(query.billMonth, year), year, null)
  );

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) return false;

    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.sectionId) !== sectionId) return false;
    } else if (sectionName && sectionName !== "ALL") {
      if (String(row.sectionName || "").toUpperCase() !== sectionName) return false;
    }

    if (month != null && year != null) {
      /*
         The report period is the SALARY MONTH, so every approved bill of that
         salary month is listed whatever its Bill Month: selecting June 2026
         returns both JUN-2026 (Bill Month June) and JUN-2026-BM-MAY (Bill
         Month May). The Bill Month is still resolved separately, for the
         month column and the REGULAR/OLD classification, but it never decides
         membership of the period.
      */
      const salaryParts = salaryMonthPartsOf(
        row.salaryMonth,
        row.salaryYear,
        row.salaryMonthNumber
      );
      if (!matchesFilterMonthYear(salaryParts, month, year)) return false;
    }

    /* A selected Bill Month keeps only the instances of that Bill Month
       (JUL-2026 -> the JUL-2026 instances only). Auto keeps every approved
       instance of the Salary Month, each shown with its own Bill Month. */
    if (explicitBillMonthKey && row.billMonthKey !== explicitBillMonthKey) return false;

    const isDa = Boolean(row.isDaDifference);
    if (table === "DA" || table === "DA_DIFFERENCE" || table === "DA DIFFERENCE") {
      if (!isDa) return false;
    } else if (table === "REGULAR" || table === "REGULAR_SALARY") {
      /* Regular Salary = REGULAR + OLD for the selected Salary Month. See
         billTypeMatchesFilter in utils/salaryMonthKey.js. */
      if (isDa) return false;
      if (!billTypeMatchesFilter("REGULAR", row.type)) return false;
    } else if (table === "OLD" || table === "OLD_SALARY") {
      if (isDa) return false;
      if (!billTypeMatchesFilter("OLD", row.type)) return false;
    } else if (table === "SALARY" || table === "REGULAR_AND_OLD") {
      if (isDa) return false;
    }
    /* ALL → no table filter */

    if (salaryTime === "DA" || salaryTime === "DA_DIFFERENCE") {
      if (!isDa) return false;
    } else if (salaryTime === "REGULAR" || salaryTime === "REGULAR_SALARY") {
      if (isDa) return false;
    }

    return true;
  });
}

/* GET /api/cheque-register/meta — filter dropdown options */
router.get("/meta", async (_req, res) => {
  try {
    const sections = await loadSections();
    const yearsRes = await sql.query`
      SELECT DISTINCT SalaryYear
      FROM dbo.SalaryBillCodes
      WHERE SalaryYear IS NOT NULL AND LTRIM(RTRIM(SalaryYear)) <> N''
      ORDER BY SalaryYear DESC
    `;
    res.json({
      message: "OK",
      data: {
        tables: [
          { value: "ALL", label: "All" },
          { value: "REGULAR", label: "Regular Salary (incl. Old)" },
          { value: "OLD", label: "Old Salary" },
          { value: "DA_DIFFERENCE", label: "DA Difference" },
        ],
        sections: [{ sectionId: null, sectionName: "All", sectionCode: "" }, ...sections],
        months: [
          { value: 1, label: "January" },
          { value: 2, label: "February" },
          { value: 3, label: "March" },
          { value: 4, label: "April" },
          { value: 5, label: "May" },
          { value: 6, label: "June" },
          { value: 7, label: "July" },
          { value: 8, label: "August" },
          { value: 9, label: "September" },
          { value: 10, label: "October" },
          { value: 11, label: "November" },
          { value: 12, label: "December" },
        ],
        years: yearsRes.recordset.map((r) => String(r.SalaryYear)),
        formats: [
          { value: "SCREEN", label: "Screen" },
          { value: "PRINT", label: "Print" },
        ],
        salaryTimes: [
          { value: "ALL", label: "All" },
          { value: "REGULAR", label: "Regular Salary (incl. Old)" },
          { value: "DA_DIFFERENCE", label: "DA Difference" },
        ],
        approvedStatuses: Array.from(APPROVED_WORKFLOW_STATUSES),
      },
    });
  } catch (error) {
    console.error("GET /api/cheque-register/meta error:", error);
    res.status(500).json({
      message: "Unable to load Cheque Register filters.",
      error: error.message,
    });
  }
});

/**
 * Natural ordering for Group codes such as CPD-06, CPD-17, CPD-25, CPD-100.
 *
 * The code is split into alternating text and number runs, text runs compare
 * as text and number runs compare as NUMBERS, so CPD-17 sorts before CPD-100
 * — plain string ordering would put CPD-100 first because "1" < "7".
 *
 * Rows with no institute code (the "Salary" / "DA Difference" fallbacks) sort
 * by the same rule, since they are just text runs with no number.
 */
function groupSortChunks(group) {
  const text = String(group == null ? "" : group)
    .trim()
    .toUpperCase();
  const chunks = text.match(/\d+|\D+/g);
  return chunks || [];
}

function compareGroupCodes(a, b) {
  const left = groupSortChunks(a);
  const right = groupSortChunks(b);
  const len = Math.min(left.length, right.length);

  for (let i = 0; i < len; i += 1) {
    const l = left[i];
    const r = right[i];
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);

    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    if (l !== r) return l < r ? -1 : 1;
  }

  return left.length - right.length;
}

/**
 * The report's one and only ordering point.
 *
 * Rows are grouped by Group code and Sr. No. is handed out afterwards, so the
 * numbering always matches what is displayed. The sort is stable, so bills
 * sharing a Group keep the order they already arrived in — their existing
 * ordering is preserved rather than re-decided here.
 *
 * The screen, CSV, Excel, PDF and Print all read the rows this function
 * returns, so none of them can disagree about order or numbering.
 */
function sortAndNumberRows(rows) {
  return [...rows]
    .sort((a, b) => compareGroupCodes(a.group, b.group))
    .map((row, idx) => ({ ...row, srNo: idx + 1 }));
}

/* GET /api/cheque-register?table=&sectionId=&month=&year=&format=&salaryTime= */
/*
  ONE builder for the whole report.

  The screen endpoint and the Excel export both call this, so the rows,
  the totals and the title can never drift apart between them.
*/
/*
   Which Bill Month's dbo.SalaryEntryBillHeader row to read for a given
   Cheque Register row. Pure/exported so this can be regression-tested
   offline without a live database.
*/
function parseExplicitBillMonth(rawBillMonth, year) {
  const raw = String(rawBillMonth || "").trim();
  if (!raw) return "";
  const parts = normalizeYearMonth(raw, year, null);
  return parts ? formatMonthLabel(parts) : raw;
}

/*
   The Bill Month a row reports and whose dbo.SalaryEntryBillHeader
   (Bill No. / Date) it reads: ALWAYS the row's own approved instance.
   A selected Bill Month only filters rows (filterRows); it is never
   stamped onto a row of a different Bill Month - which is what made the
   JUL-2026 instance show as AUG-2026 (Auto) or the AUG-2026 instance show
   as JUL-2026 (JUL selected). The first argument is kept for existing
   callers and is intentionally ignored.
*/
function resolveEffectiveBillMonth(_explicitBillMonth, row) {
  return (
    row.billMonth ||
    formatMonthLabel(
      normalizeYearMonth(row.salaryMonth, row.salaryYear, row.salaryMonthNumber)
    ) ||
    row.salaryMonth
  );
}

async function buildChequeRegisterReport(query) {
  const month = query.month;
  const year = query.year;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error(
      "Month and Year are required to show the Cheque Register."
    );
    err.status = 400;
    throw err;
  }

  {
    const [salaryRows, daRows] = await Promise.all([
      loadSalaryAggregates(),
      loadDaAggregates().catch((err) => {
        console.warn("Cheque Register DA aggregates skipped:", err.message);
        return [];
      }),
    ]);

    const mapped = [...salaryRows, ...daRows].map((row, idx) =>
      mapAggregateRow(row, idx + 1)
    );
    /* Sorted by Group first; Sr. No. is assigned only after that. */
    const filtered = sortAndNumberRows(filterRows(mapped, query));

    /*
       Bill-Month-aware header lookup (dbo.SalaryEntryBillHeader).

       Bill No. / Bill Date / NPS Schedule No. are per-Bill-Month-instance:
       the SAME approved AUG-2026 salary bill can have a JUL-2026 bill
       instance and an AUG-2026 bill instance, each with its own header.
       Cheque Register must show ONE explicit, identified instance per row
       — never silently pick "whichever was saved last".

       query.billMonth, when supplied, is applied to EVERY row (e.g. "show
       me each institute's JUL-2026 bill"). When omitted, each row falls
       back to its OWN canonical Salary Month — the "regular", same-month
       bill instance — which is a fixed, explicit rule, not a guess at
       "latest saved". Either way, row.billMonthQueried below always says
       exactly which Bill Month's header the row is showing.
    */
    const explicitBillMonth = parseExplicitBillMonth(query.billMonth, year);

    const headers = await loadInstanceHeaders();
    for (const row of filtered) {
      const effectiveBillMonth = resolveEffectiveBillMonth(explicitBillMonth, row);
      row.billMonthQueried = effectiveBillMonth;
      /* Bill No. / Date of exactly this instance: its Bill-Month header,
         else the legacy columns on its OWN workflow row (row.billNo/date as
         mapped from w). Never another instance's values. */
      const header = resolveInstanceHeader(
        headers,
        {
          BillCodeId: row.billCodeId,
          InstituteCode: row.instituteCode,
          BillNo: row.billNo,
          BillDate: row.billDate,
          NPSScheduleNo: row.npsScheduleNo,
        },
        effectiveBillMonth
      );
      row.billNo = header.billNo;
      row.date = header.billDate;
      row.billDate = header.billDate;
      row.npsScheduleNo = header.npsScheduleNo;
      row.headerSource = header.headerSource;
    }

    const totals = filtered.reduce(
      (acc, row) =>
        addTotals(acc, {
          emp: row.emp,
          basic: row.basic,
          gradePay: row.gradePay,
          totalPay: row.totalPay,
          da: row.da,
          hra: row.hra,
          cla: row.cla,
          medical: row.medical,
          specialAllowance: row.specialAllowance,
          ta: row.ta,
          grossAmount: row.grossAmount,
          gpfAmount: row.gpfAmount,
          nps: row.nps,
          incomeTax: row.incomeTax,
          professionalTax: row.professionalTax,
          otherDeductions: row.otherDeductions,
          netAmount: row.netAmount,
          chequeAmount: row.chequeAmount,
        }),
      emptyTotals()
    );

    const monthNum = Number(month);
    const monthNames = [
      "",
      "JANUARY",
      "FEBRUARY",
      "MARCH",
      "APRIL",
      "MAY",
      "JUNE",
      "JULY",
      "AUGUST",
      "SEPTEMBER",
      "OCTOBER",
      "NOVEMBER",
      "DECEMBER",
    ];

    return {
      filters: {
        table: String(query.table || query.salaryType || "ALL"),
        sectionId: query.sectionId || null,
        sectionName: query.sectionName || null,
        month: monthNum,
        year: Number(year),
        format: String(query.format || "SCREEN").toUpperCase(),
        salaryTime: String(query.salaryTime || "ALL").toUpperCase(),
        /* Explicit and truthful about which Bill Month instance the header
           columns (Bill No./Bill Date/NPS Schedule No.) came from — see
           each row's own billMonthQueried for the per-row value, since a
           mixed set of salary months without an explicit billMonth can
           have a different "regular" Bill Month per row. */
        billMonth: explicitBillMonth || null,
        billMonthMode: explicitBillMonth ? "SELECTED" : "AUTO_SAME_AS_SALARY_MONTH",
      },
      title: `CHEQUE REGISTER - ${monthNames[monthNum] || month}-${year}`,
      rows: filtered,
      totals,
      rowCount: filtered.length,
    };
  }
}

router.get("/", async (req, res) => {
  try {
    const data = await buildChequeRegisterReport(req.query);
    res.json({ message: "OK", data });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }
    console.error("GET /api/cheque-register error:", error);
    res.status(500).json({
      message: "Unable to load Cheque Register.",
      error: error.message,
    });
  }
});

/*
  GET /api/cheque-register/export.xlsx

  A real .xlsx built with the `xlsx` package already in backend/package.json
  — not a CSV renamed. It reuses buildChequeRegisterReport, so it always
  contains exactly the rows, Bill Months and totals the screen is showing,
  under the same filters.

  Money and EMP are written as NUMBERS so Excel can sum them; only the
  identifying columns stay text.
*/
const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "instituteName", label: "Name of Institute" },
  { key: "place", label: "Place" },
  { key: "billNo", label: "Bill No." },
  { key: "date", label: "Date", type: "date" },
  { key: "billMonthQueried", label: "Bill Month" },
  { key: "type", label: "TYPE" },
  { key: "group", label: "Group" },
  { key: "emp", label: "EMP", type: "number" },
  { key: "basic", label: "Basic", type: "number" },
  { key: "gradePay", label: "G.P.", type: "number" },
  { key: "totalPay", label: "T.Pay", type: "number" },
  { key: "da", label: "D.A.", type: "number" },
  { key: "hra", label: "H.R.A.", type: "number" },
  { key: "cla", label: "C.L.A.", type: "number" },
  { key: "medical", label: "Medical", type: "number" },
  { key: "specialAllowance", label: "Special Allowance", type: "number" },
  { key: "ta", label: "T.A.", type: "number" },
  { key: "grossAmount", label: "Gross Amt.", type: "number" },
  { key: "gpfAmount", label: "GPF", type: "number" },
  { key: "nps", label: "NPS", type: "number" },
  { key: "incomeTax", label: "Income Tax", type: "number" },
  { key: "professionalTax", label: "Prof. Tax", type: "number" },
  { key: "otherDeductions", label: "Other Ded.", type: "number" },
  { key: "netAmount", label: "Net Amt.", type: "number" },
  { key: "chequeAmount", label: "Cheque Amt.", type: "number" },
];

function xlsxCell(row, column) {
  const value = row[column.key];
  if (column.type === "number") return Number(value || 0);
  if (column.type === "date") {
    const raw = value == null ? "" : String(value);
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : raw;
  }
  return value == null ? "" : String(value);
}

router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildChequeRegisterReport(req.query);

    const heading = [
      [data.title],
      [
        data.filters.sectionName
          ? `Section: ${data.filters.sectionName}`
          : "Section: All Sections",
      ],
      [`Table / Salary Type: ${data.filters.table}`,
       `Salary Time: ${data.filters.salaryTime}`],
      [],
    ];

    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) =>
      XLSX_COLUMNS.map((column) => xlsxCell(row, column))
    );

    /* Totals row, in the same shape the screen prints. */
    const totalsRow = [];
    if (data.totals && data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column, index) => {
        if (index === 0) totalsRow.push("TOTAL");
        else if (column.key === "emp" || column.type === "number") {
          const value = data.totals[column.key];
          totalsRow.push(value == null ? "" : Number(value));
        } else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = XLSX_COLUMNS.map((c) => ({
      wch: c.key === "instituteName" ? 34 : Math.max(10, c.label.length + 2),
    }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Cheque Register");

    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `${data.title.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }
    console.error("GET /api/cheque-register/export.xlsx error:", error);
    res.status(500).json({
      message: "Unable to export the Cheque Register.",
      error: error.message,
    });
  }
});

module.exports = router;
module.exports.buildChequeRegisterReport = buildChequeRegisterReport;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
module.exports.resolveChequeSalaryType = resolveChequeSalaryType;
module.exports.normalizeYearMonth = normalizeYearMonth;
module.exports.APPROVED_WORKFLOW_STATUSES = APPROVED_WORKFLOW_STATUSES;
module.exports.compareGroupCodes = compareGroupCodes;
module.exports.billMonthPartsOf = billMonthPartsOf;
module.exports.salaryMonthPartsOf = salaryMonthPartsOf;
/* Exported so tests can run the real DB-row -> mapped-row -> filter pipeline. */
module.exports.mapAggregateRow = mapAggregateRow;
module.exports.filterRows = filterRows;
module.exports.sortAndNumberRows = sortAndNumberRows;
module.exports.parseExplicitBillMonth = parseExplicitBillMonth;
module.exports.resolveEffectiveBillMonth = resolveEffectiveBillMonth;
