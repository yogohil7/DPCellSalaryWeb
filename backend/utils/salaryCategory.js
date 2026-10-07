/**
 * SALARY CATEGORY — the one place that classifies a salary record as
 * REGULAR SALARY or DA DIFFERENCE SALARY, and the one place that loads
 * DA Difference rows for reports.
 *
 * WHY THIS EXISTS
 *   Salary Category and Bill Type are two SEPARATE dimensions and must never
 *   collapse into each other:
 *
 *     Salary Category : REGULAR SALARY | DA DIFFERENCE SALARY
 *                       -> from dbo.SalaryBillCodes.BillCategory / BillType,
 *                          the authoritative existing classification.
 *     Bill Type       : REGULAR | OLD
 *                       -> from comparing salary month with bill month
 *                          (resolveChequeSalaryType).
 *
 *   OLD is NOT DA Difference. An OLD bill is an ordinary salary bill paid in
 *   a later month; a DA Difference bill is a different kind of bill entirely.
 *
 * WHAT DA DIFFERENCE ACTUALLY STORES
 *   dbo.DADifferenceBill            -> the bill, its PaymentSalaryMonth and
 *                                      its From..To arrear period
 *   dbo.DADifferenceEmployeeDetails -> TotalDifferenceAmount, TotalNPSDeduction,
 *                                      TotalNetDifferenceAmount per employee
 *   dbo.DADifferenceMonthDetails    -> per historical month: DifferenceAmount,
 *                                      NPSDeduction, SourceSalaryBillCodeId
 *
 *   There is NO Basic, DA, HRA, TA, CLA, Medical, Gross, GPF, PT, IT or
 *   Cheque Amount on a DA Difference record. Reports built on those columns
 *   therefore cannot list DA Difference rows, and say so explicitly rather
 *   than showing empty cells. Nothing is recalculated here: every figure is
 *   the stored value.
 *
 * PERIOD RULE
 *   A DA Difference record belongs to the month it is PAID in
 *   (DADifferenceBill.PaymentSalaryMonth), which is the salary month for
 *   report purposes. The arrear period (From..To) is carried for display and
 *   traceability, never used as the report period.
 *
 * ELIGIBILITY
 *   DA Difference bills go through dbo.SalaryBillInstituteWorkflow like every
 *   other bill — there is no parallel approval system — so the same
 *   APPROVED/LOCKED rule applies.
 */

const { sql } = require("../db");
const {
  normalizeYearMonth,
  yearMonthKey,
  formatMonthLabel,
} = require("./salaryMonthKey");

/* Canonical values. */
const CATEGORY_REGULAR = "REGULAR";
const CATEGORY_DA_DIFFERENCE = "DA_DIFFERENCE";

/* Labels: concise for grids, full for printed reports. */
const CATEGORY_SHORT = {
  [CATEGORY_REGULAR]: "REGULAR",
  [CATEGORY_DA_DIFFERENCE]: "DA DIFFERENCE",
};

const CATEGORY_LABEL = {
  [CATEGORY_REGULAR]: "REGULAR SALARY",
  [CATEGORY_DA_DIFFERENCE]: "DA DIFFERENCE SALARY",
};

const CATEGORY_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: CATEGORY_REGULAR, label: CATEGORY_LABEL[CATEGORY_REGULAR] },
  { value: CATEGORY_DA_DIFFERENCE, label: CATEGORY_LABEL[CATEGORY_DA_DIFFERENCE] },
];

/**
 * The salary type a caller asked for. Unknown/blank means ALL.
 * Accepts the spellings the UI and the API use.
 */
function parseSalaryCategory(value) {
  const text = String(value == null ? "" : value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!text || text === "ALL") return "ALL";
  if (text === "REGULAR" || text === "REGULAR_SALARY") return CATEGORY_REGULAR;
  if (
    text === "DA_DIFFERENCE" ||
    text === "DA_DIFFERENCE_SALARY" ||
    text === "DIFFERENCE" ||
    text === "DADIFFERENCE"
  ) {
    return CATEGORY_DA_DIFFERENCE;
  }
  return "ALL";
}

/**
 * Classify a bill from the AUTHORITATIVE stored fields — the same test every
 * report's SQL already uses. Never a bill-code prefix.
 */
function categoryOfBill({ billCategory, billType } = {}) {
  const category = String(billCategory == null ? "Salary" : billCategory)
    .trim()
    .toUpperCase();
  const type = String(billType == null ? "" : billType).trim().toUpperCase();
  if (category === "DIFFERENCE" || type === "DA DIFFERENCE") {
    return CATEGORY_DA_DIFFERENCE;
  }
  return CATEGORY_REGULAR;
}

function shortLabel(category) {
  return CATEGORY_SHORT[category] || CATEGORY_SHORT[CATEGORY_REGULAR];
}

function fullLabel(category) {
  return CATEGORY_LABEL[category] || CATEGORY_LABEL[CATEGORY_REGULAR];
}

/** The "Salary Type: ..." line printed on a report header. */
function headerLabel(selected) {
  const category = parseSalaryCategory(selected);
  if (category === "ALL") {
    return `ALL (${CATEGORY_LABEL[CATEGORY_REGULAR]} + ${CATEGORY_LABEL[CATEGORY_DA_DIFFERENCE]})`;
  }
  return CATEGORY_LABEL[category];
}

/**
 * The scope note for a report that structurally cannot list DA Difference
 * rows, so the exclusion is visible rather than silent.
 */
function excludedScopeNote(reason) {
  return `${CATEGORY_LABEL[CATEGORY_REGULAR]} only — ${CATEGORY_LABEL[CATEGORY_DA_DIFFERENCE]} excluded (${reason}).`;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

function monthIndex(parts) {
  if (!parts) return null;
  return parts.year * 12 + parts.month;
}

/**
 * Employee-level DA Difference rows for reports, in ONE set-based query.
 *
 * Shaped to match what the salary reports already consume, so a caller can
 * concatenate these with regular rows: same field names for the fields DA
 * Difference actually has, and nothing invented for the ones it does not.
 */
async function loadDaDifferenceRows() {
  const guard = await sql.query`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.DADifferenceBill', N'U') IS NULL THEN 0 ELSE 1 END AS Bill,
      CASE WHEN OBJECT_ID(N'dbo.DADifferenceEmployeeDetails', N'U') IS NULL THEN 0 ELSE 1 END AS Detail
  `;
  const g = guard.recordset[0] || {};
  if (Number(g.Bill || 0) !== 1 || Number(g.Detail || 0) !== 1) return [];

  const result = await sql.query`
    SELECT
      b.DADifferenceBillId,
      b.SalaryBillCodeId,
      b.BillCode,
      b.PaymentSalaryMonth,
      b.PaymentSalaryMonthNumber,
      b.PaymentSalaryYear,
      b.FromSalaryMonth,
      b.FromSalaryMonthNumber,
      b.FromSalaryYear,
      b.ToSalaryMonth,
      b.ToSalaryMonthNumber,
      b.ToSalaryYear,
      c.BillMonth,
      c.BillCategory,
      c.BillType,
      w.Status               AS WorkflowStatus,
      w.BillNo,
      d.EmployeeId,
      d.EmployeeName,
      d.EmployeeCode,
      d.Designation,
      d.InstituteCode,
      d.TotalDifferenceAmount,
      d.TotalNPSDeduction,
      d.TotalNetDifferenceAmount,
      /*
        Additive only (Bank Copy DA payment type). DisplayOrder is the
        existing dbo.DADifferenceEmployeeDetails column; the bank account is
        the employee's existing EmployeeMaster column. No new column, no
        changed meaning, and no existing selected value is affected.
      */
      d.DisplayOrder,
      em.BankAccountNumber   AS EmployeeBankAccount,
      i.InstituteName,
      i.SectionId,
      sec.SrNo               AS SectionSrNo,
      sec.SectionName,
      em.GPFNPS,
      em.GPFNPSNumber
    FROM dbo.DADifferenceBill b
    INNER JOIN dbo.DADifferenceEmployeeDetails d
      ON d.DADifferenceBillId = b.DADifferenceBillId
    LEFT JOIN dbo.SalaryBillCodes c
      ON c.BillCodeId = b.SalaryBillCodeId
    LEFT JOIN dbo.SalaryBillInstituteWorkflow w
      ON w.SalaryBillCodeId = b.SalaryBillCodeId
     AND w.InstituteCode    = d.InstituteCode
    LEFT JOIN dbo.Institutes i
      ON i.InstituteCode = d.InstituteCode
    LEFT JOIN dbo.Sections sec
      ON sec.SectionId = i.SectionId
    LEFT JOIN dbo.EmployeeMaster em
      ON em.EmployeeId = d.EmployeeId
    WHERE ISNULL(c.IsArchived, 0) = 0
  `;

  return result.recordset.map((row) => {
    /* Period = the month the difference is PAID in. */
    const paidParts = normalizeYearMonth(
      row.PaymentSalaryMonth,
      row.PaymentSalaryYear,
      row.PaymentSalaryMonthNumber
    );
    const fromParts = normalizeYearMonth(
      row.FromSalaryMonth,
      row.FromSalaryYear,
      row.FromSalaryMonthNumber
    );
    const toParts = normalizeYearMonth(
      row.ToSalaryMonth,
      row.ToSalaryYear,
      row.ToSalaryMonthNumber
    );
    const billParts = normalizeYearMonth(
      row.BillMonth,
      row.PaymentSalaryYear,
      null
    );

    return {
      salaryCategory: CATEGORY_DA_DIFFERENCE,
      salaryCategoryLabel: CATEGORY_LABEL[CATEGORY_DA_DIFFERENCE],
      salaryCategoryShort: CATEGORY_SHORT[CATEGORY_DA_DIFFERENCE],

      billCodeId: Number(row.SalaryBillCodeId),
      billCode: row.BillCode || "",
      daDifferenceBillId: Number(row.DADifferenceBillId),
      workflowStatus: String(row.WorkflowStatus || "").trim().toUpperCase(),

      employeeId: Number(row.EmployeeId),
      employeeName: row.EmployeeName || "",
      employeeCode:
        row.EmployeeCode != null && String(row.EmployeeCode).trim() !== ""
          ? String(row.EmployeeCode)
          : String(row.EmployeeId),
      designation: row.Designation || "",
      gpfNps: row.GPFNPS == null ? "" : String(row.GPFNPS).trim(),
      pran: row.GPFNPSNumber == null ? "" : String(row.GPFNPSNumber).trim(),

      instituteCode: row.InstituteCode || "",
      instituteName: row.InstituteName || row.InstituteCode || "",
      sectionId: row.SectionId == null ? null : Number(row.SectionId),
      sectionName: row.SectionName || "",
      sectionSrNo: row.SectionSrNo == null ? null : Number(row.SectionSrNo),

      /* Report period: the payment month. */
      salaryMonth: formatMonthLabel(paidParts) || row.PaymentSalaryMonth || "",
      salaryMonthKey: yearMonthKey(paidParts),
      salaryMonthIndex: monthIndex(paidParts),

      /* Traceability only. */
      paidMonth: formatMonthLabel(billParts) || row.BillMonth || "",
      arrearFrom: formatMonthLabel(fromParts) || "",
      arrearTo: formatMonthLabel(toParts) || "",
      arrearPeriod:
        formatMonthLabel(fromParts) && formatMonthLabel(toParts)
          ? `${formatMonthLabel(fromParts)} to ${formatMonthLabel(toParts)}`
          : "",

      /*
        A DA Difference bill is not an OLD bill. Bill Type stays REGULAR here
        because OLD is about a salary month paid in a later bill month, which
        is a different question from the bill's category.
      */
      type: "REGULAR",

      /* The only money DA Difference actually stores. */
      differenceAmount: round2(row.TotalDifferenceAmount),
      nps: round2(row.TotalNPSDeduction),
      net: round2(row.TotalNetDifferenceAmount),
      amount: round2(row.TotalNetDifferenceAmount),

      /* Components DA Difference has no value for — never invented. */
      gpf: 0,
      gpfAdvance: 0,

      /*
        Additive fields. Existing consumers ignore them; no existing key
        changes name, type or value.
      */
      displayOrder: row.DisplayOrder == null ? null : Number(row.DisplayOrder),
      bankAccount:
        row.EmployeeBankAccount == null ? "" : String(row.EmployeeBankAccount),
    };
  });
}

module.exports = {
  CATEGORY_REGULAR,
  CATEGORY_DA_DIFFERENCE,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  CATEGORY_OPTIONS,
  parseSalaryCategory,
  categoryOfBill,
  shortLabel,
  fullLabel,
  headerLabel,
  excludedScopeNote,
  loadDaDifferenceRows,
};
