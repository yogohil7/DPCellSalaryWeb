/**
 * MONTH-WISE EMPLOYEE SALARY REPORT
 *
 * A flat, employee-wise listing of every approved/locked salary row of ONE
 * selected Salary Month, across every institute (or a chosen section /
 * institute), with an "Institute Total" subtotal after each institute and a
 * Grand Total at the end — the same flat "rows + subtotal + grand total"
 * shape Bank Copy already uses (type-discriminated rows, dense Sr. No. over
 * the real data rows only), applied here to salary components instead of
 * bank credits.
 *
 * This module computes NO salary. Every money value is the STORED
 * dbo.SalaryEmployeeDetails / dbo.SalaryEntryBillEmployeeDetails value Salary
 * Entry wrote and Salary Bill Approval displayed (via the shared
 * instanceEmployeeRowsSql() every other report reuses) — nothing is
 * recalculated, and the recently added retirement GPF/NPS stop rule is not
 * re-applied here: whatever was saved (zero, because the rule fired, or a
 * pre-existing amount on an old locked bill) is shown exactly as saved.
 *
 * Shared rules are imported, never copied:
 *   instanceEmployeeRowsSql / instanceBillMonthSelectSql   bill-instance grain
 *   APPROVED_WORKFLOW_STATUSES     which bills may appear at all
 *   compareGroupCodes              natural Institute Code ordering
 *   salaryMonthPartsOf / matchesFilterMonthYear   SALARY MONTH period (never
 *     Bill Month) — the same rule Salary Register and Bank Copy apply
 *   resolveChequeSalaryType / billTypeMatchesFilter   REGULAR vs OLD
 *
 * Columns and their SOURCE (nothing invented — see the column-by-column
 * comments on mapEmployeeRow below):
 *   dbo.SalaryEmployeeDetails / SalaryEntryBillEmployeeDetails (via
 *     INSTANCE_EMPLOYEE_COLUMNS): BasicPay, GradePay, TotalBasic, DA, HRA,
 *     MA, TA, CLA, SpecialAllowance, WashingAllowance, GrossSalary,
 *     GPFSubscription, GPFAdvance, NPS, IncomeTax, ProfessionalTax,
 *     OtherDeduction, TotalDeduction, NetSalary, ChequeAmount, Designation
 *   dbo.Institutes / dbo.Sections: InstituteName, SectionId, SectionName
 *   dbo.Designations: a designation-name fallback only (the stored
 *     Designation snapshot on the salary row is preferred, same rule
 *     Employee Wise Salary and Salary Register's detail view use)
 * There is no PAN column anywhere in this schema (confirmed while building
 * the Salary Register drill-down, 2026-09-25), so none is shown or invented.
 */

const express = require("express");
const { sql } = require("../db");
const {
  instanceEmployeeRowsSql,
  instanceBillMonthPartsOf,
  instanceBillMonthSelectSql,
  queryReport,
} = require("../utils/reportBillInstance");
const {
  formatMonthLabel,
  matchesFilterMonthYear,
  billTypeMatchesFilter,
} = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  resolveChequeSalaryType,
  compareGroupCodes,
  salaryMonthPartsOf,
} = require("./chequeRegister");

const router = express.Router();

const HEADING = [
  "DIRECTOR OF SOCIAL DEFENCE",
  "BLOCK NO. 16",
  "SACHIVALAY, GANDHINAGAR",
];
const TITLE = "MONTH-WISE EMPLOYEE SALARY REPORT";

const MONTH_FULL_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/* Safety cap, same convention as Employee Wise Salary / Institute Wise Salary. */
const MAX_ROWS = 5000;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

function toIntOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function monthLabel(parts) {
  if (!parts) return "";
  return `${MONTH_FULL_NAMES[parts.month - 1]} ${parts.year}`;
}

/**
 * Approved employee salary rows for every institute, one row per (bill
 * instance, employee) — the same grain Salary Entry stored and every other
 * report in this project reuses via instanceEmployeeRowsSql(). Filtering by
 * Salary Month, Bill Month, Section, Institute and Salary Type all happen in
 * JS afterwards (see filterMonthWiseRows), exactly like Salary Register and
 * Bank Copy — no user value is ever concatenated into this SQL.
 */
async function loadMonthWiseRows() {
  const result = await queryReport(`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      w.WorkflowId,
      ${instanceBillMonthSelectSql("b", "w")},
      w.InstituteCode,
      w.Status               AS WorkflowStatus,
      i.InstituteName,
      i.SectionId,
      sec.SrNo               AS SectionSrNo,
      sec.SectionName,
      d.Id                   AS DetailId,
      d.EmployeeId,
      d.EmployeeName,
      d.Designation,
      d.DisplayOrder,
      d.BasicPay,
      d.GradePay,
      d.TotalBasic,
      d.DA,
      d.HRA,
      d.MA,
      d.TA,
      ISNULL(d.CLA, 0)       AS CLA,
      d.SpecialAllowance,
      d.WashingAllowance,
      d.GrossSalary,
      d.GPFSubscription,
      d.GPFAdvance,
      d.NPS,
      d.IncomeTax,
      d.ProfessionalTax,
      d.OtherDeduction,
      d.TotalDeduction,
      d.NetSalary,
      d.ChequeAmount,
      des.DesignationName    AS MasterDesignationName
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN ${instanceEmployeeRowsSql()} d
      ON d.InstanceWorkflowId = w.WorkflowId
    LEFT JOIN dbo.Institutes i
      ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections sec
      ON sec.SectionId = i.SectionId
    LEFT JOIN dbo.EmployeeMaster em
      ON em.EmployeeId = d.EmployeeId
    LEFT JOIN dbo.Designations des
      ON des.DesignationId = em.DesignationId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
    ORDER BY w.InstituteCode, b.SalaryYear, b.SalaryMonthNumber, d.DisplayOrder, d.Id
  `);
  return result.recordset;
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

async function loadInstitutes() {
  const result = await sql.query`
    SELECT i.InstituteId, i.InstituteCode, i.InstituteName, i.SectionId
    FROM dbo.Institutes i
    ORDER BY i.InstituteCode
  `;
  return result.recordset.map((row) => ({
    instituteId: Number(row.InstituteId),
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || "",
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
  }));
}

/**
 * One stored salary row -> one report row. Every field below is a straight
 * read of a stored column (see the module doc comment); "Total" is the
 * stored GrossSalary, never a sum of the components displayed beside it.
 */
function mapEmployeeRow(row, headers) {
  const headerMap = headers instanceof Map ? headers : new Map();
  const salaryYm = salaryMonthPartsOf(
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );
  const billYm = instanceBillMonthPartsOf(row);
  const salaryType = resolveChequeSalaryType({
    salaryMonth: row.SalaryMonth,
    billMonth: monthLabel(billYm),
    salaryYear: row.SalaryYear,
    billYear: billYm ? billYm.year : row.SalaryYear,
    salaryMonthNumber: row.SalaryMonthNumber,
  });

  return {
    type: "EMPLOYEE",
    detailId: row.DetailId != null ? Number(row.DetailId) : null,
    billCodeId: Number(row.BillCodeId),
    billCode: row.BillCode || "",
    workflowId: row.WorkflowId == null ? null : Number(row.WorkflowId),
    employeeId: Number(row.EmployeeId),
    employeeName: row.EmployeeName || "",
    designation: row.Designation || row.MasterDesignationName || "",
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || row.InstituteCode || "",
    sectionId: row.SectionId == null ? null : Number(row.SectionId),
    sectionSrNo: row.SectionSrNo == null ? null : Number(row.SectionSrNo),
    sectionName: row.SectionName || "",
    displayOrder: toNum(row.DisplayOrder),
    salaryMonth: monthLabel(salaryYm) || row.SalaryMonth || "",
    salaryMonthParts: salaryYm,
    billMonth: monthLabel(billYm) || row.WorkflowBillMonth || "",
    billMonthParts: billYm,
    salaryType: salaryType === "OLD" ? "OLD" : "REGULAR",
    workflowStatus: String(row.WorkflowStatus || "").trim().toUpperCase(),
    basic: round2(row.BasicPay),
    gradePay: round2(row.GradePay),
    totalBasic: round2(row.TotalBasic),
    da: round2(row.DA),
    hra: round2(row.HRA),
    medical: round2(row.MA),
    ta: round2(row.TA),
    cla: round2(row.CLA),
    specialAllowance: round2(row.SpecialAllowance),
    washingAllowance: round2(row.WashingAllowance),
    total: round2(row.GrossSalary),
    gpf: round2(row.GPFSubscription),
    gpfAdvance: round2(row.GPFAdvance),
    nps: round2(row.NPS),
    incomeTax: round2(row.IncomeTax),
    professionalTax: round2(row.ProfessionalTax),
    otherDeduction: round2(row.OtherDeduction),
    totalDeduction: round2(row.TotalDeduction),
    net: round2(row.NetSalary),
    chequeAmount: round2(row.ChequeAmount),
  };
}

const TOTAL_KEYS = [
  "basic", "gradePay", "totalBasic", "da", "hra", "medical", "ta", "cla",
  "specialAllowance", "washingAllowance", "total", "gpf", "gpfAdvance",
  "nps", "incomeTax", "professionalTax", "otherDeduction", "totalDeduction",
  "net", "chequeAmount",
];

function emptyTotals() {
  const totals = {};
  TOTAL_KEYS.forEach((key) => { totals[key] = 0; });
  return totals;
}

function addToTotals(totals, row) {
  TOTAL_KEYS.forEach((key) => {
    totals[key] = round2(totals[key] + toNum(row[key]));
  });
  return totals;
}

/** ALL / REGULAR / OLD. Anything else falls back to ALL. */
function parseSalaryType(query = {}) {
  const raw = String(query.salaryType || "ALL").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (raw === "REGULAR" || raw === "OLD") return raw;
  return "ALL";
}

/**
 * Salary Month is the report's period (never Bill Month, a project-wide
 * rule) — see matchesFilterMonthYear on row.salaryMonthParts. Bill Month is
 * a separate, optional filter: when omitted, EVERY eligible Bill Month
 * instance of the selected Salary Month is included (an institute paid via a
 * JUL-2026 bill and an AUG-2026 bill both contribute their own employees).
 */
function filterMonthWiseRows(rows, query = {}) {
  const month = query.month != null && query.month !== "" ? Number(query.month) : null;
  const year = query.year != null && query.year !== "" ? Number(query.year) : null;
  const billMonth = query.billMonth != null && query.billMonth !== "" ? Number(query.billMonth) : null;
  const billYear = query.billYear != null && query.billYear !== "" ? Number(query.billYear) : year;
  const sectionId = query.sectionId != null && query.sectionId !== "" ? Number(query.sectionId) : null;
  const instituteCode = String(query.instituteCode || "").trim().toUpperCase();
  const salaryType = parseSalaryType(query);

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) return false;

    if (month != null && year != null) {
      if (!matchesFilterMonthYear(row.salaryMonthParts, month, year)) return false;
    }
    if (billMonth != null && billYear != null) {
      if (!matchesFilterMonthYear(row.billMonthParts, billMonth, billYear)) return false;
    }
    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.sectionId) !== sectionId) return false;
    }
    if (instituteCode && String(row.instituteCode || "").trim().toUpperCase() !== instituteCode) {
      return false;
    }
    if ((salaryType === "REGULAR" || salaryType === "OLD") &&
        !billTypeMatchesFilter(salaryType, row.salaryType)) {
      return false;
    }
    return true;
  });
}

function sectionRank(row) {
  const raw = row?.sectionSrNo;
  if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/* Default sort: Institute Code -> Institute Name -> Employee Name, as
   specified. Section rank is honoured first only so a chosen/implicit
   section grouping stays consistent with every other report's ordering;
   it is a no-op when every displayed row shares one section or filter. */
function compareEmployeeRows(a, b) {
  const rank = sectionRank(a) - sectionRank(b);
  if (rank !== 0) return rank < 0 ? -1 : 1;
  const byCode = compareGroupCodes(a.instituteCode, b.instituteCode);
  if (byCode !== 0) return byCode;
  const byName = String(a.instituteName || "").localeCompare(String(b.instituteName || ""));
  if (byName !== 0) return byName;
  return String(a.employeeName || "").localeCompare(String(b.employeeName || ""));
}

async function buildMonthWiseEmployeeSalaryReport(query = {}) {
  const q = query || {};
  const month = q.month;
  const year = q.year;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error("Salary Month and Year are required.");
    err.status = 400;
    throw err;
  }

  const raw = await loadMonthWiseRows();
  const mapped = raw.map((row) => mapEmployeeRow(row));
  const filtered = filterMonthWiseRows(mapped, q)
    .sort(compareEmployeeRows)
    /* Internal-only parts objects, used solely for filtering/sorting above —
       stripped before the row reaches the flat output, same cleanup Salary
       Register does for the identical fields. */
    .map(({ salaryMonthParts, billMonthParts, ...rest }) => rest);

  const truncated = filtered.length > MAX_ROWS;
  const kept = truncated ? filtered.slice(0, MAX_ROWS) : filtered;

  /* Flat rows with injected "Institute Total" subtotal rows — the same
     type-discriminated flat-array shape Bank Copy uses, so the screen and
     the exports render a single table with no separate grouping layer. */
  const flat = [];
  let srNo = 0;
  let currentCode = null;
  let instituteRunning = emptyTotals();
  let instituteName = "";
  let instituteRowCount = 0;

  const flushInstitute = () => {
    if (currentCode == null || instituteRowCount === 0) return;
    flat.push({
      type: "INSTITUTE_TOTAL",
      instituteCode: currentCode,
      instituteName,
      label: "Institute Total",
      ...instituteRunning,
    });
  };

  for (const row of kept) {
    const code = row.instituteCode;
    if (currentCode !== code) {
      flushInstitute();
      currentCode = code;
      instituteName = row.instituteName;
      instituteRunning = emptyTotals();
      instituteRowCount = 0;
    }
    srNo += 1;
    flat.push({ ...row, srNo });
    instituteRunning = addToTotals(instituteRunning, row);
    instituteRowCount += 1;
  }
  flushInstitute();

  const grandTotal = kept.reduce((acc, row) => addToTotals(acc, row), emptyTotals());

  const periodParts = { year: Number(year), month: Number(month) };
  const billMonthLabel =
    q.billMonth != null && q.billMonth !== ""
      ? monthLabel({ year: Number(q.billYear || year), month: Number(q.billMonth) })
      : "ALL BILL MONTHS";

  let sectionLabel = "ALL SECTIONS";
  const sectionId = toIntOrNull(q.sectionId);
  if (sectionId != null) {
    const names = [...new Set(kept.map((r) => r.sectionName).filter((n) => n && n.trim() !== ""))];
    sectionLabel = names.length === 1 ? names[0].toUpperCase() : `SECTION #${sectionId}`;
  }

  const instituteCode = String(q.instituteCode || "").trim();
  let instituteLabel = "ALL INSTITUTES";
  if (instituteCode) {
    const match = kept.find((r) => r.instituteCode === instituteCode);
    instituteLabel = match ? `${match.instituteCode} — ${match.instituteName}` : instituteCode;
  }

  return {
    heading: HEADING,
    title: TITLE,
    salaryMonthLabel: monthLabel(periodParts),
    billMonthLabel,
    sectionLabel,
    instituteLabel,
    salaryTypeLabel: parseSalaryType(q),
    rows: flat,
    grandTotal,
    employeeCount: kept.length,
    instituteCount: new Set(kept.map((r) => r.instituteCode)).size,
    truncated,
    maxRows: MAX_ROWS,
    filters: {
      month: Number(month),
      year: Number(year),
      billMonth: q.billMonth != null && q.billMonth !== "" ? Number(q.billMonth) : null,
      billYear: q.billYear != null && q.billYear !== "" ? Number(q.billYear) : null,
      sectionId,
      instituteCode: instituteCode || null,
      salaryType: parseSalaryType(q),
    },
  };
}

function sendReport(req, res) {
  buildMonthWiseEmployeeSalaryReport(req.query || {})
    .then((data) => res.json({ message: "OK", data }))
    .catch((error) => {
      const status = error.status || 500;
      if (status === 500) console.error("GET /api/month-wise-employee-salary error:", error);
      res.status(status).json({ message: error.message || "Month-Wise Employee Salary Report failed." });
    });
}

/* GET /api/month-wise-employee-salary?month=&year=&billMonth=&billYear=&sectionId=&instituteCode=&salaryType= */
router.get("/", sendReport);

/* GET /api/month-wise-employee-salary/meta — filter dropdown options */
router.get("/meta", async (_req, res) => {
  try {
    const sections = await loadSections();
    const institutes = await loadInstitutes();
    const yearsRes = await sql.query`
      SELECT DISTINCT SalaryYear
      FROM dbo.SalaryBillCodes
      WHERE SalaryYear IS NOT NULL AND LTRIM(RTRIM(SalaryYear)) <> N''
      ORDER BY SalaryYear DESC
    `;
    res.json({
      message: "OK",
      data: {
        sections: [{ sectionId: null, sectionName: "All", sectionCode: "" }, ...sections],
        institutes,
        years: yearsRes.recordset.map((r) => String(r.SalaryYear)),
        salaryTypes: [
          { value: "ALL", label: "All" },
          { value: "REGULAR", label: "Regular" },
          { value: "OLD", label: "Old" },
        ],
      },
    });
  } catch (error) {
    console.error("GET /api/month-wise-employee-salary/meta error:", error);
    res.status(500).json({
      message: "Unable to load Month-Wise Employee Salary filters.",
      error: error.message,
    });
  }
});

/* The 25 printed columns, in the exact required order. */
const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No", type: "number" },
  { key: "instituteName", label: "Institute Name" },
  { key: "instituteCode", label: "Institute Code" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "basic", label: "Basic", type: "number" },
  { key: "gradePay", label: "G.P.", type: "number" },
  { key: "totalBasic", label: "Total Basic", type: "number" },
  { key: "da", label: "D.A.", type: "number" },
  { key: "hra", label: "H.R.A.", type: "number" },
  { key: "medical", label: "Medical", type: "number" },
  { key: "ta", label: "T.A.", type: "number" },
  { key: "cla", label: "C.L.A.", type: "number" },
  { key: "specialAllowance", label: "Spl. Allowance", type: "number" },
  { key: "washingAllowance", label: "Wash. Allowance", type: "number" },
  { key: "total", label: "Total", type: "number" },
  { key: "gpf", label: "GPF", type: "number" },
  { key: "gpfAdvance", label: "GPF Adv.", type: "number" },
  { key: "nps", label: "NPS", type: "number" },
  { key: "incomeTax", label: "Income Tax", type: "number" },
  { key: "professionalTax", label: "Prof. Tax", type: "number" },
  { key: "otherDeduction", label: "Other Ded.", type: "number" },
  { key: "totalDeduction", label: "Total Ded.", type: "number" },
  { key: "net", label: "Net", type: "number" },
  { key: "chequeAmount", label: "Cheque Amt.", type: "number" },
];

/* GET /api/month-wise-employee-salary/export.xlsx — same builder as the screen. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildMonthWiseEmployeeSalaryReport(req.query || {});

    const heading = [
      ...data.heading.map((line) => [line]),
      [data.title],
      [`Salary Month: ${data.salaryMonthLabel}`],
      [
        `Bill Month: ${data.billMonthLabel}`,
        `Section: ${data.sectionLabel}`,
        `Institute: ${data.instituteLabel}`,
        `Salary Type: ${data.salaryTypeLabel}`,
      ],
      [],
    ];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) => {
      if (row.type === "INSTITUTE_TOTAL") {
        return XLSX_COLUMNS.map((column) => {
          if (column.key === "employeeName") return "INSTITUTE TOTAL";
          if (column.key === "instituteCode") return row.instituteCode;
          if (column.key === "instituteName") return row.instituteName;
          if (column.type === "number") return Number(row[column.key] || 0);
          return "";
        });
      }
      return XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      });
    });

    const grandRow = [];
    if (data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column) => {
        if (column.key === "employeeName") grandRow.push("GRAND TOTAL");
        else if (column.type === "number") grandRow.push(Number(data.grandTotal[column.key] || 0));
        else grandRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(grandRow.length ? [grandRow] : []),
    ]);
    sheet["!cols"] = XLSX_COLUMNS.map((c) =>
      c.key === "instituteName" || c.key === "employeeName" || c.key === "designation"
        ? { wch: 24 }
        : { wch: 11 }
    );

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Month-Wise Employee Salary");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Month_Wise_Employee_Salary_${data.salaryMonthLabel.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/month-wise-employee-salary/export.xlsx error:", error);
    res.status(status).json({ message: error.message || "Month-Wise Employee Salary export failed." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testMonthWiseEmployeeSalary.js). */
module.exports.loadMonthWiseRows = loadMonthWiseRows;
module.exports.mapEmployeeRow = mapEmployeeRow;
module.exports.filterMonthWiseRows = filterMonthWiseRows;
module.exports.compareEmployeeRows = compareEmployeeRows;
module.exports.parseSalaryType = parseSalaryType;
module.exports.buildMonthWiseEmployeeSalaryReport = buildMonthWiseEmployeeSalaryReport;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
module.exports.HEADING = HEADING;
module.exports.TITLE = TITLE;
