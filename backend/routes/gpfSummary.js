/**
 * GPF SUMMARY
 *
 * One line per section for a salary month: how many GPF employees, their GPF
 * subscription, their GPF advance, and the two added together.
 *
 * No salary is computed here. Every figure is read from the stored, approved
 * dbo.SalaryEmployeeDetails rows — the same rows Salary Bill Approval shows —
 * and the eligibility, period and section-order rules are the ones the other
 * reports already use, imported rather than copied:
 *
 *   APPROVED_WORKFLOW_STATUSES   which bills may appear at all
 *   salaryMonthPartsOf           the salary-month period rule
 *   matchesFilterMonthYear
 *   dbo.Sections.SrNo            the official section order
 */

const express = require("express");
const { sql } = require("../db");
const {
  instanceEmployeeRowsSql,
  instanceBillMonthSelectSql,
  queryReport,
} = require("../utils/reportBillInstance");
const { matchesFilterMonthYear } = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  salaryMonthPartsOf,
  billMonthPartsOf,
  compareGroupCodes,
} = require("./chequeRegister");
const {
  resolveChequeSalaryType,
  formatMonthLabel,
} = require("../utils/salaryMonthKey");

const { excludedScopeNote } = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "GPF SUMMARY";

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
 * Approved employee salary rows that carry a GPF amount.
 *
 * The GPF schedule lists the employees actually contributing this month, so a
 * row is included when it has a subscription or an advance. Both amounts are
 * read straight from the stored columns.
 */
async function loadGpfRows() {
  const result = await queryReport(`
    SELECT
      b.BillCode,
      ${instanceBillMonthSelectSql()},
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
      d.GPFSubscription,
      d.GPFAdvance
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
      AND (ISNULL(d.GPFSubscription, 0) <> 0 OR ISNULL(d.GPFAdvance, 0) <> 0)
    ORDER BY sec.SrNo, i.SectionId, w.InstituteCode, d.DisplayOrder
  `);
  return result.recordset;
}

/**
 * Keeps only the rows belonging to the selected period.
 *
 * Period membership is the SALARY MONTH, exactly as in the Cheque Register,
 * Bank Copy and Section Summary: a bill whose Bill Month is May but whose
 * salary month is June belongs to the June GPF Summary.
 */
function filterGpfRows(rows, query) {
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
 * Groups the eligible rows into one line per section.
 *
 * EMP        distinct employees contributing GPF in that section — an
 *            employee appearing in two bills of the same salary month is one
 *            person, so they are counted once
 * G.P.F.     stored GPFSubscription, added across every applicable row
 * G.P.F.Adv  stored GPFAdvance, added the same way
 * TOTAL      the two above, added
 *
 * Sections follow dbo.Sections.SrNo, then SectionId — the department's own
 * order, never the alphabet. Sr. No. is handed out only afterwards.
 */
function groupGpfBySection(rows) {
  const bySection = new Map();

  for (const row of rows) {
    const key = row.SectionId == null ? "none" : Number(row.SectionId);
    if (!bySection.has(key)) {
      bySection.set(key, {
        sectionId: row.SectionId == null ? null : Number(row.SectionId),
        sectionSrNo: row.SectionSrNo,
        name: row.SectionName || "(no section)",
        employees: new Set(),
        gpf: 0,
        gpfAdvance: 0,
      });
    }
    const group = bySection.get(key);
    group.employees.add(Number(row.EmployeeId));
    group.gpf = round2(group.gpf + toNum(row.GPFSubscription));
    group.gpfAdvance = round2(group.gpfAdvance + toNum(row.GPFAdvance));
  }

  const rank = (group) => {
    const raw = group?.sectionSrNo;
    if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };

  const ordered = [...bySection.values()].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const idA = a.sectionId == null ? Number.MAX_SAFE_INTEGER : a.sectionId;
    const idB = b.sectionId == null ? Number.MAX_SAFE_INTEGER : b.sectionId;
    if (idA !== idB) return idA < idB ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });

  /* Sr. No. only now, once filtering and ordering are complete. */
  return ordered.map((group, idx) => ({
    srNo: idx + 1,
    name: group.name,
    emp: group.employees.size,
    gpf: group.gpf,
    gpfAdvance: group.gpfAdvance,
    total: round2(group.gpf + group.gpfAdvance),
  }));
}

async function buildGpfSummaryReport(query) {
  const month = query.month;
  const year = query.year;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error("Month and Year are required to show the GPF Summary.");
    err.status = 400;
    throw err;
  }

  const rows = groupGpfBySection(filterGpfRows(await loadGpfRows(), query));

  /* The totals are the sum of the displayed rows — never a second query. */
  const total = rows.reduce(
    (acc, row) => ({
      emp: acc.emp + row.emp,
      gpf: round2(acc.gpf + row.gpf),
      gpfAdvance: round2(acc.gpfAdvance + row.gpfAdvance),
      total: round2(acc.total + row.total),
    }),
    { emp: 0, gpf: 0, gpfAdvance: 0, total: 0 }
  );

  const monthNum = Number(month);
  const monthLabel =
    MONTH_FULL_NAMES[monthNum - 1] != null
      ? `${MONTH_FULL_NAMES[monthNum - 1]}-${year}`
      : `${month}-${year}`;

  return {
    heading: HEADING,
    /* The exclusion is explicit, never silent. */
    salaryCategoryScope: excludedScopeNote(
      "no GPF value exists on a DA Difference record"
    ),
    monthLine: monthLabel,
    subHeading: SUBHEADING,
    rows,
    total,
    month: monthNum,
    year: Number(year),
    rowCount: rows.length,
  };
}

/* GET /api/gpf-summary?month=&year=&sectionId= */
router.get("/", async (req, res) => {
  try {
    const data = await buildGpfSummaryReport(req.query || {});
    res.json({ message: "OK", data });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/gpf-summary error:", error);
    res.status(status).json({ message: error.message || "GPF Summary failed." });
  }
});


/* =====================================================================
   INSTITUTE-WISE view of the same data
   ===================================================================== */

const MONTH_NAMES_SHORT = MONTH_FULL_NAMES;

/**
 * One line per institute, ordered by section then institute number.
 *
 * Level 1 is the Section Master's own SrNo; level 2 is the existing natural
 * institute-code comparison, so BD-2 < BD-10 < BD-11 rather than the lexical
 * order that would put BD-10 first. Sr. No. is handed out afterwards.
 *
 * Month and Type describe the bill the figures came from: Type is the same
 * REGULAR/OLD rule the Cheque Register uses (salary month vs bill month),
 * printed REG / OLD as the legacy report does.
 */
function groupGpfByInstitute(rows) {
  const byBill = new Map();

  for (const row of rows) {
    const code = String(row.InstituteCode || "").trim();

    /*
       The bill's real Bill Month and its REGULAR/OLD type, both resolved by
       the rules the Cheque Register already uses. A salary month can hold a
       regular bill and one or more Bill-Month variants; each is its own
       payment and gets its own line.
    */
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
    const billKey = billParts ? `${billParts.year}-${String(billParts.month).padStart(2, "0")}` : "";

    /* Institute + Bill Month + Type is the row identity. */
    const key = `${code}|${billKey}|${type}`;

    if (!byBill.has(key)) {
      byBill.set(key, {
        code,
        instituteName: row.InstituteName || code,
        sectionId: row.SectionId == null ? null : Number(row.SectionId),
        sectionSrNo: row.SectionSrNo,
        sectionName: row.SectionName || "",
        billKey,
        billMonthNumber: billParts ? billParts.month : 0,
        billYear: billParts ? billParts.year : 0,
        month: billParts ? MONTH_NAMES_SHORT[billParts.month - 1] : "",
        type,
        employees: new Set(),
        gpf: 0,
        gpfAdvance: 0,
      });
    }
    const group = byBill.get(key);
    group.employees.add(Number(row.EmployeeId));
    group.gpf = round2(group.gpf + toNum(row.GPFSubscription));
    group.gpfAdvance = round2(group.gpfAdvance + toNum(row.GPFAdvance));
  }

  const sectionRank = (group) => {
    const raw = group?.sectionSrNo;
    if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };

  const ordered = [...byBill.values()].sort((a, b) => {
    /* 1. Section order from the Section Master. */
    const ra = sectionRank(a);
    const rb = sectionRank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const idA = a.sectionId == null ? Number.MAX_SAFE_INTEGER : a.sectionId;
    const idB = b.sectionId == null ? Number.MAX_SAFE_INTEGER : b.sectionId;
    if (idA !== idB) return idA < idB ? -1 : 1;

    /* 2. Institute number, compared numerically: BD-2 < BD-10 < BD-11. */
    const byCode = compareGroupCodes(a.code, b.code);
    if (byCode !== 0) return byCode;

    /* 3. The institute's regular bill first, then its older ones. */
    if (a.type !== b.type) return a.type === "REG" ? -1 : 1;

    /* 4. Several older bills: newest Bill Month first. */
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
    gpf: group.gpf,
    gpfAdvance: group.gpfAdvance,
    amount: round2(group.gpf + group.gpfAdvance),
  }));
}

async function buildInstituteWiseGpfReport(query) {
  const month = query.month;
  const year = query.year;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error("Month and Year are required to show the GPF Summary.");
    err.status = 400;
    throw err;
  }

  const rows = groupGpfByInstitute(filterGpfRows(await loadGpfRows(), query));

  /* Totals are the sum of the displayed rows — never a second query. */
  const total = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      gpf: round2(acc.gpf + row.gpf),
      gpfAdvance: round2(acc.gpfAdvance + row.gpfAdvance),
      amount: round2(acc.amount + row.amount),
    }),
    { total: 0, gpf: 0, gpfAdvance: 0, amount: 0 }
  );

  const monthNum = Number(month);
  const monthLabel =
    MONTH_FULL_NAMES[monthNum - 1] != null
      ? `${MONTH_FULL_NAMES[monthNum - 1]}-${year}`
      : `${month}-${year}`;

  /* The section title line: the selected section, or all of them. */
  const sectionNames = [...new Set(rows.map((r) => r.sectionName).filter(Boolean))];
  const sectionTitle =
    query.sectionId != null && query.sectionId !== "" && sectionNames.length === 1
      ? sectionNames[0].toUpperCase()
      : "ALL SECTIONS";

  return {
    sectionTitle,
    heading: HEADING,
    monthLine: monthLabel,
    subHeading: SUBHEADING,
    rows,
    total,
    month: monthNum,
    year: Number(year),
    rowCount: rows.length,
    /*
       The legacy system's "Salary Time" has no column in this database, so it
       is echoed back for the header only and narrows nothing. See the report
       notes: this system separates pay runs by Bill Month variant instead.
    */
    salaryTime: query.salaryTime == null || query.salaryTime === ""
      ? "1"
      : String(query.salaryTime),
  };
}

/* GET /api/gpf-summary/institute-wise?sectionId=&month=&year=&salaryTime= */
router.get("/institute-wise", async (req, res) => {
  try {
    const data = await buildInstituteWiseGpfReport(req.query || {});
    res.json({ message: "OK", data });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/gpf-summary/institute-wise error:", error);
    res.status(status).json({ message: error.message || "GPF Summary failed." });
  }
});

const INSTITUTE_XLSX_COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "code", label: "Code No." },
  { key: "instituteName", label: "Institute Name" },
  { key: "month", label: "Month" },
  { key: "type", label: "Type" },
  { key: "total", label: "Total", type: "number" },
  { key: "gpf", label: "G.P.F.", type: "number" },
  { key: "gpfAdvance", label: "G.P.F.Adv", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
];

/* GET /api/gpf-summary/institute-wise/export.xlsx — same builder. */
router.get("/institute-wise/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildInstituteWiseGpfReport(req.query || {});

    const heading = [
      [data.sectionTitle], [data.heading], [data.monthLine], [data.subHeading], [],
    ];
    const header = INSTITUTE_XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) =>
      INSTITUTE_XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      })
    );

    const totalsRow = [];
    if (data.rows.length > 0) {
      INSTITUTE_XLSX_COLUMNS.forEach((column) => {
        if (column.key === "srNo") totalsRow.push("TOTAL");
        else if (column.type === "number") totalsRow.push(Number(data.total[column.key] || 0));
        else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading, header, ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = [
      { wch: 8 }, { wch: 12 }, { wch: 44 }, { wch: 12 }, { wch: 8 },
      { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Institute Wise GPF");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Institute_Wise_GPF_${data.monthLine.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/gpf-summary/institute-wise/export.xlsx error:", error);
    res.status(status).json({ message: error.message || "Export failed." });
  }
});

const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "name", label: "NAME" },
  { key: "emp", label: "EMP", type: "number" },
  { key: "gpf", label: "G.P.F.", type: "number" },
  { key: "gpfAdvance", label: "G.P.F.Adv", type: "number" },
  { key: "total", label: "TOTAL", type: "number" },
];

/* GET /api/gpf-summary/export.xlsx — same builder, so it cannot drift. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildGpfSummaryReport(req.query || {});

    const heading = [[data.heading], [data.monthLine], [data.subHeading], []];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) =>
      XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      })
    );

    const totalsRow = [];
    if (data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column) => {
        if (column.key === "srNo") totalsRow.push("Total");
        else if (column.type === "number") totalsRow.push(Number(data.total[column.key] || 0));
        else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = [
      { wch: 8 }, { wch: 26 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "GPF Summary");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `GPF_Summary_${data.monthLine.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/gpf-summary/export.xlsx error:", error);
    res.status(status).json({ message: error.message || "GPF Summary export failed." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testGpfSummary.js). */
module.exports.groupGpfBySection = groupGpfBySection;
module.exports.groupGpfByInstitute = groupGpfByInstitute;
module.exports.INSTITUTE_XLSX_COLUMNS = INSTITUTE_XLSX_COLUMNS;
module.exports.buildInstituteWiseGpfReport = buildInstituteWiseGpfReport;
module.exports.filterGpfRows = filterGpfRows;
module.exports.buildGpfSummaryReport = buildGpfSummaryReport;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
