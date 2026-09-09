/**
 * NPS / GPF DEDUCTION REPORT
 *
 * Employee-wise, month-wise GPF and NPS deductions. This is a reporting /
 * reconciliation screen only: nothing here writes, and no money value is
 * recalculated. Every figure is the STORED value from
 * dbo.SalaryEmployeeDetails, which is the same source of truth the GPF
 * Summary, NPS Summary, Cheque Register and Bank Copy already read:
 *
 *   GPF Deduction = d.GPFSubscription + d.GPFAdvance
 *                   (the same pair GPF Summary shows as "G.P.F." and
 *                    "G.P.F.Adv" and totals in its "TOTAL" column, so this
 *                    report's GPF total reconciles with that report)
 *   NPS Deduction = d.NPS
 *                   (identical to NPS Summary's stored field)
 *
 * NO SECOND QUERY: the rows come from loadEmployeeSalaryRows() in
 * employeeWiseSalary.js — one set-based query that already joins
 * SalaryBillCodes / SalaryBillInstituteWorkflow / SalaryEmployeeDetails /
 * Institutes / Sections / EmployeeMaster / Designations and already applies
 * the shared reporting rules:
 *
 *   - only APPROVED / LOCKED institute workflow rows
 *   - DA-Difference bills excluded (BillCategory DIFFERENCE / BillType
 *     DA DIFFERENCE), exactly as the GPF and NPS summaries exclude them
 *   - archived bills excluded
 *   - period membership is the SALARY MONTH, never the Bill Month
 *   - REGULAR vs OLD via the shared resolveChequeSalaryType helper
 *
 * The Bill Month is carried on every row as its own column so a REGULAR and
 * an OLD bill for the same salary month stay separately traceable — they are
 * distinct stored deductions and are never merged into one row.
 */

const express = require("express");
const XLSX = require("xlsx");

const {
  loadEmployeeSalaryRows,
  mapSalaryRow,
  filterSalaryRows,
} = require("./employeeWiseSalary");
const { compareGroupCodes } = require("./chequeRegister");
const {
  CATEGORY_REGULAR,
  CATEGORY_DA_DIFFERENCE,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  parseSalaryCategory,
  headerLabel,
  loadDaDifferenceRows,
} = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "NPS / GPF DEDUCTION REPORT";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

/**
 * One deduction row per stored (bill, employee) row.
 *
 * `gpfDeduction` deliberately sums subscription + advance so that the total
 * of this column equals the GPF Summary "TOTAL" column for the same period.
 * Both components are also returned so nothing is hidden from the caller.
 */
function toDeductionRow(raw) {
  const base = mapSalaryRow(raw);
  const gpf = round2(base.gpf);
  const gpfAdvance = round2(base.gpfAdvance);
  const nps = round2(base.nps);
  const gpfDeduction = round2(gpf + gpfAdvance);

  return {
    ...base,
    /* Salary Category is the bill's category, never a code prefix, and is a
       different dimension from Bill Type (REGULAR / OLD). */
    salaryCategory: CATEGORY_REGULAR,
    salaryCategoryLabel: CATEGORY_LABEL[CATEGORY_REGULAR],
    salaryCategoryShort: CATEGORY_SHORT[CATEGORY_REGULAR],
    /* Fields mapSalaryRow does not carry, taken from the same query row. */
    designation: raw.MasterDesignationName || raw.Designation || "",
    sectionSrNo:
      raw.SectionSrNo == null || raw.SectionSrNo === ""
        ? null
        : Number(raw.SectionSrNo),
    billMonth: base.paidMonth,
    billType: base.type,
    gpfSubscription: gpf,
    gpfAdvance,
    gpfDeduction,
    npsDeduction: nps,
    totalDeduction: round2(gpfDeduction + nps),
  };
}

/**
 * Zero-deduction rule (§14): the GPF Summary keeps a row when subscription
 * or advance is non-zero, the NPS Summary keeps a row when NPS is non-zero.
 * The combined report therefore keeps a row when EITHER side is non-zero,
 * and drops rows where both are zero — those carry no deduction to report.
 */
function hasDeduction(row) {
  return toNum(row.gpfDeduction) !== 0 || toNum(row.npsDeduction) !== 0;
}

/**
 * Deduction-type selection: ALL (default) keeps every row that carries any
 * deduction, GPF keeps only rows with a GPF deduction, NPS only rows with an
 * NPS deduction. This narrows WHICH ROWS are listed; it never changes a
 * stored value, and the columns stay the same in every mode.
 */
function parseDeductionType(value) {
  const text = String(value == null ? "" : value).trim().toUpperCase();
  if (text === "GPF") return "GPF";
  if (text === "NPS") return "NPS";
  return "ALL";
}

function filterByDeductionType(rows, value) {
  const type = parseDeductionType(value);
  if (type === "GPF") return rows.filter((row) => toNum(row.gpfDeduction) !== 0);
  if (type === "NPS") return rows.filter((row) => toNum(row.npsDeduction) !== 0);
  return rows;
}

/**
 * Section order is the department's official order (dbo.Sections.SrNo), not
 * a string prefix; institute codes sort naturally (CPD-06 < CPD-17 < CPD-100)
 * via the shared compareGroupCodes; months sort chronologically by their
 * numeric month index, never as text.
 */
function sectionRank(row) {
  if (row.sectionSrNo != null) return row.sectionSrNo;
  if (row.sectionId != null) return Number(row.sectionId) + 100000;
  return Number.MAX_SAFE_INTEGER;
}

function compareDeductionRows(a, b) {
  const ar = sectionRank(a);
  const br = sectionRank(b);
  if (ar !== br) return ar - br;

  const codes = compareGroupCodes(a.instituteCode || "", b.instituteCode || "");
  if (codes !== 0) return codes;

  const names = String(a.employeeName || "").localeCompare(
    String(b.employeeName || "")
  );
  if (names !== 0) return names;

  if (a.employeeId !== b.employeeId) return a.employeeId - b.employeeId;

  const ai = a.salaryMonthIndex != null ? a.salaryMonthIndex : 0;
  const bi = b.salaryMonthIndex != null ? b.salaryMonthIndex : 0;
  if (ai !== bi) return ai - bi;

  if (a.billType !== b.billType) return a.billType === "REGULAR" ? -1 : 1;
  return String(a.billCode || "").localeCompare(String(b.billCode || ""));
}

/** Institute filter — exact stored code, no prefix logic. */
function filterByInstitute(rows, instituteCode) {
  const code = String(instituteCode == null ? "" : instituteCode).trim();
  if (!code || code.toUpperCase() === "ALL") return rows;
  return rows.filter(
    (row) => String(row.instituteCode || "").trim() === code
  );
}

function emptyTotals() {
  return { gpfDeduction: 0, npsDeduction: 0, totalDeduction: 0 };
}

/**
 * Category totals. When ALL is selected the two categories are reported
 * separately as well as together, so DA Difference can never inflate the
 * Regular Salary total.
 */
function sumTotalsByCategory(rows) {
  const regular = sumTotals(
    rows.filter((r) => r.salaryCategory !== CATEGORY_DA_DIFFERENCE)
  );
  const daDifference = sumTotals(
    rows.filter((r) => r.salaryCategory === CATEGORY_DA_DIFFERENCE)
  );
  return { regular, daDifference, grand: sumTotals(rows) };
}

function sumTotals(rows) {
  return rows.reduce((totals, row) => {
    totals.gpfDeduction = round2(totals.gpfDeduction + toNum(row.gpfDeduction));
    totals.npsDeduction = round2(totals.npsDeduction + toNum(row.npsDeduction));
    totals.totalDeduction = round2(
      totals.totalDeduction + toNum(row.totalDeduction)
    );
    return totals;
  }, emptyTotals());
}

/** Employee-wise subtotal blocks (§10), in the same order as the rows. */
function buildEmployeeTotals(rows) {
  const order = [];
  const byKey = new Map();
  rows.forEach((row) => {
    const key = `${row.employeeId}|${row.instituteCode}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        employeeId: row.employeeId,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        instituteCode: row.instituteCode,
        instituteName: row.instituteName,
        months: 0,
        ...emptyTotals(),
      });
      order.push(key);
    }
    const bucket = byKey.get(key);
    bucket.months += 1;
    bucket.gpfDeduction = round2(bucket.gpfDeduction + toNum(row.gpfDeduction));
    bucket.npsDeduction = round2(bucket.npsDeduction + toNum(row.npsDeduction));
    bucket.totalDeduction = round2(
      bucket.totalDeduction + toNum(row.totalDeduction)
    );
  });
  return order.map((key) => byKey.get(key));
}

/**
 * The whole report, built from ONE database read.
 * `query` accepts the same filter parameters the Employee Wise Salary report
 * accepts (sectionId, employeeId, month range or allMonths, salaryType) plus
 * instituteCode.
 */
/**
 * A DA Difference row in this report's shape. DA Difference carries an NPS
 * deduction but has NO GPF value at all, so GPF is a true zero here rather
 * than a missing number, and such a row survives the zero rule only on its
 * NPS side.
 */
function daRowToDeductionRow(row) {
  return {
    ...row,
    billMonth: row.paidMonth,
    billType: row.type,
    designation: row.designation || "",
    gpfSubscription: 0,
    gpfAdvance: 0,
    gpfDeduction: 0,
    npsDeduction: round2(row.nps),
    totalDeduction: round2(row.nps),
  };
}

async function buildNpsGpfDeductionReport(query = {}) {
  const category = parseSalaryCategory(query.salaryCategory || query.categoryType);

  const [raws, daRaws] = await Promise.all([
    loadEmployeeSalaryRows(),
    category === CATEGORY_REGULAR ? Promise.resolve([]) : loadDaDifferenceRows(),
  ]);

  const regular = category === CATEGORY_DA_DIFFERENCE ? [] : raws.map(toDeductionRow);
  const daRows = daRaws.map(daRowToDeductionRow);
  const mapped = [...regular, ...daRows];

  /* Shared status / DA-Difference / archived / salary-month-period filter. */
  const scoped = filterSalaryRows(mapped, query);
  const withInstitute = filterByInstitute(scoped, query.instituteCode);
  const withDeduction = withInstitute.filter(hasDeduction);
  const rows = filterByDeductionType(withDeduction, query.deductionType)
    .sort(compareDeductionRows);

  const numbered = rows.map((row, index) => ({ ...row, srNo: index + 1 }));

  const byCategory = sumTotalsByCategory(numbered);

  return {
    heading: HEADING,
    subHeading: SUBHEADING,
    salaryCategory: category,
    salaryCategoryLabel: headerLabel(category),
    rows: numbered,
    employeeTotals: buildEmployeeTotals(numbered),
    totals: byCategory.grand,
    categoryTotals: byCategory,
    rowCount: numbered.length,
  };
}

const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "employeeCode", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "sectionName", label: "Section" },
  { key: "instituteCode", label: "Institute Code" },
  { key: "instituteName", label: "Institute Name" },
  { key: "salaryMonth", label: "Salary Month" },
  { key: "billMonth", label: "Bill Month" },
  { key: "billType", label: "Bill Type" },
  { key: "salaryCategoryShort", label: "Salary Type" },
  { key: "gpfDeduction", label: "GPF Deduction", type: "number" },
  { key: "npsDeduction", label: "NPS Deduction", type: "number" },
  { key: "totalDeduction", label: "Total Deduction", type: "number" },
];

async function sendReport(req, res) {
  try {
    const report = await buildNpsGpfDeductionReport(req.query || {});
    res.json({ message: "OK", data: report });
  } catch (error) {
    console.error("GET /api/nps-gpf-deduction error:", error);
    res.status(500).json({
      message: "Unable to load the NPS / GPF Deduction Report.",
      error: error.message,
    });
  }
}

router.get("/", sendReport);

router.get("/export.xlsx", async (req, res) => {
  try {
    const report = await buildNpsGpfDeductionReport(req.query || {});
    const aoa = [XLSX_COLUMNS.map((c) => c.label)];
    report.rows.forEach((row) => {
      aoa.push(
        XLSX_COLUMNS.map((c) =>
          c.type === "number" ? Number(row[c.key] || 0) : row[c.key] ?? ""
        )
      );
    });
    aoa.push([
      "TOTAL", "", "", "", "", "", "", "", "", "",
      Number(report.totals.gpfDeduction || 0),
      Number(report.totals.npsDeduction || 0),
      Number(report.totals.totalDeduction || 0),
    ]);

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "NPS GPF Deduction");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="NPS GPF Deduction Report.xlsx"'
    );
    res.send(buffer);
  } catch (error) {
    console.error("GET /api/nps-gpf-deduction/export.xlsx error:", error);
    res.status(500).json({
      message: "Unable to export the NPS / GPF Deduction Report.",
      error: error.message,
    });
  }
});

module.exports = router;

/* Exported for offline tests (scripts/testNpsGpfDeduction.js). */
module.exports.toDeductionRow = toDeductionRow;
module.exports.hasDeduction = hasDeduction;
module.exports.compareDeductionRows = compareDeductionRows;
module.exports.filterByInstitute = filterByInstitute;
module.exports.filterByDeductionType = filterByDeductionType;
module.exports.parseDeductionType = parseDeductionType;
module.exports.buildEmployeeTotals = buildEmployeeTotals;
module.exports.sumTotals = sumTotals;
module.exports.buildNpsGpfDeductionReport = buildNpsGpfDeductionReport;
module.exports.daRowToDeductionRow = daRowToDeductionRow;
module.exports.sumTotalsByCategory = sumTotalsByCategory;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
