/**
 * EMPLOYEE WISE SALARY REPORT
 *
 * One employee's complete salary history (or every employee's, grouped
 * separately) across a chronological month range, read from the same stored
 * rows the Cheque Register aggregates:
 *
 *   dbo.SalaryEmployeeDetails  (BasicPay, GradePay, DA, HRA, MA, TA, CLA,
 *     SpecialAllowance, WashingAllowance, GrossSalary, GPFSubscription,
 *     GPFAdvance, NPS, IncomeTax, ProfessionalTax, OtherDeduction,
 *     TotalDeduction, NetSalary, ChequeAmount)
 *
 * Nothing is recalculated here: every money value returned is the stored
 * value, so this report agrees with Salary Entry / Salary Bill / Cheque
 * Register by construction.
 *
 * Data rules (same as Cheque Register / GPF / NPS summaries):
 *   - only APPROVED / LOCKED institute workflow rows
 *   - DA-Difference bills excluded (they live in DADifferenceEmployeeDetails
 *     and have a different shape; GPF/NPS summaries exclude them too)
 *   - archived bills excluded
 *   - period membership is the SALARY MONTH (chronological, inclusive range)
 *   - Type is REGULAR when SalaryMonth == BillMonth else OLD, via the shared
 *     resolveChequeSalaryType helper
 *
 * Employee header information comes from dbo.EmployeeMaster (joined with
 * Designations / Institutes / Sections). Only columns that exist are
 * returned — there is no Bank Name column in the database, so none is shown.
 */

const express = require("express");
const { sql } = require("../db");
const {
  instanceEmployeeRowsSql,
  instanceBillMonthSelectSql,
  applyInstanceHeaders,
  queryReport,
} = require("../utils/reportBillInstance");
const {
  normalizeYearMonth,
  yearMonthKey,
  formatMonthLabel,
} = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  salaryMonthPartsOf,
  billMonthPartsOf,
  compareGroupCodes,
} = require("./chequeRegister");
const {
  resolveChequeSalaryType,
  billTypeMatchesFilter,
} = require("../utils/salaryMonthKey");

const { loadDaDifferenceRows } = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "EMPLOYEE WISE SALARY REPORT";

/* Safety cap for the "all employees + all months" combination. */
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

/**
 * Chronological month key: year * 12 + month, so JAN-2026..JUN-2026 is a
 * plain numeric interval. Month names are never compared as strings.
 */
function monthIndex(parts) {
  if (!parts) return null;
  return parts.year * 12 + parts.month;
}

function formatDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = String(value.getDate()).padStart(2, "0");
    const m = String(value.getMonth() + 1).padStart(2, "0");
    return `${d}-${m}-${value.getFullYear()}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return raw;
}

/**
 * Approved employee salary rows with their bill period and master info.
 * One row per (bill, employee) — the grain Salary Entry stored.
 */
async function loadEmployeeSalaryRows() {
  const result = await queryReport(`
    SELECT
      b.BillCodeId,
      b.BillCode,
      ${instanceBillMonthSelectSql()},
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      b.BillCategory,
      b.BillType,
      w.InstituteCode,
      w.Status              AS WorkflowStatus,
      w.BillNo,
      w.BillDate,
      i.InstituteId,
      i.InstituteName,
      i.SectionId,
      sec.SrNo              AS SectionSrNo,
      sec.SectionName,
      d.Id                  AS DetailId,
      d.EmployeeId,
      d.EmployeeName,
      d.Designation,
      d.EmployeeType,
      d.DisplayOrder,
      d.BasicPay,
      d.GradePay,
      d.TotalBasic,
      d.DA,
      d.HRA,
      d.MA,
      d.TA,
      ISNULL(d.CLA, 0)      AS CLA,
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
      /*
        Additive only (Employee Pay Slip). PensionType is the bill-time
        pension snapshot already written by Salary Entry; NPSScheduleNo is the
        existing workflow column. No new column, no changed meaning, and no
        existing selected value is affected.
      */
      d.PensionType,
      w.NPSScheduleNo,
      em.EmployeeCode,
      em.DateOfBirth,
      em.DateOfJoining,
      em.DateOfRetirement,
      em.CCCPassDate,
      em.BankAccountNumber,
      em.GPFNPS,
      em.GPFNPSNumber,
      em.ScaleOfPay,
      em.PayLevel,
      em.PayMatrixCellNo,
      em.CityClassId,
      cc.CityClassName,
      des.DesignationName   AS MasterDesignationName
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
    LEFT JOIN dbo.CityClasses cc
      ON cc.CityClassId = em.CityClassId
    LEFT JOIN dbo.Designations des
      ON des.DesignationId = em.DesignationId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
    ORDER BY d.EmployeeName, d.EmployeeId, b.SalaryYear, b.SalaryMonthNumber
  `);
  /* Bill No. / Date / NPS Schedule No. of each row's own Bill Month instance. */
  return applyInstanceHeaders(result.recordset);
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
 * One screen row per stored (bill, employee) row. Money fields are the
 * stored values, rounded for display — never recomputed from components.
 */
function mapSalaryRow(row) {
  const salaryParts = salaryMonthPartsOf(
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );
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

  return {
    detailId: row.DetailId != null ? Number(row.DetailId) : null,
    billCodeId: Number(row.BillCodeId),
    billCode: row.BillCode || "",
    billNo: row.BillNo != null ? String(row.BillNo).trim() : "",
    employeeId: Number(row.EmployeeId),
    employeeName: row.EmployeeName || "",
    employeeCode:
      row.EmployeeCode != null && String(row.EmployeeCode).trim() !== ""
        ? String(row.EmployeeCode)
        : String(row.EmployeeId),
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || row.InstituteCode || "",
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    sectionName: row.SectionName || "",
    salaryMonth: formatMonthLabel(salaryParts) || row.SalaryMonth || "",
    salaryMonthKey: yearMonthKey(salaryParts),
    salaryMonthIndex: monthIndex(salaryParts),
    /* Paid Month = this bill's real Bill Month. */
    paidMonth: formatMonthLabel(billParts) || row.BillMonth || "",
    type: salaryType === "OLD" ? "OLD" : "REGULAR",
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
  "basic",
  "gradePay",
  "totalBasic",
  "da",
  "hra",
  "medical",
  "ta",
  "cla",
  "specialAllowance",
  "washingAllowance",
  "total",
  "gpf",
  "gpfAdvance",
  "nps",
  "incomeTax",
  "professionalTax",
  "otherDeduction",
  "totalDeduction",
  "net",
  "chequeAmount",
];

function emptyTotals() {
  const totals = {};
  TOTAL_KEYS.forEach((key) => {
    totals[key] = 0;
  });
  return totals;
}

function addToTotals(totals, row) {
  TOTAL_KEYS.forEach((key) => {
    totals[key] = round2(totals[key] + toNum(row[key]));
  });
  return totals;
}

/**
 * Master information for the employee header. Every field exists in
 * EmployeeMaster (joined with Designations / Institutes / Sections /
 * CityClasses). The database has no Bank Name column, so none is returned.
 */
function employeeHeaderOf(rows) {
  const first = rows[0] || {};
  const gpfNpsLabel = String(first.GPFNPS || "").trim().toUpperCase();
  return {
    employeeId: Number(first.EmployeeId),
    employeeCode:
      first.EmployeeCode != null && String(first.EmployeeCode).trim() !== ""
        ? String(first.EmployeeCode)
        : String(first.EmployeeId != null ? first.EmployeeId : ""),
    employeeName: first.EmployeeName || "",
    sectionName: first.SectionName || "",
    instituteCode: first.InstituteCode || "",
    instituteName: first.InstituteName || first.InstituteCode || "",
    designation:
      first.MasterDesignationName || first.Designation || "",
    employeeType: first.EmployeeType || "",
    accountNo: first.BankAccountNumber || "",
    gpfNpsType: gpfNpsLabel,
    gpfNpsNumber: first.GPFNPSNumber || "",
    dateOfBirth: formatDate(first.DateOfBirth),
    joiningDate: formatDate(first.DateOfJoining),
    retiredDate: formatDate(first.DateOfRetirement),
    className: first.CityClassName || "",
    cccPassDate: formatDate(first.CCCPassDate),
    payFixDetail: [
      first.ScaleOfPay || "",
      first.PayLevel != null && String(first.PayLevel).trim() !== ""
        ? `Level ${String(first.PayLevel).trim()}`
        : "",
      first.PayMatrixCellNo != null ? `Cell ${first.PayMatrixCellNo}` : "",
    ]
      .filter(Boolean)
      .join(" / "),
  };
}

function parseSalaryTypeFilter(raw) {
  const value = String(raw || "ALL").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (value === "REGULAR" || value === "REG" || value === "REGULAR_SALARY") {
    return "REGULAR";
  }
  if (value === "OLD" || value === "OLD_SALARY") return "OLD";
  if (
    value === "DA_DIFFERENCE" ||
    value === "DA_DIFFERENCE_SALARY" ||
    value === "DIFFERENCE"
  ) {
    return "DA_DIFFERENCE";
  }
  return "ALL";
}

/**
 * A DA Difference record in this report's row shape.
 *
 * ONLY the three amounts DA Difference actually stores are populated:
 *   TotalDifferenceAmount    -> the bill's earning (its gross)
 *   TotalNPSDeduction        -> nps
 *   TotalNetDifferenceAmount -> net
 *
 * Every salary component a DA Difference record does not have — Basic,
 * Grade Pay, DA, HRA, MA, TA, CLA, allowances, GPF, GPF Advance, Income Tax,
 * Professional Tax, Other Deduction — is left at zero because the column does
 * not exist in dbo.DADifferenceEmployeeDetails. Nothing is invented, and no
 * value is inferred from an amount or a bill number.
 *
 * The row is labelled type "DA DIFFERENCE", so it can never be mistaken for a
 * REGULAR or an OLD salary row in the grid, the totals or an export.
 */
function daRowToSalaryRow(row) {
  return {
    detailId: null,
    billCodeId: row.billCodeId,
    billCode: row.billCode,
    billNo: "",
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeCode: row.employeeCode,
    instituteCode: row.instituteCode,
    instituteName: row.instituteName,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    salaryMonth: row.salaryMonth,
    salaryMonthKey: row.salaryMonthKey,
    salaryMonthIndex: row.salaryMonthIndex,
    paidMonth: row.paidMonth,
    type: "DA DIFFERENCE",
    workflowStatus: row.workflowStatus,

    /*
      null, NOT 0. These columns do not exist in
      dbo.DADifferenceEmployeeDetails, so a zero would assert a stored value
      of zero that was never recorded. null lets the screen show an em dash —
      "not applicable" rather than "nil". Totals are unaffected: the summing
      helpers coerce null to 0.
    */
    basic: null,
    gradePay: null,
    totalBasic: null,
    da: null,
    hra: null,
    medical: null,
    ta: null,
    cla: null,
    specialAllowance: null,
    washingAllowance: null,
    /* Real, stored DA Difference amounts. */
    total: round2(row.differenceAmount),
    gpf: null,
    gpfAdvance: null,
    nps: round2(row.nps),
    incomeTax: null,
    professionalTax: null,
    otherDeduction: null,
    totalDeduction: round2(row.nps),
    net: round2(row.net),
    chequeAmount: round2(row.net),
  };
}

/**
 * Filters:
 *   sectionId   optional section master id
 *   employeeId  optional employee master id
 *   allMonths   "1"/"true" → ignore the month range entirely
 *   fromMonth/fromYear, toMonth/toYear → inclusive chronological range on
 *     the SALARY MONTH (same membership rule as the Cheque Register)
 *   salaryType  ALL | REGULAR | OLD
 */
function filterSalaryRows(rows, query) {
  const sectionId = toIntOrNull(query.sectionId);
  const employeeId = toIntOrNull(query.employeeId);
  const allMonths =
    String(query.allMonths || "").trim() === "1" ||
    String(query.allMonths || "").trim().toLowerCase() === "true" ||
    String(query.monthRange || "").trim().toUpperCase() === "ALL";
  const salaryType = parseSalaryTypeFilter(
    query.salaryType || query.table
  );

  let fromIndex = null;
  let toIndex = null;
  if (!allMonths) {
    const fromMonth = toIntOrNull(query.fromMonth);
    const fromYear = toIntOrNull(query.fromYear);
    const toMonth = toIntOrNull(query.toMonth);
    const toYear = toIntOrNull(query.toYear);
    /* A single month behaves as a one-month range. */
    const singleMonth = toIntOrNull(query.month);
    const singleYear = toIntOrNull(query.year);
    const effFromMonth = fromMonth != null ? fromMonth : singleMonth;
    const effFromYear = fromYear != null ? fromYear : singleYear;
    const effToMonth = toMonth != null ? toMonth : singleMonth;
    const effToYear = toYear != null ? toYear : singleYear;
    if (effFromMonth != null && effFromYear != null) {
      fromIndex = effFromYear * 12 + effFromMonth;
    }
    if (effToMonth != null && effToYear != null) {
      toIndex = effToYear * 12 + effToMonth;
    }
    if (fromIndex != null && toIndex != null && fromIndex > toIndex) {
      const swap = fromIndex;
      fromIndex = toIndex;
      toIndex = swap;
    }
  }

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) return false;

    if (sectionId != null) {
      if (Number(row.sectionId) !== sectionId) return false;
    }
    if (employeeId != null) {
      if (Number(row.employeeId) !== employeeId) return false;
    }

    /* Salary Category vs Bill Type stay separate dimensions: a DA Difference
       row is never REGULAR or OLD, and ALL keeps every category. */
    /* Regular Salary = REGULAR + OLD for the selected Salary Month; Old
       Salary still narrows to OLD only. billTypeMatchesFilter is the one
       definition (utils/salaryMonthKey.js). */
    if (
      (salaryType === "REGULAR" || salaryType === "OLD") &&
      !billTypeMatchesFilter(salaryType, row.type)
    ) {
      return false;
    }
    if (salaryType === "DA_DIFFERENCE" && row.type !== "DA DIFFERENCE") return false;

    if (fromIndex != null || toIndex != null) {
      const idx = row.salaryMonthIndex;
      if (idx == null) return false;
      if (fromIndex != null && idx < fromIndex) return false;
      if (toIndex != null && idx > toIndex) return false;
    }

    return true;
  });
}

function compareRows(a, b) {
  if (a.employeeName !== b.employeeName) {
    return String(a.employeeName).localeCompare(String(b.employeeName));
  }
  if (a.employeeId !== b.employeeId) return a.employeeId - b.employeeId;
  const ai = a.salaryMonthIndex != null ? a.salaryMonthIndex : 0;
  const bi = b.salaryMonthIndex != null ? b.salaryMonthIndex : 0;
  if (ai !== bi) return ai - bi;
  if ((a.paidMonth || "") !== (b.paidMonth || "")) {
    return String(a.paidMonth).localeCompare(String(b.paidMonth));
  }
  if (a.type !== b.type) return a.type === "REGULAR" ? -1 : 1;
  return String(a.billCode || "").localeCompare(String(b.billCode || ""));
}

function monthRangeLabel(query) {
  const allMonths =
    String(query.allMonths || "").trim() === "1" ||
    String(query.allMonths || "").trim().toLowerCase() === "true" ||
    String(query.monthRange || "").trim().toUpperCase() === "ALL";
  if (allMonths) return "ALL MONTHS";
  const fromMonth = toIntOrNull(query.fromMonth != null ? query.fromMonth : query.month);
  const fromYear = toIntOrNull(query.fromYear != null ? query.fromYear : query.year);
  const toMonth = toIntOrNull(query.toMonth != null ? query.toMonth : query.month);
  const toYear = toIntOrNull(query.toYear != null ? query.toYear : query.year);
  const from = fromMonth != null && fromYear != null
    ? formatMonthLabel({ month: fromMonth, year: fromYear })
    : "";
  const to = toMonth != null && toYear != null
    ? formatMonthLabel({ month: toMonth, year: toYear })
    : "";
  if (from && to) return from === to ? from : `${from} TO ${to}`;
  return from || to || "ALL MONTHS";
}

async function buildEmployeeWiseReport(query) {
  const wanted = parseSalaryTypeFilter((query || {}).salaryType || (query || {}).table);
  const wantsSalary = wanted !== "DA_DIFFERENCE";
  const wantsDa = wanted === "DA_DIFFERENCE" || wanted === "ALL";

  const [rawRows, daRaw] = await Promise.all([
    wantsSalary ? loadEmployeeSalaryRows() : Promise.resolve([]),
    wantsDa ? loadDaDifferenceRows() : Promise.resolve([]),
  ]);

  /* Concatenated, never joined: no regular row is dropped or duplicated. */
  const mapped = [
    ...rawRows.map(mapSalaryRow),
    ...daRaw.map(daRowToSalaryRow),
  ];
  const filtered = filterSalaryRows(mapped, query || {}).sort(compareRows);

  const truncated = filtered.length > MAX_ROWS;
  const kept = truncated ? filtered.slice(0, MAX_ROWS) : filtered;

  /* Grouped per employee so ALL-EMPLOYEES never mixes records. */
  const byEmployee = new Map();
  for (const row of kept) {
    const key = Number(row.employeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(row);
  }

  const salaryType = parseSalaryTypeFilter(query.salaryType || query.table);
  const employees = [...byEmployee.entries()]
    .map(([employeeId, empRows]) => {
      const headerRows = rawRows.filter(
        (r) => Number(r.EmployeeId) === Number(employeeId)
      );
      const numbered = empRows.map((row, idx) => ({ srNo: idx + 1, ...row }));
      const total = numbered.reduce(
        (acc, row) => addToTotals(acc, row),
        emptyTotals()
      );
      return {
        employee: employeeHeaderOf(headerRows),
        rows: numbered,
        total,
        rowCount: numbered.length,
      };
    })
    .sort((a, b) => {
      const byCode = compareGroupCodes(
        String(a.employee.employeeCode || ""),
        String(b.employee.employeeCode || "")
      );
      if (byCode !== 0) return byCode;
      return String(a.employee.employeeName || "").localeCompare(
        String(b.employee.employeeName || "")
      );
    });

  const grandTotal = kept.reduce(
    (acc, row) => addToTotals(acc, row),
    emptyTotals()
  );

  let sectionTitle = "ALL SECTIONS";
  const sectionId = toIntOrNull(query.sectionId);
  if (sectionId != null) {
    const names = [
      ...new Set(
        kept.map((r) => r.sectionName).filter((n) => n && n.trim() !== "")
      ),
    ];
    if (names.length === 1) sectionTitle = names[0].toUpperCase();
  }

  return {
    heading: HEADING,
    /* DA Difference IS included; the limitation is which columns it can fill. */
    salaryCategoryScope:
      "DA DIFFERENCE rows carry only their stored difference, NPS and net " +
      "amounts — a DA Difference record has no Basic, DA, HRA, GPF or tax " +
      "components, so those columns are zero rather than fabricated.",
    subHeading: SUBHEADING,
    sectionTitle,
    monthLine: monthRangeLabel(query),
    salaryType:
      salaryType === "ALL" ? "ALL" : salaryType === "OLD" ? "OLD" : "REGULAR",
    employees,
    grandTotal,
    employeeCount: employees.length,
    rowCount: kept.length,
    truncated,
    maxRows: MAX_ROWS,
  };
}

function sendReport(req, res) {
  buildEmployeeWiseReport(req.query || {})
    .then((data) => res.json({ message: "OK", data }))
    .catch((error) => {
      console.error("GET /api/employee-wise-salary error:", error);
      res.status(500).json({
        message: "Unable to load the Employee Wise Salary Report.",
        error: error.message,
      });
    });
}

/* GET /api/employee-wise-salary?sectionId=&employeeId=&fromMonth=&fromYear=&toMonth=&toYear=&allMonths=&salaryType= */
router.get("/", sendReport);

/* GET /api/employee-wise-salary/meta — filter dropdown options */
router.get("/meta", async (_req, res) => {
  try {
    const sections = await loadSections();
    const yearsRes = await sql.query`
      SELECT DISTINCT SalaryYear
      FROM dbo.SalaryBillCodes
      WHERE SalaryYear IS NOT NULL AND LTRIM(RTRIM(SalaryYear)) <> N''
      ORDER BY SalaryYear DESC
    `;
    const monthsRes = await sql.query`
      SELECT DISTINCT SalaryYear, SalaryMonthNumber
      FROM dbo.SalaryBillCodes
      WHERE SalaryYear IS NOT NULL AND LTRIM(RTRIM(SalaryYear)) <> N''
        AND SalaryMonthNumber IS NOT NULL
      ORDER BY SalaryYear DESC, SalaryMonthNumber DESC
    `;
    res.json({
      message: "OK",
      data: {
        sections: [
          { sectionId: null, sectionName: "All", sectionCode: "" },
          ...sections,
        ],
        years: yearsRes.recordset.map((r) => String(r.SalaryYear)),
        salaryMonths: monthsRes.recordset
          .map((r) => {
            const parts = normalizeYearMonth(
              null,
              r.SalaryYear,
              Number(r.SalaryMonthNumber)
            );
            return parts ? formatMonthLabel(parts) : "";
          })
          .filter(Boolean),
        salaryTypes: [
          { value: "ALL", label: "All" },
          { value: "REGULAR", label: "Regular (incl. Old)" },
          { value: "OLD", label: "Old" },
        ],
      },
    });
  } catch (error) {
    console.error("GET /api/employee-wise-salary/meta error:", error);
    res.status(500).json({
      message: "Unable to load Employee Wise Salary filters.",
      error: error.message,
    });
  }
});

const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "employeeCode", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "instituteName", label: "Institute" },
  { key: "salaryMonth", label: "Salary Month" },
  { key: "paidMonth", label: "Paid Month" },
  { key: "type", label: "Type" },
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

/* GET /api/employee-wise-salary/export.xlsx — same builder as the screen */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildEmployeeWiseReport(req.query || {});

    const heading = [
      [data.heading],
      [data.subHeading],
      [`Section: ${data.sectionTitle}`],
      [`Month: ${data.monthLine}`, `Salary Type: ${data.salaryType}`],
      [],
    ];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = [];
    for (const group of data.employees) {
      body.push([
        `EMPLOYEE: ${group.employee.employeeCode} - ${group.employee.employeeName}`,
      ]);
      for (const row of group.rows) {
        body.push(
          XLSX_COLUMNS.map((column) => {
            const value = row[column.key];
            if (column.type === "number") return Number(value || 0);
            return value == null ? "" : String(value);
          })
        );
      }
      const groupTotal = ["TOTAL"];
      XLSX_COLUMNS.forEach((column, index) => {
        if (index === 0) return;
        if (column.type === "number") {
          groupTotal.push(Number(group.total[column.key] || 0));
        } else groupTotal.push("");
      });
      body.push(groupTotal);
      body.push([]);
    }

    const sheet = XLSX.utils.aoa_to_sheet([...heading, header, ...body]);
    sheet["!cols"] = XLSX_COLUMNS.map((c) => ({
      wch: Math.max(10, c.label.length + 2),
    }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Employee Wise Salary");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Employee_Wise_Salary_${data.monthLine.replace(
      /[^A-Za-z0-9-]+/g,
      "_"
    )}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error("GET /api/employee-wise-salary/export.xlsx error:", error);
    res.status(500).json({
      message: "Unable to export the Employee Wise Salary Report.",
      error: error.message,
    });
  }
});

module.exports = router;
/* Exported for offline tests. */
module.exports.loadEmployeeSalaryRows = loadEmployeeSalaryRows;
module.exports.mapSalaryRow = mapSalaryRow;
module.exports.filterSalaryRows = filterSalaryRows;
module.exports.daRowToSalaryRow = daRowToSalaryRow;
module.exports.parseSalaryTypeFilter = parseSalaryTypeFilter;
module.exports.buildEmployeeWiseReport = buildEmployeeWiseReport;
module.exports.monthIndex = monthIndex;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
