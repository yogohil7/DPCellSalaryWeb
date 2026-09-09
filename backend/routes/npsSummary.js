/**
 * NPS SUMMARY  and  NPS INSTITUTE WISE SUMMARY
 *
 * Both read dbo.SalaryEmployeeDetails.NPS — the same stored column the Cheque
 * Register sums as `ISNULL(SUM(d.NPS), 0) AS NPS` — so the three reports agree
 * by construction. No NPS is derived from Basic, Gross or Net.
 *
 * Eligibility, the salary-month period rule, the REGULAR/OLD classification,
 * the Bill Month resolution and the section/institute ordering are all the
 * existing helpers, imported rather than copied:
 *
 *   APPROVED_WORKFLOW_STATUSES   which bills may appear at all
 *   salaryMonthPartsOf           the report period
 *   billMonthPartsOf             each bill's real Bill Month
 *   resolveChequeSalaryType      REGULAR / OLD
 *   compareGroupCodes            natural institute ordering
 */

const express = require("express");
const { sql } = require("../db");
const {
  matchesFilterMonthYear,
  resolveChequeSalaryType,
  billTypeMatchesFilter,
} = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  salaryMonthPartsOf,
  billMonthPartsOf,
  compareGroupCodes,
} = require("./chequeRegister");
const {
  loadDaDifferenceRows,
  CATEGORY_DA_DIFFERENCE,
} = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "NPS SUMMARY";

const MONTH_FULL_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

/**
 * Approved employee salary rows that carry an NPS amount.
 *
 * A row joins the schedule when it actually has NPS, so the employee count
 * stays consistent with the money beside it.
 */
async function loadNpsRows() {
  const result = await sql.query`
    SELECT
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      w.InstituteCode,
      w.Status              AS WorkflowStatus,
      i.InstituteName,
      i.SectionId,
      sec.SrNo              AS SectionSrNo,
      sec.SectionName,
      d.EmployeeId,
      d.EmployeeName,
      d.PensionType,
      d.NPS
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN dbo.SalaryEmployeeDetails d
      ON d.SalaryBillCodeId = w.SalaryBillCodeId
     AND d.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Institutes i
      ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections sec
      ON sec.SectionId = i.SectionId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
      AND ISNULL(d.NPS, 0) <> 0
    ORDER BY sec.SrNo, i.SectionId, w.InstituteCode, d.DisplayOrder
  `;
  return result.recordset;
}

/**
 * DA Difference NPS, in the SAME raw row shape loadNpsRows() returns, so the
 * existing filter, grouping and totals work on it unmodified.
 *
 * The amount is the stored dbo.DADifferenceEmployeeDetails.TotalNPSDeduction
 * — never recalculated. Eligibility is unchanged: the shared APPROVED/LOCKED
 * workflow rule and the non-zero NPS rule are applied exactly as they are to
 * regular salary rows, so an unapproved DA bill is excluded like any other.
 *
 * Period membership is the DA bill's PAYMENT salary month; its Bill Month is
 * carried separately and is never used as the period.
 */
async function loadDaNpsRows() {
  const rows = await loadDaDifferenceRows();
  return rows
    .filter((row) => Number(row.nps || 0) !== 0)
    .map((row) => ({
      BillCode: row.billCode,
      BillMonth: row.paidMonth,
      SalaryMonth: row.salaryMonth,
      SalaryMonthNumber: row.salaryMonthKey
        ? Number(String(row.salaryMonthKey).slice(-2))
        : null,
      SalaryYear: row.salaryMonthKey
        ? String(row.salaryMonthKey).slice(0, 4)
        : null,
      InstituteCode: row.instituteCode,
      WorkflowStatus: row.workflowStatus,
      InstituteName: row.instituteName,
      SectionId: row.sectionId,
      SectionSrNo: row.sectionSrNo,
      SectionName: row.sectionName,
      EmployeeId: row.employeeId,
      EmployeeName: row.employeeName,
      PensionType: null,
      NPS: row.nps,
      /* Carried so a caller can tell the two categories apart. */
      SalaryCategory: CATEGORY_DA_DIFFERENCE,
    }));
}

/**
 * Every eligible NPS row for the period: regular salary plus DA Difference.
 * Regular rows are never removed or duplicated — the two sets come from
 * different tables and are concatenated, not joined.
 */
async function loadAllNpsRows() {
  const [salary, daDifference] = await Promise.all([
    loadNpsRows(),
    loadDaNpsRows(),
  ]);
  return [...salary, ...daDifference];
}

/**
 * Keeps the rows belonging to the selected period.
 *
 * Membership is the SALARY MONTH, exactly as in the Cheque Register, so a
 * June report includes the June bill AND its Bill-Month variants. REGULAR and
 * OLD are both kept — nothing filters on type.
 */
function filterNpsRows(rows, query) {
  const month =
    query.month != null && query.month !== "" ? Number(query.month) : null;
  const year =
    query.year != null && query.year !== "" ? Number(query.year) : null;
  const sectionId =
    query.sectionId != null && query.sectionId !== ""
      ? Number(query.sectionId)
      : null;

  return rows.filter((row) => {
    const status = String(row.WorkflowStatus || "").trim().toUpperCase();
    if (!APPROVED_WORKFLOW_STATUSES.has(status)) return false;

    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.SectionId) !== sectionId) return false;
    }

    if (month != null && year != null) {
      const salaryParts = salaryMonthPartsOf(
        row.SalaryMonth,
        row.SalaryYear,
        row.SalaryMonthNumber
      );
      if (!matchesFilterMonthYear(salaryParts, month, year)) return false;
    }

    return true;
  });
}

/**
 * Salary Type narrowing for the NPS reports.
 *
 * Category and bill type are separate dimensions, so this reads both from the
 * row itself — never from an amount, a bill number or a guess:
 *   DA_DIFFERENCE -> rows tagged SalaryCategory = DA_DIFFERENCE
 *   REGULAR / OLD -> ordinary salary rows, classified by the shared
 *                    resolveChequeSalaryType (salary month vs bill month)
 * ALL keeps every category, so DA Difference can never disappear from the
 * default view.
 */
function filterNpsRowsBySalaryType(rows, rawValue) {
  const wanted = parseSalaryCategoryFilter(rawValue);
  if (wanted === "ALL") return rows;

  return rows.filter((row) => {
    const isDa = row.SalaryCategory === CATEGORY_DA_DIFFERENCE;
    if (wanted === "DA_DIFFERENCE") return isDa;
    if (isDa) return false;

    const billType = resolveChequeSalaryType({
      salaryMonth: row.SalaryMonth,
      billMonth: row.BillMonth,
      salaryYear: row.SalaryYear,
      billYear: row.SalaryYear,
      salaryMonthNumber: row.SalaryMonthNumber,
    });
    /* Regular Salary = REGULAR + OLD for the selected Salary Month; Old
       Salary still narrows to OLD only (utils/salaryMonthKey.js). */
    return billTypeMatchesFilter(wanted, billType);
  });
}

/** ALL | REGULAR | OLD | DA_DIFFERENCE, accepting the UI/API spellings. */
function parseSalaryCategoryFilter(value) {
  const text = String(value == null ? "" : value)
    .trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (text === "REGULAR" || text === "REGULAR_SALARY") return "REGULAR";
  if (text === "OLD" || text === "OLD_SALARY") return "OLD";
  if (text === "DA_DIFFERENCE" || text === "DA_DIFFERENCE_SALARY" || text === "DIFFERENCE") {
    return "DA_DIFFERENCE";
  }
  return "ALL";
}

function sectionRankOf(group) {
  const raw = group?.sectionSrNo;
  if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** One line per section: employees, NPS, and the amount payable. */
function groupNpsBySection(rows) {
  const bySection = new Map();

  for (const row of rows) {
    const key = row.SectionId == null ? "none" : Number(row.SectionId);
    if (!bySection.has(key)) {
      bySection.set(key, {
        sectionId: row.SectionId == null ? null : Number(row.SectionId),
        sectionSrNo: row.SectionSrNo,
        name: row.SectionName || "(no section)",
        employees: new Set(),
        nps: 0,
      });
    }
    const group = bySection.get(key);
    group.employees.add(Number(row.EmployeeId));
    group.nps = round2(group.nps + toNum(row.NPS));
  }

  const ordered = [...bySection.values()].sort((a, b) => {
    const ra = sectionRankOf(a);
    const rb = sectionRankOf(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const idA = a.sectionId == null ? Number.MAX_SAFE_INTEGER : a.sectionId;
    const idB = b.sectionId == null ? Number.MAX_SAFE_INTEGER : b.sectionId;
    if (idA !== idB) return idA < idB ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });

  return ordered.map((group, idx) => ({
    srNo: idx + 1,
    name: group.name,
    emp: group.employees.size,
    nps: group.nps,
    /* NPSAdvance exists but is always 0 in Salary Entry, so Amount is NPS. */
    amount: group.nps,
  }));
}

/**
 * One line per institute PER BILL: Institute Code + Bill Month + Type.
 *
 * An institute with a regular bill and a Bill-Month variant therefore gets
 * two lines, each with its own month, type, count and NPS. They are never
 * merged.
 */
function groupNpsByInstitute(rows) {
  const byBill = new Map();

  for (const row of rows) {
    const code = String(row.InstituteCode || "").trim();
    const billParts = billMonthPartsOf(
      row.BillMonth,
      row.SalaryMonth,
      row.SalaryYear,
      row.SalaryMonthNumber
    );
    const salaryType = resolveChequeSalaryType({
      salaryMonth: row.SalaryMonth,
      billMonth: row.BillMonth,
      salaryYear: row.SalaryYear,
      billYear: row.SalaryYear,
      salaryMonthNumber: row.SalaryMonthNumber,
    });
    const type = salaryType === "OLD" ? "OLD" : "REG";
    const billKey = billParts
      ? `${billParts.year}-${String(billParts.month).padStart(2, "0")}`
      : "";
    const key = `${code}|${billKey}|${type}`;

    if (!byBill.has(key)) {
      byBill.set(key, {
        code,
        instituteName: row.InstituteName || code,
        sectionId: row.SectionId == null ? null : Number(row.SectionId),
        sectionSrNo: row.SectionSrNo,
        sectionName: row.SectionName || "",
        billMonthNumber: billParts ? billParts.month : 0,
        billYear: billParts ? billParts.year : 0,
        month: billParts ? MONTH_FULL_NAMES[billParts.month - 1] : "",
        type,
        employees: new Set(),
        nps: 0,
      });
    }
    const group = byBill.get(key);
    group.employees.add(Number(row.EmployeeId));
    group.nps = round2(group.nps + toNum(row.NPS));
  }

  const ordered = [...byBill.values()].sort((a, b) => {
    const ra = sectionRankOf(a);
    const rb = sectionRankOf(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const idA = a.sectionId == null ? Number.MAX_SAFE_INTEGER : a.sectionId;
    const idB = b.sectionId == null ? Number.MAX_SAFE_INTEGER : b.sectionId;
    if (idA !== idB) return idA < idB ? -1 : 1;

    const byCode = compareGroupCodes(a.code, b.code);
    if (byCode !== 0) return byCode;

    if (a.type !== b.type) return a.type === "REG" ? -1 : 1;
    if (a.billYear !== b.billYear) return b.billYear - a.billYear;
    return b.billMonthNumber - a.billMonthNumber;
  });

  return ordered.map((group, idx) => ({
    srNo: idx + 1,
    code: group.code,
    instituteName: group.instituteName,
    sectionName: group.sectionName,
    month: group.month,
    type: group.type,
    total: group.employees.size,
    nps: group.nps,
    amount: group.nps,
  }));
}

function monthLabelOf(month, year) {
  const monthNum = Number(month);
  return MONTH_FULL_NAMES[monthNum - 1] != null
    ? `${MONTH_FULL_NAMES[monthNum - 1]}-${year}`
    : `${month}-${year}`;
}

function requirePeriod(query) {
  const { month, year } = query;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error("Month and Year are required to show the NPS Summary.");
    err.status = 400;
    throw err;
  }
}

function sectionTitleOf(query, rows) {
  const names = [...new Set(rows.map((r) => r.sectionName).filter(Boolean))];
  return query.sectionId != null && query.sectionId !== "" && names.length === 1
    ? names[0].toUpperCase()
    : "ALL SECTIONS";
}

async function buildNpsSummaryReport(query) {
  requirePeriod(query);
  const eligible = filterNpsRowsBySalaryType(
    filterNpsRows(await loadAllNpsRows(), query),
    query.salaryType || query.table
  );
  const rows = groupNpsBySection(eligible);

  /* Totals are the sum of the displayed rows — never a second query. */
  const total = rows.reduce(
    (acc, row) => ({
      emp: acc.emp + row.emp,
      nps: round2(acc.nps + row.nps),
      amount: round2(acc.amount + row.amount),
    }),
    { emp: 0, nps: 0, amount: 0 }
  );

  return {
    heading: HEADING,
    subHeading: SUBHEADING,
    sectionTitle: sectionTitleOf(query, groupNpsByInstitute(eligible)),
    monthLine: monthLabelOf(query.month, query.year),
    rows,
    total,
    month: Number(query.month),
    year: Number(query.year),
    rowCount: rows.length,
    salaryTime: query.salaryTime == null || query.salaryTime === ""
      ? "1"
      : String(query.salaryTime),
  };
}

async function buildNpsInstituteWiseReport(query) {
  requirePeriod(query);
  const rows = groupNpsByInstitute(
    filterNpsRowsBySalaryType(
      filterNpsRows(await loadAllNpsRows(), query),
      query.salaryType || query.table
    )
  );

  const total = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      nps: round2(acc.nps + row.nps),
      amount: round2(acc.amount + row.amount),
    }),
    { total: 0, nps: 0, amount: 0 }
  );

  return {
    heading: HEADING,
    subHeading: SUBHEADING,
    sectionTitle: sectionTitleOf(query, rows),
    monthLine: monthLabelOf(query.month, query.year),
    rows,
    total,
    month: Number(query.month),
    year: Number(query.year),
    rowCount: rows.length,
    salaryTime: query.salaryTime == null || query.salaryTime === ""
      ? "1"
      : String(query.salaryTime),
  };
}

function sendReport(builder) {
  return async (req, res) => {
    try {
      const data = await builder(req.query || {});
      res.json({ message: "OK", data });
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error("GET /api/nps-summary error:", error);
      res.status(status).json({ message: error.message || "NPS Summary failed." });
    }
  };
}

/* GET /api/nps-summary?sectionId=&month=&year=&salaryTime= */
router.get("/", sendReport(buildNpsSummaryReport));
/* GET /api/nps-summary/institute-wise?... */
router.get("/institute-wise", sendReport(buildNpsInstituteWiseReport));

const SUMMARY_XLSX_COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "name", label: "NAME" },
  { key: "emp", label: "EMP", type: "number" },
  { key: "nps", label: "N.P.S.", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
];

const INSTITUTE_XLSX_COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "code", label: "Code No." },
  { key: "instituteName", label: "Institute Name" },
  { key: "month", label: "Month" },
  { key: "type", label: "Type" },
  { key: "total", label: "Total", type: "number" },
  { key: "nps", label: "N.P.S.", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
];

function excelHandler(builder, columns, sheetName, filePrefix) {
  return async (req, res) => {
    try {
      const XLSX = require("xlsx");
      const data = await builder(req.query || {});

      const heading = [
        [data.sectionTitle], [data.heading], [data.monthLine], [data.subHeading], [],
      ];
      const header = columns.map((c) => c.label);
      const body = data.rows.map((row) =>
        columns.map((column) => {
          const value = row[column.key];
          if (column.type === "number") return Number(value || 0);
          return value == null ? "" : String(value);
        })
      );

      const totalsRow = [];
      if (data.rows.length > 0) {
        columns.forEach((column) => {
          if (column.key === "srNo") totalsRow.push("TOTAL");
          else if (column.type === "number") {
            totalsRow.push(Number(data.total[column.key] || 0));
          } else totalsRow.push("");
        });
      }

      const sheet = XLSX.utils.aoa_to_sheet([
        ...heading, header, ...body,
        ...(totalsRow.length ? [totalsRow] : []),
      ]);

      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, sheetName);
      const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
      const fileName = `${filePrefix}_${data.monthLine.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error("NPS export error:", error);
      res.status(status).json({ message: error.message || "Export failed." });
    }
  };
}

router.get("/export.xlsx",
  excelHandler(buildNpsSummaryReport, SUMMARY_XLSX_COLUMNS, "NPS Summary", "NPS_Summary"));
router.get("/institute-wise/export.xlsx",
  excelHandler(buildNpsInstituteWiseReport, INSTITUTE_XLSX_COLUMNS,
    "NPS Institute Wise", "NPS_Institute_Wise"));

module.exports = router;
/* Exported for offline tests (scripts/testNpsSummary.js). */
module.exports.loadNpsRows = loadNpsRows;
module.exports.filterNpsRows = filterNpsRows;
module.exports.loadDaNpsRows = loadDaNpsRows;
module.exports.loadAllNpsRows = loadAllNpsRows;
module.exports.filterNpsRowsBySalaryType = filterNpsRowsBySalaryType;
module.exports.parseSalaryCategoryFilter = parseSalaryCategoryFilter;
module.exports.groupNpsBySection = groupNpsBySection;
module.exports.groupNpsByInstitute = groupNpsByInstitute;
module.exports.buildNpsSummaryReport = buildNpsSummaryReport;
module.exports.buildNpsInstituteWiseReport = buildNpsInstituteWiseReport;
module.exports.SUMMARY_XLSX_COLUMNS = SUMMARY_XLSX_COLUMNS;
module.exports.INSTITUTE_XLSX_COLUMNS = INSTITUTE_XLSX_COLUMNS;
