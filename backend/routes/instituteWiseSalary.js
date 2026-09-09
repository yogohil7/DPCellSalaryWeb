/**
 * INSTITUTE WISE SALARY REPORT  ("SALARY STATEMENT")
 *
 * Salary employee details grouped institute-wise, then salary-month-wise,
 * with a separate DA Difference section per institute — the same concept
 * as the legacy GNSalary salary statement.
 *
 * Every money value is a STORED value, never recalculated:
 *
 *   Salary rows: dbo.SalaryEmployeeDetails
 *     BasicPay, GradePay, DA, HRA, MA, TA, CLA, SpecialAllowance,
 *     GrossSalary, GPFSubscription, GPFAdvance, NPS, IncomeTax,
 *     ProfessionalTax, OtherDeduction, TotalDeduction, NetSalary
 *
 *   DA rows: dbo.DADifferenceEmployeeDetails
 *     TotalDifferenceAmount -> D.A. (and Gross), exactly as the Cheque
 *     Register maps them; TotalNPSDeduction -> NPS; TotalNetDifferenceAmount
 *     -> Net. All other DA columns are 0, as in the legacy statement.
 *
 * Data rules (same universe as the Cheque Register):
 *   - only APPROVED / LOCKED institute workflow rows
 *   - archived bills excluded
 *   - salary section excludes DA-Difference bills; the DA section includes
 *     ONLY approved DA-Difference bills whose difference period overlaps the
 *     selected range
 *   - period membership is the SALARY MONTH (chronological, inclusive range)
 *   - REGULAR vs OLD via the shared resolveChequeSalaryType helper;
 *     REGULAR and OLD rows are never merged
 *   - MODE is EmployeeMaster.GPFNPS (GPF/NPS) — never derived
 *   - Designation is the stored SalaryEmployeeDetails.Designation, the same
 *     value Salary Bill / Salary Entry uses
 */

const express = require("express");
const { sql } = require("../db");
const {
  normalizeYearMonth,
  yearMonthKey,
  formatMonthLabel,
  resolveChequeSalaryType,
  billTypeMatchesFilter,
} = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  salaryMonthPartsOf,
  billMonthPartsOf,
  compareGroupCodes,
} = require("./chequeRegister");

const { excludedScopeNote } = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "SALARY STATEMENT";

/* Safety cap for the "all institutes + all months" combination. */
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

/** Chronological month key: year * 12 + month. Never compares names. */
function monthIndex(parts) {
  if (!parts) return null;
  return parts.year * 12 + parts.month;
}

/**
 * Approved salary rows with bill period, master MODE and ordering.
 * One row per (bill, employee) — the grain Salary Entry stored.
 */
async function loadSalaryRows() {
  const result = await sql.query`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      b.BillCategory,
      b.BillType,
      w.InstituteCode,
      w.Status              AS WorkflowStatus,
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
      d.DA,
      d.HRA,
      d.MA,
      d.TA,
      ISNULL(d.CLA, 0)      AS CLA,
      d.SpecialAllowance,
      d.GrossSalary,
      d.GPFSubscription,
      d.GPFAdvance,
      d.NPS,
      d.IncomeTax,
      d.ProfessionalTax,
      d.OtherDeduction,
      d.TotalDeduction,
      d.NetSalary,
      em.GPFNPS             AS MasterMode
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
    LEFT JOIN dbo.EmployeeMaster em
      ON em.EmployeeId = d.EmployeeId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
    ORDER BY sec.SrNo, i.SectionId, w.InstituteCode,
             b.SalaryYear, b.SalaryMonthNumber, d.DisplayOrder
  `;
  return result.recordset;
}

/**
 * Approved DA-Difference employee rows with their difference period.
 * One row per (DA bill, employee, institute).
 */
async function loadDaRows() {
  const result = await sql.query`
    SELECT
      db.DADifferenceBillId,
      b.BillCodeId,
      b.BillCode,
      db.PaymentSalaryMonth,
      db.PaymentSalaryMonthNumber,
      db.PaymentSalaryYear,
      db.FromSalaryMonth,
      db.FromSalaryMonthNumber,
      db.FromSalaryYear,
      db.ToSalaryMonth,
      db.ToSalaryMonthNumber,
      db.ToSalaryYear,
      w.InstituteCode,
      w.Status              AS WorkflowStatus,
      i.InstituteId,
      i.InstituteName,
      i.SectionId,
      sec.SrNo              AS SectionSrNo,
      sec.SectionName,
      e.EmployeeId,
      e.EmployeeName,
      e.EmployeeCode,
      e.Designation,
      e.EmployeeType,
      e.DisplayOrder,
      e.TotalDifferenceAmount,
      ISNULL(e.TotalNPSDeduction, 0)      AS TotalNPSDeduction,
      ISNULL(e.TotalNetDifferenceAmount, 0) AS TotalNetDifferenceAmount,
      em.GPFNPS             AS MasterMode
    FROM dbo.DADifferenceBill db
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = db.SalaryBillCodeId
    INNER JOIN dbo.DADifferenceEmployeeDetails e
      ON e.DADifferenceBillId = db.DADifferenceBillId
    INNER JOIN dbo.SalaryBillInstituteWorkflow w
      ON w.SalaryBillCodeId = db.SalaryBillCodeId
     AND w.InstituteCode = e.InstituteCode
    LEFT JOIN dbo.Institutes i
      ON i.InstituteCode = e.InstituteCode
    LEFT JOIN dbo.Sections sec
      ON sec.SectionId = i.SectionId
    LEFT JOIN dbo.EmployeeMaster em
      ON em.EmployeeId = e.EmployeeId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND (
        UPPER(ISNULL(b.BillCategory, N'')) = N'DIFFERENCE'
        OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
      )
      AND ISNULL(b.IsArchived, 0) = 0
    ORDER BY sec.SrNo, i.SectionId, e.InstituteCode,
             db.FromSalaryYear, db.FromSalaryMonthNumber, e.DisplayOrder
  `;
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

/* MODE comes from the employee master (GPF/NPS dropdown) — never derived. */
function modeOf(row) {
  return String(row.MasterMode || "").trim().toUpperCase();
}

/** One screen row per stored salary row. Money = stored values. */
function mapSalaryRow(row) {
  const salaryParts = salaryMonthPartsOf(
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
    employeeId: Number(row.EmployeeId),
    empName: row.EmployeeName || "",
    mode: modeOf(row),
    designation: row.Designation || "",
    displayOrder: row.DisplayOrder != null ? Number(row.DisplayOrder) : null,
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || row.InstituteCode || "",
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    sectionName: row.SectionName || "",
    sectionSrNo: row.SectionSrNo,
    salaryMonth: formatMonthLabel(salaryParts) || row.SalaryMonth || "",
    salaryMonthKey: yearMonthKey(salaryParts),
    salaryMonthIndex: monthIndex(salaryParts),
    type: salaryType === "OLD" ? "OLD" : "REGULAR",
    workflowStatus: String(row.WorkflowStatus || "").trim().toUpperCase(),
    basic: round2(row.BasicPay),
    gradePay: round2(row.GradePay),
    da: round2(row.DA),
    hra: round2(row.HRA),
    medi: round2(row.MA),
    cla: round2(row.CLA),
    ta: round2(row.TA),
    speAll: round2(row.SpecialAllowance),
    gross: round2(row.GrossSalary),
    gpf: round2(row.GPFSubscription),
    gpfAdv: round2(row.GPFAdvance),
    nps: round2(row.NPS),
    it: round2(row.IncomeTax),
    pt: round2(row.ProfessionalTax),
    othDed: round2(row.OtherDeduction),
    totalDed: round2(row.TotalDeduction),
    net: round2(row.NetSalary),
  };
}

/**
 * One screen row per stored DA-difference row, in the legacy DA shape:
 * only D.A. carries the difference amount (and Gross), only NPS carries its
 * deduction, Net carries the net difference — exactly how the Cheque
 * Register maps the same stored columns.
 */
function mapDaRow(row) {
  const fromParts = normalizeYearMonth(
    row.FromSalaryMonth,
    row.FromSalaryYear,
    Number(row.FromSalaryMonthNumber)
  );
  const toParts = normalizeYearMonth(
    row.ToSalaryMonth,
    row.ToSalaryYear,
    Number(row.ToSalaryMonthNumber)
  );
  const payParts = normalizeYearMonth(
    row.PaymentSalaryMonth,
    row.PaymentSalaryYear,
    Number(row.PaymentSalaryMonthNumber)
  );
  const da = round2(row.TotalDifferenceAmount);
  const nps = round2(row.TotalNPSDeduction);
  const net = round2(row.TotalNetDifferenceAmount);

  return {
    daBillId: Number(row.DADifferenceBillId),
    billCodeId: Number(row.BillCodeId),
    billCode: row.BillCode || "",
    employeeId: Number(row.EmployeeId),
    empName: row.EmployeeName || "",
    mode: modeOf(row),
    designation: row.Designation || "",
    displayOrder: row.DisplayOrder != null ? Number(row.DisplayOrder) : null,
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || row.InstituteCode || "",
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    sectionName: row.SectionName || "",
    sectionSrNo: row.SectionSrNo,
    period: `${formatMonthLabel(fromParts) || ""}${
      formatMonthLabel(toParts) && formatMonthLabel(toParts) !== formatMonthLabel(fromParts)
        ? ` TO ${formatMonthLabel(toParts)}`
        : ""
    }`,
    paidMonth: formatMonthLabel(payParts) || "",
    fromIndex: monthIndex(fromParts),
    toIndex: monthIndex(toParts),
    workflowStatus: String(row.WorkflowStatus || "").trim().toUpperCase(),
    basic: 0,
    gradePay: 0,
    da,
    hra: 0,
    medi: 0,
    cla: 0,
    ta: 0,
    speAll: 0,
    gross: da,
    gpf: 0,
    gpfAdv: 0,
    nps,
    it: 0,
    pt: 0,
    othDed: 0,
    totalDed: nps,
    net,
  };
}

const TOTAL_KEYS = [
  "basic", "gradePay", "da", "hra", "medi", "cla", "ta", "speAll",
  "gross", "gpf", "gpfAdv", "nps", "it", "pt", "othDed", "totalDed", "net",
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

function sectionRankOf(group) {
  const raw = group?.sectionSrNo;
  if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function parseSalaryTypeFilter(raw) {
  const value = String(raw || "ALL").trim().toUpperCase();
  if (value === "REGULAR" || value === "REG" || value === "REGULAR_SALARY") {
    return "REGULAR";
  }
  if (value === "OLD" || value === "OLD_SALARY") return "OLD";
  return "ALL";
}

function parseSalaryTimeFilter(raw) {
  const value = String(raw || "ALL").trim().toUpperCase();
  if (value === "REGULAR" || value === "REGULAR_SALARY" || value === "SALARY") {
    return "REGULAR";
  }
  if (
    value === "DA" ||
    value === "DA_DIFFERENCE" ||
    value === "DA DIFFERENCE"
  ) {
    return "DA_DIFFERENCE";
  }
  return "ALL";
}

/**
 * Filters:
 *   sectionId / instituteCode — Institute Master relationship
 *   allMonths — ignore the month range entirely
 *   fromMonth/fromYear, toMonth/toYear — inclusive chronological range on
 *     the SALARY MONTH (same membership rule as the Cheque Register)
 *   salaryType — ALL | REGULAR | OLD (OLD never dropped unless REGULAR chosen)
 *   salaryTime — ALL | REGULAR (salary section only) | DA_DIFFERENCE (DA only)
 */
function filterSalaryRows(rows, query) {
  const sectionId = toIntOrNull(query.sectionId);
  const instituteCode = String(query.instituteCode || query.institute || "")
    .trim()
    .toUpperCase();
  const allMonths =
    String(query.allMonths || "").trim() === "1" ||
    String(query.allMonths || "").trim().toLowerCase() === "true" ||
    String(query.monthRange || "").trim().toUpperCase() === "ALL";
  const salaryType = parseSalaryTypeFilter(query.salaryType || query.table);

  let fromIndex = null;
  let toIndex = null;
  if (!allMonths) {
    const fromMonth = toIntOrNull(
      query.fromMonth != null ? query.fromMonth : query.month
    );
    const fromYear = toIntOrNull(
      query.fromYear != null ? query.fromYear : query.year
    );
    const toMonth = toIntOrNull(
      query.toMonth != null ? query.toMonth : query.month
    );
    const toYear = toIntOrNull(
      query.toYear != null ? query.toYear : query.year
    );
    if (fromMonth != null && fromYear != null) {
      fromIndex = fromYear * 12 + fromMonth;
    }
    if (toMonth != null && toYear != null) {
      toIndex = toYear * 12 + toMonth;
    }
    if (fromIndex != null && toIndex != null && fromIndex > toIndex) {
      const swap = fromIndex;
      fromIndex = toIndex;
      toIndex = swap;
    }
  }

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) return false;
    if (sectionId != null && Number(row.sectionId) !== sectionId) return false;
    if (
      instituteCode &&
      String(row.instituteCode || "").trim().toUpperCase() !== instituteCode
    ) {
      return false;
    }
    /* Regular Salary = REGULAR + OLD for the selected Salary Month; Old
       Salary still narrows to OLD only (utils/salaryMonthKey.js). */
    if (
      (salaryType === "REGULAR" || salaryType === "OLD") &&
      !billTypeMatchesFilter(salaryType, row.type)
    ) {
      return false;
    }
    if (fromIndex != null || toIndex != null) {
      const idx = row.salaryMonthIndex;
      if (idx == null) return false;
      if (fromIndex != null && idx < fromIndex) return false;
      if (toIndex != null && idx > toIndex) return false;
    }
    return true;
  });
}

/**
 * A DA bill belongs to the selected period when its difference period
 * overlaps the range — a JAN..APR arrears bill paid in August still shows
 * for a JAN..JUN selection, and never for an unrelated year.
 */
function filterDaRows(rows, query) {
  const sectionId = toIntOrNull(query.sectionId);
  const instituteCode = String(query.instituteCode || query.institute || "")
    .trim()
    .toUpperCase();
  const allMonths =
    String(query.allMonths || "").trim() === "1" ||
    String(query.allMonths || "").trim().toLowerCase() === "true" ||
    String(query.monthRange || "").trim().toUpperCase() === "ALL";

  let fromIndex = null;
  let toIndex = null;
  if (!allMonths) {
    const fromMonth = toIntOrNull(
      query.fromMonth != null ? query.fromMonth : query.month
    );
    const fromYear = toIntOrNull(
      query.fromYear != null ? query.fromYear : query.year
    );
    const toMonth = toIntOrNull(
      query.toMonth != null ? query.toMonth : query.month
    );
    const toYear = toIntOrNull(
      query.toYear != null ? query.toYear : query.year
    );
    if (fromMonth != null && fromYear != null) {
      fromIndex = fromYear * 12 + fromMonth;
    }
    if (toMonth != null && toYear != null) {
      toIndex = toYear * 12 + toMonth;
    }
    if (fromIndex != null && toIndex != null && fromIndex > toIndex) {
      const swap = fromIndex;
      fromIndex = toIndex;
      toIndex = swap;
    }
  }

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) return false;
    if (sectionId != null && Number(row.sectionId) !== sectionId) return false;
    if (
      instituteCode &&
      String(row.instituteCode || "").trim().toUpperCase() !== instituteCode
    ) {
      return false;
    }
    if (fromIndex != null && row.toIndex != null && row.toIndex < fromIndex) {
      return false;
    }
    if (toIndex != null && row.fromIndex != null && row.fromIndex > toIndex) {
      return false;
    }
    return true;
  });
}

function compareSalaryRows(a, b) {
  const ai = a.salaryMonthIndex != null ? a.salaryMonthIndex : 0;
  const bi = b.salaryMonthIndex != null ? b.salaryMonthIndex : 0;
  if (ai !== bi) return ai - bi;
  if (a.type !== b.type) return a.type === "REGULAR" ? -1 : 1;
  const ao = a.displayOrder != null ? a.displayOrder : Number.MAX_SAFE_INTEGER;
  const bo = b.displayOrder != null ? b.displayOrder : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  if (a.employeeId !== b.employeeId) return a.employeeId - b.employeeId;
  return String(a.billCode || "").localeCompare(String(b.billCode || ""));
}

function monthRangeLabel(query) {
  const allMonths =
    String(query.allMonths || "").trim() === "1" ||
    String(query.allMonths || "").trim().toLowerCase() === "true" ||
    String(query.monthRange || "").trim().toUpperCase() === "ALL";
  if (allMonths) return "ALL MONTHS";
  const fromMonth = toIntOrNull(
    query.fromMonth != null ? query.fromMonth : query.month
  );
  const fromYear = toIntOrNull(
    query.fromYear != null ? query.fromYear : query.year
  );
  const toMonth = toIntOrNull(
    query.toMonth != null ? query.toMonth : query.month
  );
  const toYear = toIntOrNull(
    query.toYear != null ? query.toYear : query.year
  );
  const from =
    fromMonth != null && fromYear != null
      ? formatMonthLabel({ month: fromMonth, year: fromYear })
      : "";
  const to =
    toMonth != null && toYear != null
      ? formatMonthLabel({ month: toMonth, year: toYear })
      : "";
  if (from && to) return from === to ? from : `${from} TO ${to}`;
  return from || to || "ALL MONTHS";
}

async function buildInstituteWiseSalaryReport(query) {
  const q = query || {};
  const salaryTime = parseSalaryTimeFilter(q.salaryTime);
  const salaryType = parseSalaryTypeFilter(q.salaryType || q.table);

  const salaryRows =
    salaryTime === "DA_DIFFERENCE"
      ? []
      : filterSalaryRows((await loadSalaryRows()).map(mapSalaryRow), q);
  const daRows =
    salaryTime === "REGULAR"
      ? []
      : filterDaRows((await loadDaRows()).map(mapDaRow), q);

  const truncated = salaryRows.length + daRows.length > MAX_ROWS;

  /* Group salary rows: institute -> salary month. REGULAR/OLD stay separate rows. */
  const byInstitute = new Map();
  const takeSalary = truncated
    ? salaryRows.slice(0, MAX_ROWS)
    : salaryRows;
  for (const row of takeSalary) {
    const key = String(row.instituteCode || "").trim().toUpperCase();
    if (!byInstitute.has(key)) {
      byInstitute.set(key, {
        code: row.instituteCode,
        instituteName: row.instituteName,
        sectionId: row.sectionId,
        sectionSrNo: row.sectionSrNo,
        sectionName: row.sectionName,
        months: new Map(),
        daBills: new Map(),
      });
    }
    const inst = byInstitute.get(key);
    const mKey = row.salaryMonthKey || row.salaryMonth;
    if (!inst.months.has(mKey)) {
      inst.months.set(mKey, {
        key: mKey,
        label: row.salaryMonth,
        index: row.salaryMonthIndex,
        rows: [],
      });
    }
    inst.months.get(mKey).rows.push(row);
  }

  /* DA bills attach to their institute, kept whole (period + paid month). */
  const takeDa = truncated
    ? daRows.slice(0, Math.max(0, MAX_ROWS - takeSalary.length))
    : daRows;
  for (const row of takeDa) {
    const key = String(row.instituteCode || "").trim().toUpperCase();
    if (!byInstitute.has(key)) {
      byInstitute.set(key, {
        code: row.instituteCode,
        instituteName: row.instituteName,
        sectionId: row.sectionId,
        sectionSrNo: row.sectionSrNo,
        sectionName: row.sectionName,
        months: new Map(),
        daBills: new Map(),
      });
    }
    const inst = byInstitute.get(key);
    const dKey = `${row.daBillId}`;
    if (!inst.daBills.has(dKey)) {
      inst.daBills.set(dKey, {
        billCode: row.billCode,
        period: row.period,
        paidMonth: row.paidMonth,
        fromIndex: row.fromIndex,
        rows: [],
      });
    }
    inst.daBills.get(dKey).rows.push(row);
  }

  const institutes = [...byInstitute.values()]
    .map((inst) => {
      const months = [...inst.months.values()]
        .map((m) => {
          const rows = m.rows.sort(compareSalaryRows).map((row, idx) => ({
            srNo: idx + 1,
            ...row,
          }));
          return {
            key: m.key,
            label: m.label,
            rows,
            total: rows.reduce((acc, r) => addToTotals(acc, r), emptyTotals()),
            rowCount: rows.length,
          };
        })
        .sort((a, b) => (a.index || 0) - (b.index || 0));

      const daBills = [...inst.daBills.values()]
        .map((d) => {
          const rows = d.rows
            .sort((a, b) => {
              const ao = a.displayOrder != null ? a.displayOrder : Number.MAX_SAFE_INTEGER;
              const bo = b.displayOrder != null ? b.displayOrder : Number.MAX_SAFE_INTEGER;
              if (ao !== bo) return ao - bo;
              return a.employeeId - b.employeeId;
            })
            .map((row, idx) => ({ srNo: idx + 1, ...row }));
          return {
            billCode: d.billCode,
            period: d.period,
            paidMonth: d.paidMonth,
            rows,
            total: rows.reduce((acc, r) => addToTotals(acc, r), emptyTotals()),
            rowCount: rows.length,
          };
        })
        .sort((a, b) => (a.fromIndex || 0) - (b.fromIndex || 0));

      const salaryTotal = months.reduce(
        (acc, m) =>
          Object.keys(acc).reduce((o, k) => {
            o[k] = round2(o[k] + toNum(m.total[k]));
            return o;
          }, { ...acc }),
        emptyTotals()
      );
      const daTotal = daBills.reduce(
        (acc, d) =>
          Object.keys(acc).reduce((o, k) => {
            o[k] = round2(o[k] + toNum(d.total[k]));
            return o;
          }, { ...acc }),
        emptyTotals()
      );

      return {
        code: inst.code,
        instituteName: inst.instituteName,
        sectionName: inst.sectionName || "",
        months,
        daBills,
        salaryTotal,
        daTotal,
        rowCount:
          months.reduce((n, m) => n + m.rowCount, 0) +
          daBills.reduce((n, d) => n + d.rowCount, 0),
      };
    })
    .sort((a, b) => {
      const sa = sectionRankOf(a);
      const sb = sectionRankOf(b);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return compareGroupCodes(a.code, b.code);
    });

  const grandTotal = institutes.reduce(
    (acc, inst) => {
      ["salaryTotal", "daTotal"].forEach((k) => {
        Object.keys(acc).forEach((field) => {
          acc[field] = round2(acc[field] + toNum(inst[k][field]));
        });
      });
      return acc;
    },
    emptyTotals()
  );

  let sectionTitle = "ALL SECTIONS";
  const sectionId = toIntOrNull(q.sectionId);
  if (sectionId != null) {
    const names = [
      ...new Set(
        institutes.map((i) => i.sectionName).filter((n) => n && n.trim() !== "")
      ),
    ];
    if (names.length === 1) sectionTitle = names[0].toUpperCase();
  }

  const rowCount =
    salaryRows.length + daRows.length;

  return {
    heading: HEADING,
    /* The exclusion is explicit, never silent. */
    salaryCategoryScope: excludedScopeNote(
      "a DA Difference record has no Basic, DA, HRA, Gross or Net components"
    ),
    subHeading: SUBHEADING,
    sectionTitle,
    monthLine: monthRangeLabel(q),
    salaryType:
      salaryType === "ALL" ? "ALL" : salaryType === "OLD" ? "OLD" : "REGULAR",
    salaryTime:
      salaryTime === "ALL"
        ? "ALL"
        : salaryTime === "DA_DIFFERENCE"
          ? "DA DIFFERENCE"
          : "REGULAR",
    institutes,
    grandTotal,
    instituteCount: institutes.length,
    rowCount,
    truncated,
    maxRows: MAX_ROWS,
  };
}

function sendReport(req, res) {
  buildInstituteWiseSalaryReport(req.query || {})
    .then((data) => res.json({ message: "OK", data }))
    .catch((error) => {
      console.error("GET /api/institute-wise-salary error:", error);
      res.status(500).json({
        message: "Unable to load the Institute Wise Salary Report.",
        error: error.message,
      });
    });
}

/* GET /api/institute-wise-salary?... */
router.get("/", sendReport);

/* GET /api/institute-wise-salary/meta — filter dropdown options */
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
        institutes,
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
        salaryTimes: [
          { value: "ALL", label: "All" },
          { value: "REGULAR", label: "Regular Salary (incl. Old)" },
          { value: "DA_DIFFERENCE", label: "DA Difference" },
        ],
      },
    });
  } catch (error) {
    console.error("GET /api/institute-wise-salary/meta error:", error);
    res.status(500).json({
      message: "Unable to load Institute Wise Salary filters.",
      error: error.message,
    });
  }
});

const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "empName", label: "Employee Name" },
  { key: "mode", label: "Mode" },
  { key: "designation", label: "Designation" },
  { key: "basic", label: "Basic", type: "number" },
  { key: "gradePay", label: "G.P.", type: "number" },
  { key: "da", label: "D.A.", type: "number" },
  { key: "hra", label: "H.R.A.", type: "number" },
  { key: "medi", label: "Medi.", type: "number" },
  { key: "cla", label: "C.L.A.", type: "number" },
  { key: "ta", label: "T.A.", type: "number" },
  { key: "speAll", label: "Spe. All.", type: "number" },
  { key: "gross", label: "Gross", type: "number" },
  { key: "gpf", label: "GPF", type: "number" },
  { key: "gpfAdv", label: "GPF Adv.", type: "number" },
  { key: "nps", label: "NPS", type: "number" },
  { key: "it", label: "I. Tax", type: "number" },
  { key: "pt", label: "P. Tax", type: "number" },
  { key: "othDed", label: "Oth. Dedu.", type: "number" },
  { key: "totalDed", label: "Total Dedu.", type: "number" },
  { key: "net", label: "Net Sal.", type: "number" },
];

/* GET /api/institute-wise-salary/export.xlsx — same builder as the screen */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildInstituteWiseSalaryReport(req.query || {});

    const heading = [
      [data.heading],
      [data.subHeading],
      [`Section: ${data.sectionTitle}`],
      [
        `Month: ${data.monthLine}`,
        `Salary Type: ${data.salaryType}`,
        `Salary Time: ${data.salaryTime}`,
      ],
      [],
    ];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = [];
    for (const inst of data.institutes) {
      body.push([`INSTITUTE: ${inst.code} - ${inst.instituteName}`]);
      for (const month of inst.months) {
        body.push([`MONTH: ${month.label}`]);
        for (const row of month.rows) {
          body.push(
            XLSX_COLUMNS.map((column) => {
              const value = row[column.key];
              if (column.type === "number") return Number(value || 0);
              return value == null ? "" : String(value);
            })
          );
        }
        const monthTotal = ["TOTAL"];
        XLSX_COLUMNS.forEach((column, index) => {
          if (index === 0) return;
          if (column.type === "number") {
            monthTotal.push(Number(month.total[column.key] || 0));
          } else monthTotal.push("");
        });
        body.push(monthTotal);
      }
      for (const da of inst.daBills) {
        body.push([`DA: ${da.period}${da.paidMonth ? ` (Paid: ${da.paidMonth})` : ""}`]);
        for (const row of da.rows) {
          body.push(
            XLSX_COLUMNS.map((column) => {
              const value = row[column.key];
              if (column.type === "number") return Number(value || 0);
              return value == null ? "" : String(value);
            })
          );
        }
        const daTotal = ["TOTAL"];
        XLSX_COLUMNS.forEach((column, index) => {
          if (index === 0) return;
          if (column.type === "number") {
            daTotal.push(Number(da.total[column.key] || 0));
          } else daTotal.push("");
        });
        body.push(daTotal);
      }
      body.push([]);
    }
    const grand = ["GRAND TOTAL"];
    XLSX_COLUMNS.forEach((column, index) => {
      if (index === 0) return;
      if (column.type === "number") {
        grand.push(Number(data.grandTotal[column.key] || 0));
      } else grand.push("");
    });
    if (data.institutes.length > 0) body.push(grand);

    const sheet = XLSX.utils.aoa_to_sheet([...heading, header, ...body]);
    sheet["!cols"] = XLSX_COLUMNS.map((c) => ({
      wch: Math.max(10, c.label.length + 2),
    }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Institute Wise Salary");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Institute_Wise_Salary_${data.monthLine.replace(
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
    console.error("GET /api/institute-wise-salary/export.xlsx error:", error);
    res.status(500).json({
      message: "Unable to export the Institute Wise Salary Report.",
      error: error.message,
    });
  }
});

module.exports = router;
/* Exported for offline tests. */
module.exports.loadSalaryRows = loadSalaryRows;
module.exports.loadDaRows = loadDaRows;
module.exports.mapSalaryRow = mapSalaryRow;
module.exports.mapDaRow = mapDaRow;
module.exports.filterSalaryRows = filterSalaryRows;
module.exports.filterDaRows = filterDaRows;
module.exports.buildInstituteWiseSalaryReport = buildInstituteWiseSalaryReport;
module.exports.monthIndex = monthIndex;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
