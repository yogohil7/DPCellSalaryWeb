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
  matchesFilterMonthYear,
  billTypeMatchesFilter,
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
  const result = await sql.query`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
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
    GROUP BY
      b.BillCodeId, b.BillCode, b.BillMonth, b.SalaryMonth,
      b.SalaryMonthNumber, b.SalaryYear,
      w.InstituteCode, w.Status, w.BillNo, w.BillDate,
      w.ApprovedBy, w.ApprovedDate,
      i.InstituteName, i.SectionId, sec.SrNo, sec.SectionName
  `;
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
function mapSalaryBillRow(row) {
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
  const billYm = billMonthPartsOf(
    row.BillMonth,
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );

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

    billNo: row.BillNo == null ? "" : String(row.BillNo),
    billDate: dateOnly(row.BillDate),
    salaryType: resolveChequeSalaryType({
      salaryMonth: row.SalaryMonth,
      billMonth: row.BillMonth,
      salaryYear: row.SalaryYear,
      billYear: row.SalaryYear,
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
  return String(a.billCode).localeCompare(String(b.billCode));
}

async function buildSalaryRegisterReport(query = {}) {
  const salaryRows = (await loadSalaryBillAggregates()).map(mapSalaryBillRow);
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
