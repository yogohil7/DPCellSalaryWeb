/**
 * SECTION SUMMARY
 *
 * One line per section for a salary month: how many institutes paid, how many
 * employee salary rows, and the cheque amount.
 *
 * This report computes NO salary of its own. It is built entirely from
 * buildChequeRegisterReport() — the same approved rows, the same eligibility,
 * the same salary-month period rule and the same cheque amount the Cheque
 * Register prints — so the two reports can never disagree for a given month.
 * Only grouping and counting happen here.
 */

const express = require("express");
const { sql } = require("../db");
const { buildChequeRegisterReport } = require("./chequeRegister");
const { amountInWordsIndian } = require("../utils/amountInWords");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "DP-CELL WISE";

const MONTH_FULL_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The department's official section order.
 *
 * dbo.Sections.SrNo is the same column routes/sections.js orders the Section
 * Master by, so the report follows the order the department maintains rather
 * than an alphabetical guess. A section with no SrNo falls in behind the ones
 * that have one.
 */
async function loadSectionOrder() {
  const result = await sql.query`
    SELECT SectionId, SrNo, SectionName
    FROM dbo.Sections
    ORDER BY SrNo ASC, SectionId ASC
  `;
  const rank = new Map();
  result.recordset.forEach((row, index) => {
    rank.set(Number(row.SectionId), {
      rank: row.SrNo == null || row.SrNo === "" ? Number.MAX_SAFE_INTEGER : Number(row.SrNo),
      order: index,
      sectionName: row.SectionName || "",
    });
  });
  return rank;
}

/**
 * Groups the Cheque Register's approved rows into one line per section.
 *
 * INSTITUTE  distinct institute codes that were paid in that section
 * EMPLOYEE   the register's own employee counts, added up
 * CHEQUE     the register's own cheque amounts, added up
 */
function groupBySection(registerRows, sectionRank) {
  const bySection = new Map();

  for (const row of registerRows) {
    const key = row.sectionId == null ? "none" : Number(row.sectionId);
    if (!bySection.has(key)) {
      const meta = sectionRank.get(Number(row.sectionId));
      bySection.set(key, {
        sectionId: row.sectionId == null ? null : Number(row.sectionId),
        section: row.sectionName || meta?.sectionName || "(no section)",
        institutes: new Set(),
        employeeCount: 0,
        chequeAmount: 0,
      });
    }
    const group = bySection.get(key);
    if (row.instituteCode) group.institutes.add(String(row.instituteCode));
    group.employeeCount += toNum(row.emp);
    group.chequeAmount += toNum(row.chequeAmount);
  }

  const ordered = [...bySection.values()].sort((a, b) => {
    const ra = sectionRank.get(Number(a.sectionId));
    const rb = sectionRank.get(Number(b.sectionId));
    const rankA = ra ? ra.rank : Number.MAX_SAFE_INTEGER;
    const rankB = rb ? rb.rank : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA < rankB ? -1 : 1;
    const orderA = ra ? ra.order : Number.MAX_SAFE_INTEGER;
    const orderB = rb ? rb.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA < orderB ? -1 : 1;
    return String(a.section).localeCompare(String(b.section));
  });

  /* Sr. No. only now, once filtering and ordering are complete. */
  return ordered.map((group, idx) => ({
    srNo: idx + 1,
    section: group.section,
    instituteCount: group.institutes.size,
    employeeCount: group.employeeCount,
    chequeAmount: Number(group.chequeAmount.toFixed(2)),
  }));
}

async function buildSectionSummaryReport(query) {
  const month = query.month;
  const year = query.year;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error("Month and Year are required to show the Section Summary.");
    err.status = 400;
    throw err;
  }

  /*
     table: "ALL" includes BOTH ordinary salary bills (REGULAR + OLD) and
     DA Difference bills for the selected salary month, which is what a
     section's cheque total for that month actually comprises. The Cheque
     Register builder already loads both and classifies each row, so nothing
     is recalculated and no row is duplicated. Everything else — approved /
     locked only, archived excluded, salary-month period — comes with the
     builder unchanged. Callers can still narrow with the query's own filter.
  */
  const register = await buildChequeRegisterReport({
    table: query.table || query.salaryType || "ALL",
    salaryTime: "ALL",
    sectionId: query.sectionId,
    sectionName: query.sectionName,
    month,
    year,
    format: "SCREEN",
  });

  const sectionRank = await loadSectionOrder();
  const rows = groupBySection(register.rows || [], sectionRank);

  /* The total is the sum of the displayed rows — never a second query. */
  const total = rows.reduce(
    (acc, row) => ({
      instituteCount: acc.instituteCount + row.instituteCount,
      employeeCount: acc.employeeCount + row.employeeCount,
      chequeAmount: Number((acc.chequeAmount + row.chequeAmount).toFixed(2)),
    }),
    { instituteCount: 0, employeeCount: 0, chequeAmount: 0 }
  );

  const monthNum = Number(month);
  const monthLabel =
    MONTH_FULL_NAMES[monthNum - 1] != null
      ? `${MONTH_FULL_NAMES[monthNum - 1]}-${year}`
      : `${month}-${year}`;

  return {
    heading: HEADING,
    monthLine: monthLabel,
    subHeading: SUBHEADING,
    rows,
    total,
    /* Words come from the displayed grand total, via the shared utility. */
    amountInWords: amountInWordsIndian(total.chequeAmount),
    month: monthNum,
    year: Number(year),
    rowCount: rows.length,
  };
}

/* GET /api/section-summary?month=&year=&sectionId= */
router.get("/", async (req, res) => {
  try {
    const data = await buildSectionSummaryReport(req.query || {});
    res.json({ message: "OK", data });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/section-summary error:", error);
    res.status(status).json({ message: error.message || "Section Summary failed." });
  }
});

const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr_No." },
  { key: "section", label: "SECTION" },
  { key: "instituteCount", label: "INSTITUTE", type: "number" },
  { key: "employeeCount", label: "EMPLOYEE", type: "number" },
  { key: "chequeAmount", label: "CHEQUE AMOUNT", type: "number" },
];

/* GET /api/section-summary/export.xlsx — same builder, so it cannot drift. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildSectionSummaryReport(req.query || {});

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
      [],
      [`Amount In Word :- ${data.amountInWords}`],
    ]);
    sheet["!cols"] = [{ wch: 8 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Section Summary");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `Section_Summary_${data.monthLine.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/section-summary/export.xlsx error:", error);
    res.status(status).json({ message: error.message || "Section Summary export failed." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testSectionSummary.js). */
module.exports.groupBySection = groupBySection;
module.exports.buildSectionSummaryReport = buildSectionSummaryReport;
module.exports.loadSectionOrder = loadSectionOrder;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
