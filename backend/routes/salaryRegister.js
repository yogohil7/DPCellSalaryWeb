/**
 * SALARY REGISTER  (the project's bill-wise salary abstract)
 *
 * One row per APPROVED/LOCKED salary bill per institute — row identity
 * (BillCodeId, InstituteCode). This is the grain the legacy DP Cell
 * FrmSalaryRegister printed, and the grain no other report in this project
 * covers: Cheque Register is institute-bill but cheque-oriented, Institute
 * Wise Salary and Employee Wise Salary are employee-level, Section Summary is
 * section-level.
 *
 * This module computes NO salary. Every amount is a SUM of the STORED
 * dbo.SalaryEmployeeDetails values Salary Entry saved and Salary Bill Approval
 * displays. It never recomputes a component, and it never writes.
 *
 * Shared rules are imported, never copied:
 *   APPROVED_WORKFLOW_STATUSES   which bills may appear at all
 *   resolveChequeSalaryType      REGULAR vs OLD
 *   salaryMonthPartsOf           the report period
 *   billMonthPartsOf             the independently displayed Bill Month
 *   compareGroupCodes            natural institute ordering
 *   loadDaDifferenceRows         the one DA Difference source
 *
 * There is deliberately no Return Amount column: no such field exists in this
 * schema, and a fabricated or inferred value on a financial register would be
 * worse than its absence.
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
  matchesFilterMonthYear,
  billTypeMatchesFilter,
  formatMonthLabel,
} = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  resolveChequeSalaryType,
  compareGroupCodes,
  billMonthPartsOf,
  salaryMonthPartsOf,
} = require("./chequeRegister");
const {
  CATEGORY_DA_DIFFERENCE,
  loadDaDifferenceRows,
} = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = [
  "SALARY REGISTER",
  "DIRECTOR OF SOCIAL DEFENCE",
  "BLOCK NO. 16 OLD SACHIVALAY,",
  "GANDHINAGAR",
];

const MONTH_FULL_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const TYPE_REGULAR = "REGULAR";
const TYPE_OLD = "OLD";
const TYPE_DA_DIFFERENCE = CATEGORY_DA_DIFFERENCE;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

function monthLabel(parts) {
  if (!parts) return "";
  return `${MONTH_FULL_NAMES[parts.month - 1]} ${parts.year}`;
}

function dateOnly(value) {
  if (!value) return "";
  const raw = String(value instanceof Date ? value.toISOString() : value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : raw;
}

/**
 * Salary (REGULAR/OLD) bill aggregates.
 *
 * Employee count is COUNT(DISTINCT d.EmployeeId) and every money column is a
 * SUM of its stored column — including ChequeAmount, which is READ rather than
 * derived from Net + IT + PT.
 *
 * The tagged template is parameterised by the driver; no user value is
 * concatenated into this statement. Selection is applied in JS afterwards, the
 * same way the Cheque Register and Bank Copy do it.
 */
async function loadSalaryBillAggregates() {
  const result = await queryReport(`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      w.WorkflowId,
      w.BillMonth           AS WorkflowBillMonth,
      w.InstituteCode,
      w.Status              AS WorkflowStatus,
      w.BillNo,
      w.BillDate,
      w.ApprovedBy,
      w.ApprovedDate,
      i.InstituteName,
      i.SectionId,
      sec.SrNo              AS SectionSrNo,
      sec.SectionName,
      COUNT(DISTINCT d.EmployeeId)          AS EmployeeCount,
      ISNULL(SUM(d.GrossSalary), 0)         AS GrossAmount,
      ISNULL(SUM(d.TotalDeduction), 0)      AS TotalDeduction,
      ISNULL(SUM(d.NetSalary), 0)           AS NetSalary,
      ISNULL(SUM(d.ChequeAmount), 0)        AS ChequeAmount
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN ${instanceEmployeeRowsSql()} d
      ON d.InstanceWorkflowId = w.WorkflowId
    LEFT JOIN dbo.Institutes i
      ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections sec
      ON sec.SectionId = i.SectionId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
    GROUP BY
      b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth,
      b.SalaryMonthNumber, b.SalaryYear,
      w.WorkflowId, w.BillMonth,
      w.InstituteCode, w.Status, w.BillNo, w.BillDate,
      w.ApprovedBy, w.ApprovedDate,
      i.InstituteName, i.SectionId, sec.SrNo, sec.SectionName
  `);
  return result.recordset;
}

/**
 * One salary aggregate -> one register row.
 *
 * REGULAR vs OLD comes from the shared resolver: REGULAR when the normalized
 * Bill Month equals the Salary Month, OLD otherwise. The two are never merged,
 * and two bills of one salary month with different Bill Months stay two rows
 * because the row identity is (BillCodeId, InstituteCode).
 */
function mapSalaryBillRow(row, headers) {
  /* .map(mapSalaryBillRow) passes an index here - only a Map is a header set. */
  const headerMap = headers instanceof Map ? headers : new Map();
  const salaryYm = salaryMonthPartsOf(
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );
  /*
     Bill Month is parsed on its own. normalizeYearMonth short-circuits on an
     explicit month number + year, so passing SalaryMonthNumber alongside
     BillMonth would silently return the SALARY month for JUN-2026-BM-MAY.
  */
  /* The Bill Month of THIS approved instance (its workflow row), never the
     master SalaryBillCodes.BillMonth shared by every instance of the bill. */
  const billYm = instanceBillMonthPartsOf(row);
  /* Headers are keyed by the canonical MON-YYYY label (e.g. JUL-2026). */
  const header = resolveInstanceHeader(headerMap, row, formatMonthLabel(billYm));

  return {
    billCodeId: Number(row.BillCodeId),
    instituteCode: String(row.InstituteCode || "").trim(),
    instituteName: row.InstituteName || row.InstituteCode || "",
    sectionId: row.SectionId == null ? null : Number(row.SectionId),
    sectionSrNo: row.SectionSrNo == null ? null : Number(row.SectionSrNo),
    sectionName: row.SectionName || "",
    billCode: row.BillCode || "",

    /* Independent, and both displayed. */
    billMonth: monthLabel(billYm) || row.BillMonth || "",
    salaryMonth: monthLabel(salaryYm) || row.SalaryMonth || "",
    salaryMonthParts: salaryYm,
    billMonthParts: billYm,

    workflowId: row.WorkflowId == null ? null : Number(row.WorkflowId),
    /* Bill No. / Bill Date of exactly this instance (its Bill-Month header,
       else its own workflow row) - never another instance's. */
    billNo: header.billNo,
    billDate: dateOnly(header.billDate),
    salaryType: resolveChequeSalaryType({
      salaryMonth: row.SalaryMonth,
      billMonth: monthLabel(billYm),
      salaryYear: row.SalaryYear,
      billYear: billYm ? billYm.year : row.SalaryYear,
      salaryMonthNumber: row.SalaryMonthNumber,
    }),

    employees: Number(row.EmployeeCount || 0),
    /* Stored sums only — nothing derived from components. */
    grossAmount: round2(row.GrossAmount),
    totalDeduction: round2(row.TotalDeduction),
    netSalary: round2(row.NetSalary),
    chequeAmount: round2(row.ChequeAmount),

    approvedBy: row.ApprovedBy || "",
    approvedDate: dateOnly(row.ApprovedDate),
    status: String(row.WorkflowStatus || "").trim().toUpperCase(),
  };
}

/**
 * DA Difference bill aggregates, from the one shared DA loader.
 *
 * Only the three amounts the DA schema actually stores are used:
 *   Gross     = TotalDifferenceAmount
 *   Deduction = TotalNPSDeduction
 *   Net       = TotalNetDifferenceAmount
 *
 * dbo.DADifferenceEmployeeDetails has no Basic, DA, HRA, TA, CLA, GPF, PT or
 * IT column, so no such value is invented. Cheque Amount does not exist for a
 * DA bill either and is left null, which the screen renders as an em dash
 * rather than a fabricated 0.00.
 */
function aggregateDaRows(daRows) {
  const groups = new Map();

  for (const row of daRows) {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) continue;

    const key = `${row.billCodeId}::${row.instituteCode}`;
    if (!groups.has(key)) {
      groups.set(key, {
        billCodeId: Number(row.billCodeId),
        instituteCode: String(row.instituteCode || "").trim(),
        instituteName: row.instituteName || row.instituteCode || "",
        sectionId: row.sectionId == null ? null : Number(row.sectionId),
        sectionSrNo: row.sectionSrNo == null ? null : Number(row.sectionSrNo),
        sectionName: row.sectionName || "",
        billCode: row.billCode || "",
        billMonth: row.paidMonth || "",
        salaryMonth: row.salaryMonth || "",
        salaryMonthParts: null,
        billMonthParts: null,
        salaryMonthKey: row.salaryMonthKey,
        billNo: row.billNo == null ? "" : String(row.billNo),
        billDate: "",
        salaryType: TYPE_DA_DIFFERENCE,
        employeeIds: new Set(),
        grossAmount: 0,
        totalDeduction: 0,
        netSalary: 0,
        /* No stored cheque amount exists for a DA bill. */
        chequeAmount: null,
        approvedBy: "",
        approvedDate: "",
        status: row.workflowStatus,
      });
    }
    const group = groups.get(key);
    group.employeeIds.add(Number(row.employeeId));
    group.grossAmount = round2(group.grossAmount + toNum(row.differenceAmount));
    group.totalDeduction = round2(group.totalDeduction + toNum(row.nps));
    group.netSalary = round2(group.netSalary + toNum(row.net));
  }

  return [...groups.values()].map((group) => {
    const { employeeIds, salaryMonthKey, ...rest } = group;
    return {
      ...rest,
      employees: employeeIds.size,
      salaryMonthParts: salaryMonthKey
        ? {
            year: Number(String(salaryMonthKey).slice(0, 4)),
            month: Number(String(salaryMonthKey).slice(5, 7)),
          }
        : null,
    };
  });
}

/** ALL / REGULAR / OLD / DA_DIFFERENCE. Anything else means ALL. */
function parseSalaryType(query = {}) {
  const raw = String(query.salaryType || "ALL")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (raw === TYPE_REGULAR || raw === TYPE_OLD || raw === TYPE_DA_DIFFERENCE) {
    return raw;
  }
  return "ALL";
}

/**
 * Narrows the mapped rows.
 *
 * Period is the SALARY month, the project-wide report convention. Bill Month
 * is a separate, optional filter — never a substitute for the period.
 */
function filterRegisterRows(rows, query = {}) {
  const month =
    query.month != null && query.month !== "" ? Number(query.month) : null;
  const year =
    query.year != null && query.year !== "" ? Number(query.year) : null;
  const billMonth =
    query.billMonth != null && query.billMonth !== ""
      ? Number(query.billMonth)
      : null;
  const billYear =
    query.billYear != null && query.billYear !== ""
      ? Number(query.billYear)
      : year;
  const sectionId =
    query.sectionId != null && query.sectionId !== ""
      ? Number(query.sectionId)
      : null;
  const instituteCode = String(query.instituteCode || "").trim();
  const salaryType = parseSalaryType(query);

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.status)) return false;

    if (month != null && year != null) {
      if (!matchesFilterMonthYear(row.salaryMonthParts, month, year)) {
        return false;
      }
    }
    if (billMonth != null && billYear != null) {
      if (!matchesFilterMonthYear(row.billMonthParts, billMonth, billYear)) {
        return false;
      }
    }
    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.sectionId) !== sectionId) return false;
    }
    if (instituteCode && row.instituteCode !== instituteCode) return false;

    /* Regular Salary = REGULAR + OLD for the selected Salary Month; Old
       Salary and DA Difference still narrow exactly (utils/salaryMonthKey.js). */
    if (!billTypeMatchesFilter(salaryType, row.salaryType)) return false;

    return true;
  });
}

/** Section order, then natural institute code, then bill code. */
function sectionRank(row) {
  const raw = row?.sectionSrNo;
  if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
  const srNo = Number(raw);
  return Number.isFinite(srNo) ? srNo : Number.MAX_SAFE_INTEGER;
}

function compareRegisterRows(a, b) {
  const rank = sectionRank(a) - sectionRank(b);
  if (rank !== 0) return rank < 0 ? -1 : 1;
  const inst = compareGroupCodes(a.instituteCode, b.instituteCode);
  if (inst !== 0) return inst;
  const code = String(a.billCode).localeCompare(String(b.billCode));
  if (code !== 0) return code;
  /* Same bill + institute, different Bill Month instances: stable order. */
  return String(a.billMonth || "").localeCompare(String(b.billMonth || ""));
}

async function buildSalaryRegisterReport(query = {}) {
  const headers = await loadInstanceHeaders();
  const salaryRows = (await loadSalaryBillAggregates()).map((row) =>
    mapSalaryBillRow(row, headers)
  );
  const daRows = aggregateDaRows(await loadDaDifferenceRows());

  /* Concatenated, never joined: a DA bill is its own row. */
  const rows = filterRegisterRows([...salaryRows, ...daRows], query)
    .sort(compareRegisterRows)
    .map((row, index) => {
      const { salaryMonthParts, billMonthParts, ...rest } = row;
      return { srNo: index + 1, ...rest };
    });

  /* Totals are of the DISPLAYED rows only. */
  const totals = rows.reduce(
    (acc, row) => ({
      employees: acc.employees + toNum(row.employees),
      grossAmount: round2(acc.grossAmount + toNum(row.grossAmount)),
      totalDeduction: round2(acc.totalDeduction + toNum(row.totalDeduction)),
      netSalary: round2(acc.netSalary + toNum(row.netSalary)),
      /* null cheque amounts contribute nothing rather than a fake zero. */
      chequeAmount: round2(acc.chequeAmount + toNum(row.chequeAmount)),
    }),
    { employees: 0, grossAmount: 0, totalDeduction: 0, netSalary: 0, chequeAmount: 0 }
  );

  const month = query.month;
  const year = query.year;
  const periodParts =
    month != null && month !== "" && year != null && year !== ""
      ? { year: Number(year), month: Number(month) }
      : null;

  return {
    heading: HEADING,
    periodLabel: periodParts ? monthLabel(periodParts) : "ALL",
    rows,
    totals,
    billCount: rows.length,
    filters: {
      month: month != null && month !== "" ? Number(month) : null,
      year: year != null && year !== "" ? Number(year) : null,
      billMonth:
        query.billMonth != null && query.billMonth !== ""
          ? Number(query.billMonth)
          : null,
      sectionId:
        query.sectionId != null && query.sectionId !== ""
          ? Number(query.sectionId)
          : null,
      instituteCode: String(query.instituteCode || "").trim() || null,
      salaryType: parseSalaryType(query),
    },
  };
}

function toIntOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * SALARY REGISTER DRILL-DOWN — employee-wise detail of exactly ONE Salary
 * Register row (2026-09-25).
 *
 * A register row's identity is its WorkflowId (see mapSalaryBillRow / the
 * reportBillInstance.js module doc): one dbo.SalaryBillInstituteWorkflow row,
 * i.e. one institute, one bill, one Bill Month INSTANCE. Filtering this
 * query on that single WorkflowId is therefore already the exact
 * restriction the drill-down needs — never "all employees of this Salary
 * Month", never "all employees of this institute". A JUL-2026 instance and
 * an AUG-2026 instance of the same institute/bill have different WorkflowIds
 * and can never be confused by this query.
 *
 * Employee rows come from the SAME instanceEmployeeRowsSql() derived table
 * every other report reuses (dbo.SalaryEmployeeDetails for the canonical /
 * "-BM-" instance, dbo.SalaryEntryBillEmployeeDetails for an earlier Bill
 * Month instance) — the exact SAVED values Salary Entry wrote and Salary
 * Bill Approval displayed. Nothing is recalculated: this is a plain SELECT,
 * parameterised on WorkflowId, and it never writes.
 *
 * Only columns that actually exist are selected:
 *   dbo.SalaryEmployeeDetails / SalaryEntryBillEmployeeDetails (via the
 *     shared INSTANCE_EMPLOYEE_COLUMNS list) for every salary figure and the
 *     bill-time PayLevel snapshot;
 *   dbo.EmployeeMaster (EmployeeCode) and dbo.Designations (a designation
 *     name fallback) for the two identifying columns the component tables do
 *     not themselves carry.
 * There is no PAN column anywhere in this schema (see grep across
 * backend/sql/schema — confirmed absent), so none is invented; EmployeeCode
 * is used as the employee's existing external identifier instead.
 */
async function loadSalaryRegisterDetailRows(workflowId) {
  const request = new sql.Request();
  request.input("workflowId", sql.Int, workflowId);
  const result = await request.query(`
    SELECT
      w.WorkflowId,
      w.InstituteCode,
      w.Status                AS WorkflowStatus,
      d.Id                     AS DetailId,
      d.EmployeeId,
      d.EmployeeName,
      d.Designation,
      d.DisplayOrder,
      d.PensionType,
      d.BasicPay,
      d.GradePay,
      d.TotalBasic,
      d.PayLevel,
      d.DA,
      d.HRA,
      d.MA,
      d.TA,
      ISNULL(d.CLA, 0)         AS CLA,
      d.SpecialAllowance,
      d.WashingAllowance,
      d.OtherEarnings,
      d.NPPA,
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
      em.EmployeeCode,
      des.DesignationName      AS MasterDesignationName
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN ${instanceEmployeeRowsSql()} d
      ON d.InstanceWorkflowId = w.WorkflowId
    LEFT JOIN dbo.EmployeeMaster em
      ON em.EmployeeId = d.EmployeeId
    LEFT JOIN dbo.Designations des
      ON des.DesignationId = em.DesignationId
    WHERE w.WorkflowId = @workflowId
      AND UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
    ORDER BY d.DisplayOrder, d.Id
  `);
  return result.recordset;
}

const DETAIL_TOTAL_KEYS = [
  "basicPay", "gradePay", "totalBasic", "da", "hra", "ta", "ma", "cla",
  "otherAllowances", "grossSalary", "gpfSubscription", "gpfAdvance", "nps",
  "incomeTax", "professionalTax", "otherDeduction", "totalDeduction",
  "netSalary", "chequeAmount",
];

function emptyDetailTotals() {
  const totals = {};
  DETAIL_TOTAL_KEYS.forEach((key) => { totals[key] = 0; });
  return totals;
}

function addDetailTotals(totals, row) {
  DETAIL_TOTAL_KEYS.forEach((key) => {
    totals[key] = round2(totals[key] + toNum(row[key]));
  });
  return totals;
}

/**
 * One SAVED dbo.SalaryEmployeeDetails / SalaryEntryBillEmployeeDetails row ->
 * one detail-screen row. "Other Allowances" combines the four additive
 * earnings columns beyond DA/HRA/MA/TA/CLA that this schema actually has
 * (SpecialAllowance, WashingAllowance, OtherEarnings, NPPA) into one figure,
 * rather than listing four rarely-used columns; Gross Salary itself is still
 * the STORED d.GrossSalary, never a sum of the columns shown here, so it
 * reconciles with Salary Register exactly as saved.
 */
function mapDetailEmployeeRow(row) {
  return {
    detailId: row.DetailId != null ? Number(row.DetailId) : null,
    employeeId: Number(row.EmployeeId),
    employeeName: row.EmployeeName || "",
    employeeCode:
      row.EmployeeCode != null && String(row.EmployeeCode).trim() !== ""
        ? String(row.EmployeeCode)
        : String(row.EmployeeId),
    designation: row.MasterDesignationName || row.Designation || "",
    displayOrder: toNum(row.DisplayOrder),
    payLevel:
      row.PayLevel != null && String(row.PayLevel).trim() !== ""
        ? String(row.PayLevel).trim()
        : "",
    basicPay: round2(row.BasicPay),
    gradePay: round2(row.GradePay),
    totalBasic: round2(row.TotalBasic),
    da: round2(row.DA),
    hra: round2(row.HRA),
    ta: round2(row.TA),
    ma: round2(row.MA),
    cla: round2(row.CLA),
    otherAllowances: round2(
      toNum(row.SpecialAllowance) +
        toNum(row.WashingAllowance) +
        toNum(row.OtherEarnings) +
        toNum(row.NPPA)
    ),
    grossSalary: round2(row.GrossSalary),
    gpfSubscription: round2(row.GPFSubscription),
    nps: round2(row.NPS),
    gpfAdvance: round2(row.GPFAdvance),
    incomeTax: round2(row.IncomeTax),
    professionalTax: round2(row.ProfessionalTax),
    otherDeduction: round2(row.OtherDeduction),
    totalDeduction: round2(row.TotalDeduction),
    netSalary: round2(row.NetSalary),
    chequeAmount: round2(row.ChequeAmount),
  };
}

/**
 * Builds the drill-down report for exactly one Salary Register row.
 *
 * query.workflowId is required and is the ONLY thing that decides which
 * employees come back (see loadSalaryRegisterDetailRows). query.instituteCode
 * and query.billCodeId are optional and, when the caller (the clicked Salary
 * Register row) supplies them, must agree with what that WorkflowId actually
 * resolves to — a defence against a stale or hand-edited link silently
 * showing a different bill's employees under the wrong header.
 */
async function buildSalaryRegisterDetailReport(query = {}) {
  const workflowId = toIntOrNull(query.workflowId);
  if (workflowId == null) {
    const err = new Error("workflowId is required to open the Salary Register detail.");
    err.status = 400;
    throw err;
  }

  const headers = await loadInstanceHeaders();
  const registerRows = (await loadSalaryBillAggregates()).map((row) =>
    mapSalaryBillRow(row, headers)
  );
  const registerRow = registerRows.find((r) => r.workflowId === workflowId);
  if (!registerRow) {
    const err = new Error(
      "That Salary Register bill instance was not found (it may no longer be approved or locked)."
    );
    err.status = 404;
    throw err;
  }

  const expectInstitute = String(query.instituteCode || "").trim();
  if (expectInstitute && expectInstitute !== registerRow.instituteCode) {
    const err = new Error("Institute does not match the requested bill instance.");
    err.status = 409;
    throw err;
  }
  const expectBillCodeId = toIntOrNull(query.billCodeId);
  if (expectBillCodeId != null && expectBillCodeId !== registerRow.billCodeId) {
    const err = new Error("Bill does not match the requested bill instance.");
    err.status = 409;
    throw err;
  }

  const rawRows = await loadSalaryRegisterDetailRows(workflowId);
  const employees = rawRows
    .map(mapDetailEmployeeRow)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((row, index) => ({ srNo: index + 1, ...row }));

  const totals = employees.reduce(
    (acc, row) => addDetailTotals(acc, row),
    emptyDetailTotals()
  );

  return {
    title: "SALARY DETAILS",
    heading: HEADING,
    bill: {
      workflowId,
      billCodeId: registerRow.billCodeId,
      instituteCode: registerRow.instituteCode,
      instituteName: registerRow.instituteName,
      billCode: registerRow.billCode,
      billMonth: registerRow.billMonth,
      salaryMonth: registerRow.salaryMonth,
      billNo: registerRow.billNo,
      billDate: registerRow.billDate,
      salaryType: registerRow.salaryType,
    },
    /* The Salary Register row's own stored totals — what the detail totals
       below must reconcile with. */
    registerTotals: {
      employees: registerRow.employees,
      grossAmount: registerRow.grossAmount,
      totalDeduction: registerRow.totalDeduction,
      netSalary: registerRow.netSalary,
      chequeAmount: registerRow.chequeAmount,
    },
    employees,
    totals,
    employeeCount: employees.length,
  };
}

/** Filter options, from the same approved universe as the rows. */
async function buildRegisterMeta() {
  const rows = (await loadSalaryBillAggregates()).map(mapSalaryBillRow);
  const da = aggregateDaRows(await loadDaDifferenceRows());
  const all = [...rows, ...da];

  const years = [
    ...new Set(all.map((r) => r.salaryMonthParts?.year).filter(Boolean)),
  ].sort((a, b) => b - a);

  const sections = new Map();
  const institutes = new Map();
  for (const row of all) {
    if (row.sectionId != null) {
      sections.set(row.sectionId, {
        sectionId: row.sectionId,
        sectionName: row.sectionName,
      });
    }
    if (row.instituteCode) {
      institutes.set(row.instituteCode, {
        instituteCode: row.instituteCode,
        instituteName: row.instituteName,
      });
    }
  }

  return {
    years,
    sections: [...sections.values()].sort((a, b) =>
      String(a.sectionName).localeCompare(String(b.sectionName))
    ),
    institutes: [...institutes.values()].sort((a, b) =>
      compareGroupCodes(a.instituteCode, b.instituteCode)
    ),
    salaryTypes: [
      { value: "ALL", label: "All" },
      { value: TYPE_REGULAR, label: "Regular Salary (incl. Old)" },
      { value: TYPE_OLD, label: "Old Salary" },
      { value: TYPE_DA_DIFFERENCE, label: "DA Difference" },
    ],
  };
}

/* The printed columns, in order. No Return Amount: no such field exists. */
const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "instituteCode", label: "Institute Code" },
  { key: "instituteName", label: "Institute Name" },
  { key: "sectionName", label: "Section" },
  { key: "billCode", label: "Bill Code" },
  { key: "billMonth", label: "Bill Month" },
  { key: "salaryMonth", label: "Salary Month" },
  { key: "billNo", label: "Bill No." },
  { key: "billDate", label: "Bill Date" },
  { key: "salaryType", label: "Salary Type" },
  { key: "employees", label: "Employees", type: "number" },
  { key: "grossAmount", label: "Gross Amount", type: "number" },
  { key: "totalDeduction", label: "Total Deduction", type: "number" },
  { key: "netSalary", label: "Net Salary", type: "number" },
  { key: "chequeAmount", label: "Cheque Amount", type: "number" },
  { key: "approvedBy", label: "Approved By" },
  { key: "approvedDate", label: "Approved Date" },
  { key: "status", label: "Status" },
];

/* GET /api/salary-register/meta */
router.get("/meta", async (req, res) => {
  try {
    res.json({ message: "OK", data: await buildRegisterMeta() });
  } catch (error) {
    console.error("GET /api/salary-register/meta error:", error);
    res
      .status(500)
      .json({ message: error.message || "Unable to load Salary Register filters." });
  }
});

/* GET /api/salary-register?month=&year=&billMonth=&sectionId=&instituteCode=&salaryType= */
router.get("/", async (req, res) => {
  try {
    res.json({
      message: "OK",
      data: await buildSalaryRegisterReport(req.query || {}),
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/salary-register error:", error);
    res
      .status(status)
      .json({ message: error.message || "Salary Register failed." });
  }
});

/* The detail screen's columns, in order. Sourced only from columns confirmed
   to exist (see loadSalaryRegisterDetailRows' doc comment); no PAN column
   exists anywhere in this schema, so Employee Code stands in as the
   employee's existing external identifier. */
const DETAIL_XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "employeeId", label: "Employee ID", type: "number" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "employeeCode", label: "Employee Code" },
  { key: "basicPay", label: "Basic Pay", type: "number" },
  { key: "payLevel", label: "Pay Level" },
  { key: "gradePay", label: "Grade Pay", type: "number" },
  { key: "da", label: "D.A.", type: "number" },
  { key: "hra", label: "H.R.A.", type: "number" },
  { key: "ta", label: "T.A.", type: "number" },
  { key: "ma", label: "M.A.", type: "number" },
  { key: "cla", label: "C.L.A.", type: "number" },
  { key: "otherAllowances", label: "Other Allowances", type: "number" },
  { key: "grossSalary", label: "Gross Salary", type: "number" },
  { key: "gpfSubscription", label: "GPF Subscription", type: "number" },
  { key: "nps", label: "NPS", type: "number" },
  { key: "gpfAdvance", label: "GPF Advance", type: "number" },
  { key: "incomeTax", label: "Income Tax", type: "number" },
  { key: "professionalTax", label: "Professional Tax", type: "number" },
  { key: "otherDeduction", label: "Other Deduction", type: "number" },
  { key: "totalDeduction", label: "Total Deduction", type: "number" },
  { key: "netSalary", label: "Net Salary", type: "number" },
  { key: "chequeAmount", label: "Cheque Amount", type: "number" },
];

/* GET /api/salary-register/detail?workflowId=&instituteCode=&billCodeId= */
router.get("/detail", async (req, res) => {
  try {
    res.json({
      message: "OK",
      data: await buildSalaryRegisterDetailReport(req.query || {}),
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/salary-register/detail error:", error);
    res
      .status(status)
      .json({ message: error.message || "Salary Register detail failed." });
  }
});

/* GET /api/salary-register/detail/export.xlsx — same builder as the screen. */
router.get("/detail/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildSalaryRegisterDetailReport(req.query || {});

    const heading = [
      ...data.heading.map((line) => [line]),
      [data.title],
      [`Institute: ${data.bill.instituteCode} — ${data.bill.instituteName}`],
      [`Bill Code: ${data.bill.billCode}    Bill Month: ${data.bill.billMonth}    Salary Month: ${data.bill.salaryMonth}`],
      [`Bill No.: ${data.bill.billNo || "—"}    Bill Date: ${data.bill.billDate || "—"}`],
      [],
    ];
    const header = DETAIL_XLSX_COLUMNS.map((c) => c.label);
    const body = data.employees.map((row) =>
      DETAIL_XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      })
    );

    const totalsRow = [];
    if (data.employees.length > 0) {
      DETAIL_XLSX_COLUMNS.forEach((column) => {
        if (column.key === "employeeName") totalsRow.push("TOTAL");
        else if (column.type === "number" && data.totals[column.key] !== undefined) {
          totalsRow.push(Number(data.totals[column.key]));
        } else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = DETAIL_XLSX_COLUMNS.map((c) =>
      c.key === "employeeName" || c.key === "designation" ? { wch: 26 } : { wch: 13 }
    );

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Salary Details");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Salary_Details_${String(data.bill.instituteCode || "").replace(/[^A-Za-z0-9-]+/g, "_")}_${String(data.bill.billCode || "").replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) {
      console.error("GET /api/salary-register/detail/export.xlsx error:", error);
    }
    res
      .status(status)
      .json({ message: error.message || "Salary Register detail export failed." });
  }
});

/* GET /api/salary-register/export.xlsx — same builder, so it cannot drift. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildSalaryRegisterReport(req.query || {});

    const heading = [
      ...data.heading.map((line) => [line]),
      [`Salary Month: ${data.periodLabel}`],
      [`Salary Type: ${data.filters.salaryType}`],
      [],
    ];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) =>
      XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") {
          /* A DA bill has no cheque amount; an em dash, never a fake 0. */
          return value == null ? "—" : Number(value);
        }
        return value == null ? "" : String(value);
      })
    );

    const totalsRow = [];
    if (data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column) => {
        if (column.key === "instituteName") totalsRow.push("TOTAL");
        else if (column.key === "employees") totalsRow.push(Number(data.totals.employees));
        else if (column.key === "grossAmount") totalsRow.push(Number(data.totals.grossAmount));
        else if (column.key === "totalDeduction") totalsRow.push(Number(data.totals.totalDeduction));
        else if (column.key === "netSalary") totalsRow.push(Number(data.totals.netSalary));
        else if (column.key === "chequeAmount") totalsRow.push(Number(data.totals.chequeAmount));
        else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = XLSX_COLUMNS.map((c) =>
      c.key === "instituteName" ? { wch: 34 } : { wch: 15 }
    );

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Salary Register");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Salary_Register_${String(data.periodLabel).replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) {
      console.error("GET /api/salary-register/export.xlsx error:", error);
    }
    res
      .status(status)
      .json({ message: error.message || "Salary Register export failed." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testSalaryRegister.js). */
module.exports.buildSalaryRegisterReport = buildSalaryRegisterReport;
module.exports.buildRegisterMeta = buildRegisterMeta;
module.exports.mapSalaryBillRow = mapSalaryBillRow;
module.exports.aggregateDaRows = aggregateDaRows;
module.exports.filterRegisterRows = filterRegisterRows;
module.exports.parseSalaryType = parseSalaryType;
module.exports.compareRegisterRows = compareRegisterRows;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
module.exports.HEADING = HEADING;
module.exports.loadSalaryRegisterDetailRows = loadSalaryRegisterDetailRows;
module.exports.mapDetailEmployeeRow = mapDetailEmployeeRow;
module.exports.buildSalaryRegisterDetailReport = buildSalaryRegisterDetailReport;
module.exports.DETAIL_XLSX_COLUMNS = DETAIL_XLSX_COLUMNS;
