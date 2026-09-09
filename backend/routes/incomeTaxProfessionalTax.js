/**
 * INCOME TAX & PROFESSIONAL TAX
 *
 * Employee-wise Income Tax and Professional Tax actually deducted. This is a
 * reporting / reconciliation screen only: nothing here writes, and no money
 * value is recalculated. Both figures are the STORED values from
 * dbo.SalaryEmployeeDetails — the same columns the Cheque Register, Institute
 * Wise Salary, Employee Wise Salary and the Employee Pay Slip already read:
 *
 *   Income Tax        = d.IncomeTax
 *   Professional Tax  = d.ProfessionalTax
 *
 * The Total column is the DISPLAY SUM of those two stored values. It is
 * deliberately NOT dbo.SalaryEmployeeDetails.TotalDeduction, which is a
 * different stored column covering every deduction (GPF, GPF Advance, NPS,
 * Other Deduction as well as IT and PT). Reading TotalDeduction here would
 * overstate the tax figure, so this module never touches it.
 *
 * NO SECOND QUERY: rows come from loadEmployeeSalaryRows() in
 * employeeWiseSalary.js — one set-based, parameter-free query that already
 * joins SalaryBillCodes / SalaryBillInstituteWorkflow / SalaryEmployeeDetails
 * / Institutes / Sections / EmployeeMaster / Designations and already applies
 * the shared reporting rules in SQL:
 *
 *   - only APPROVED / LOCKED institute workflow rows
 *   - archived bills excluded  (ISNULL(b.IsArchived, 0) = 0)
 *   - DA-Difference bills excluded
 *   - period membership is the SALARY MONTH, never the Bill Month
 *   - REGULAR vs OLD via the shared resolveChequeSalaryType helper
 *
 * DA DIFFERENCE IS EXCLUDED, DELIBERATELY AND VISIBLY.
 * dbo.DADifferenceEmployeeDetails has no IncomeTax and no ProfessionalTax
 * column — it stores only TotalDifferenceAmount, TotalNPSDeduction and
 * TotalNetDifferenceAmount. Listing DA rows at 0.00 would assert a zero tax
 * that was never recorded, so DA bills produce no row at all and the report
 * states the exclusion in its own scope note.
 *
 * The Bill Month is carried as its own column and its own filter, so a
 * REGULAR and an OLD bill for the same salary month stay separately
 * traceable and are never merged.
 */

const express = require("express");

const {
  loadEmployeeSalaryRows,
  mapSalaryRow,
  filterSalaryRows,
} = require("./employeeWiseSalary");
const { compareGroupCodes, billMonthPartsOf } = require("./chequeRegister");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "INCOME TAX & PROFESSIONAL TAX";
const SCOPE_NOTE =
  "DA Difference bills are excluded because Income Tax and " +
  "Professional Tax are not stored for DA Difference.";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

/**
 * One tax row per stored (bill, employee) row.
 *
 * Both amounts pass straight through from their stored columns; only the
 * display Total is derived, and only from those two.
 */
function toTaxRow(raw) {
  const base = mapSalaryRow(raw);
  const incomeTax = round2(base.incomeTax);
  const professionalTax = round2(base.professionalTax);

  return {
    ...base,
    /* Fields mapSalaryRow does not carry, taken from the same query row. */
    designation: raw.MasterDesignationName || raw.Designation || "",
    sectionSrNo:
      raw.SectionSrNo == null || raw.SectionSrNo === ""
        ? null
        : Number(raw.SectionSrNo),
    /* Bill Month, resolved by its own parser and kept separate from the
       salary month. Its index is what the Bill Month filter compares. */
    billMonth: base.paidMonth,
    billMonthIndex: (() => {
      const parts = billMonthPartsOf(
        raw.BillMonth, raw.SalaryMonth, raw.SalaryYear, raw.SalaryMonthNumber
      );
      return parts ? parts.year * 12 + parts.month : null;
    })(),
    billType: base.type,
    /* Every salary bill in this report is the REGULAR salary category; DA
       Difference never reaches here. Shown so the column is never ambiguous. */
    salaryTypeLabel: base.type,

    incomeTax,
    professionalTax,
    /*
       DISPLAY SUM of the two stored taxes. NOT base.totalDeduction, which
       also contains GPF, GPF Advance, NPS and Other Deduction.
    */
    total: round2(incomeTax + professionalTax),
  };
}

/**
 * Zero-row rule: a row is kept when EITHER tax is non-zero, and dropped when
 * both are zero — those carry no tax to report. This follows the NPS / GPF
 * Deduction report, which keeps a row when either of its two deductions is
 * non-zero.
 */
function hasTax(row) {
  return toNum(row.incomeTax) !== 0 || toNum(row.professionalTax) !== 0;
}

/**
 * Deduction-type selection: ALL (default) keeps every row carrying either
 * tax, INCOME_TAX keeps only rows with Income Tax, PROFESSIONAL_TAX only rows
 * with Professional Tax. This narrows WHICH ROWS are listed; it never changes
 * a stored value, and the columns stay the same in every mode.
 */
function parseDeductionType(value) {
  const text = String(value == null ? "" : value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (text === "INCOME_TAX" || text === "IT") return "INCOME_TAX";
  if (text === "PROFESSIONAL_TAX" || text === "PT") return "PROFESSIONAL_TAX";
  return "ALL";
}

function filterByDeductionType(rows, value) {
  const type = parseDeductionType(value);
  if (type === "INCOME_TAX") {
    return rows.filter((row) => toNum(row.incomeTax) !== 0);
  }
  if (type === "PROFESSIONAL_TAX") {
    return rows.filter((row) => toNum(row.professionalTax) !== 0);
  }
  return rows;
}

/** Institute filter — exact stored code, no prefix logic. */
function filterByInstitute(rows, instituteCode) {
  const code = String(instituteCode == null ? "" : instituteCode).trim();
  if (!code || code.toUpperCase() === "ALL") return rows;
  return rows.filter((row) => String(row.instituteCode || "").trim() === code);
}

/**
 * Bill Month filter — independent of the report period.
 *
 * The period is the SALARY month; this narrows by the month the bill was
 * actually passed in, so a Bill Month JUL-2026 / Salary Month AUG-2026 bill
 * stays exactly distinguishable. Blank means every bill month.
 */
function filterByBillMonth(rows, billMonth, billYear) {
  const month = Number(billMonth);
  const year = Number(billYear);
  if (!Number.isFinite(month) || month < 1 || month > 12) return rows;
  if (!Number.isFinite(year) || year < 1900) return rows;
  const index = year * 12 + month;
  return rows.filter((row) => row.billMonthIndex === index);
}

function sectionRank(row) {
  if (row.sectionSrNo != null) return row.sectionSrNo;
  if (row.sectionId != null) return Number(row.sectionId) + 100000;
  return Number.MAX_SAFE_INTEGER;
}

function compareTaxRows(a, b) {
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

  /* REGULAR and OLD are separate rows and keep a stable order. */
  if (a.billType !== b.billType) return a.billType === "REGULAR" ? -1 : 1;
  return String(a.billCode || "").localeCompare(String(b.billCode || ""));
}

/**
 * The report.
 *
 * Used by BOTH the JSON route and the .xlsx export, so the screen and the
 * file can never present different figures.
 */
async function buildIncomeTaxProfessionalTaxReport(query = {}) {
  const raws = await loadEmployeeSalaryRows();

  const mapped = raws.map(toTaxRow);

  /* Shared status / archived / SALARY-MONTH-period / salary-type filter. */
  const scoped = filterSalaryRows(mapped, query);

  const withTax = scoped.filter(hasTax);

  const rows = filterByDeductionType(
    filterByBillMonth(
      filterByInstitute(withTax, query.instituteCode),
      query.billMonth,
      query.billYear != null && query.billYear !== "" ? query.billYear : query.year
    ),
    query.deductionType
  ).sort(compareTaxRows);

  const numbered = rows.map((row, index) => ({ ...row, srNo: index + 1 }));

  /* Totals are of the DISPLAYED rows, after every filter and the zero-row
     removal. The report Total is IT + PT — never SUM(TotalDeduction). */
  const totals = numbered.reduce(
    (acc, row) => ({
      incomeTax: round2(acc.incomeTax + toNum(row.incomeTax)),
      professionalTax: round2(
        acc.professionalTax + toNum(row.professionalTax)
      ),
      total: round2(acc.total + toNum(row.total)),
    }),
    { incomeTax: 0, professionalTax: 0, total: 0 }
  );

  const employeeCount = new Set(numbered.map((row) => row.employeeId)).size;

  return {
    heading: HEADING,
    subHeading: SUBHEADING,
    scopeNote: SCOPE_NOTE,
    rows: numbered,
    rowCount: numbered.length,
    employeeCount,
    totals,
    filters: {
      month: query.month != null && query.month !== "" ? Number(query.month) : null,
      year: query.year != null && query.year !== "" ? Number(query.year) : null,
      billMonth:
        query.billMonth != null && query.billMonth !== ""
          ? Number(query.billMonth)
          : null,
      sectionId:
        query.sectionId != null && query.sectionId !== ""
          ? Number(query.sectionId)
          : null,
      instituteCode: String(query.instituteCode || "").trim() || null,
      salaryType: String(query.salaryType || "ALL").trim().toUpperCase(),
      deductionType: parseDeductionType(query.deductionType),
    },
  };
}

/* The fourteen printed columns, in order. */
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
  { key: "salaryTypeLabel", label: "Salary Type" },
  { key: "incomeTax", label: "Income Tax", type: "number" },
  { key: "professionalTax", label: "Professional Tax", type: "number" },
  { key: "total", label: "Total", type: "number" },
];

/* GET /api/income-tax-professional-tax */
router.get("/", async (req, res) => {
  try {
    const data = await buildIncomeTaxProfessionalTaxReport(req.query || {});
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/income-tax-professional-tax error:", error);
    res.status(500).json({
      message: "Unable to load the Income Tax & Professional Tax report.",
      error: error.message,
    });
  }
});

/* GET /api/income-tax-professional-tax/export.xlsx — the SAME builder. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildIncomeTaxProfessionalTaxReport(req.query || {});

    const heading = [
      [data.heading],
      [data.subHeading],
      [`Salary Type: ${data.filters.salaryType}`],
      [`Deduction Type: ${data.filters.deductionType}`],
      [data.scopeNote],
      [],
    ];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) =>
      XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      })
    );

    /* The same totals the screen foots. */
    const totalsRow = [];
    if (data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column) => {
        if (column.key === "employeeName") totalsRow.push("TOTAL");
        else if (column.key === "incomeTax") {
          totalsRow.push(Number(data.totals.incomeTax));
        } else if (column.key === "professionalTax") {
          totalsRow.push(Number(data.totals.professionalTax));
        } else if (column.key === "total") {
          totalsRow.push(Number(data.totals.total));
        } else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = XLSX_COLUMNS.map((c) =>
      c.key === "employeeName" || c.key === "instituteName"
        ? { wch: 30 }
        : { wch: 15 }
    );

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Income Tax & Prof Tax");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Income_Tax_Professional_Tax.xlsx"'
    );
    res.send(buffer);
  } catch (error) {
    console.error(
      "GET /api/income-tax-professional-tax/export.xlsx error:",
      error
    );
    res.status(500).json({
      message: "Unable to export the Income Tax & Professional Tax report.",
      error: error.message,
    });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testIncomeTaxProfessionalTax.js). */
module.exports.buildIncomeTaxProfessionalTaxReport =
  buildIncomeTaxProfessionalTaxReport;
module.exports.toTaxRow = toTaxRow;
module.exports.hasTax = hasTax;
module.exports.parseDeductionType = parseDeductionType;
module.exports.filterByDeductionType = filterByDeductionType;
module.exports.filterByInstitute = filterByInstitute;
module.exports.filterByBillMonth = filterByBillMonth;
module.exports.compareTaxRows = compareTaxRows;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
module.exports.SCOPE_NOTE = SCOPE_NOTE;
