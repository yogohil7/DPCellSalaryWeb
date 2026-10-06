/**
 * NPS SCHEDULE SUMMARY
 *
 * The NPS remittance schedule: for one Salary Month and one Bill Type, the
 * institutes that carry an NPS deduction, each with its schedule number,
 * employee count and NPS amount — the structure the legacy system produced
 * (કોડ નં. / શિડ્યુલ નં. / સંખ્યા / રકમ).
 *
 * SOURCE OF TRUTH — nothing is recalculated:
 *   NPS amount    = stored dbo.SalaryEmployeeDetails.NPS, the same column
 *                   NPS Summary reads, so the two reconcile by construction.
 *   Schedule No.  = dbo.SalaryBillInstituteWorkflow.NPSScheduleNo (migration
 *                   45), captured per institute per bill in Salary Entry.
 *   PRAN          = dbo.EmployeeMaster.GPFNPSNumber. Never fabricated: when
 *                   the column is empty the snapshot stores empty.
 *
 * ONE QUERY: rows come from loadEmployeeSalaryRows() in employeeWiseSalary.js,
 * which already applies the shared reporting rules — APPROVED/LOCKED only,
 * DA-Difference bills excluded, archived bills excluded — and already joins
 * the institute, section, employee and workflow tables.
 *
 * MONTH RULE: the schedule period is the SALARY MONTH. Bill Month is carried
 * on every row for source-bill traceability and is never used as the period.
 *
 * REGULAR and OLD are never merged: the bill type is part of the schedule's
 * identity, so JUL-2026 REGULAR and JUL-2026 OLD are two separate schedules
 * with separate totals.
 *
 * SAVING is a SNAPSHOT: amounts, names, PRANs and institute names are copied
 * into dbo.NpsScheduleHeader / dbo.NpsScheduleDetails at save time, so a
 * later change to Employee Master or to salary data cannot alter a schedule
 * that has already been saved.
 */

const express = require("express");
const { sql } = require("../db");

const {
  loadEmployeeSalaryRows,
  mapSalaryRow,
  filterSalaryRows,
} = require("./employeeWiseSalary");
const { compareGroupCodes, billMonthPartsOf } = require("./chequeRegister");
const { loadDaDifferenceRows } = require("../utils/salaryCategory");

const router = express.Router();

const {
  gujaratiAmountInWords,
  gujaratiFigure,
} = require("../utils/gujaratiAmountInWords");

/*
  Full month names for the NPS bank letter's period line ("માહે JULY-2026").
  Declared here following the convention already used by bankCopy.js,
  gpfSummary.js, employeePaySlip.js and salaryRegister.js, each of which keeps
  its own copy rather than sharing one module.
*/
const MONTH_FULL_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/**
 * The letter's period label, e.g. JULY-2026, from the SAME month/year the
 * report was filtered by. Returned from the backend so the screen never
 * re-derives it and the two can never disagree.
 */
function letterMonthLabelOf(query = {}) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isFinite(month) || month < 1 || month > 12) return "";
  if (!Number.isFinite(year) || year < 1900) return "";
  return `${MONTH_FULL_NAMES[month - 1]}-${year}`;
}

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "NPS SCHEDULE SUMMARY";
const PURPOSE_LINE = "Salary Payment / NPS deduction schedule";

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
 * Schedule numbers live on dbo.SalaryBillInstituteWorkflow (migration 45).
 * They are read HERE rather than by widening the shared Employee Wise Salary
 * loader, for two reasons: that loader is used by other reports and must not
 * change shape, and the column is optional — on a database where migration 45
 * has not been applied this returns an empty map and the schedule simply
 * shows blank schedule numbers instead of failing.
 *
 * One small keyed query, not one per row.
 */
async function loadScheduleNumbers() {
  const guard = await sql.query`
    SELECT CASE
      WHEN COL_LENGTH(N'dbo.SalaryBillInstituteWorkflow', N'NPSScheduleNo') IS NULL
      THEN 0 ELSE 1 END AS Present
  `;
  if (Number(guard.recordset[0]?.Present || 0) !== 1) return new Map();

  const result = await sql.query`
    SELECT SalaryBillCodeId, InstituteCode, NPSScheduleNo
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE NPSScheduleNo IS NOT NULL
      AND LTRIM(RTRIM(NPSScheduleNo)) <> N''
  `;
  const map = new Map();
  result.recordset.forEach((r) => {
    map.set(
      `${Number(r.SalaryBillCodeId)}|${String(r.InstituteCode || "").trim()}`,
      String(r.NPSScheduleNo).trim()
    );
  });
  return map;
}

/** REGULAR unless OLD is explicitly asked for; ALL is a listing-only scope. */
function parseBillType(value) {
  const text = String(value == null ? "" : value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (text === "OLD" || text === "OLD_SALARY") return "OLD";
  if (
    text === "DA_DIFFERENCE" ||
    text === "DA_DIFFERENCE_SALARY" ||
    text === "DIFFERENCE"
  ) {
    return "DA_DIFFERENCE";
  }
  if (text === "ALL") return "ALL";
  return "REGULAR";
}

/**
 * A DA Difference schedule line, in the same shape as a salary schedule line.
 *
 * The NPS amount is the STORED dbo.DADifferenceEmployeeDetails.TotalNPSDeduction
 * — never recalculated here. REGULAR / OLD describe an ordinary salary bill
 * whose bill month may lag its salary month; DA DIFFERENCE is a different
 * category of bill entirely, so it is labelled as such and never merged with
 * the other two.
 */
function daRowToScheduleRow(row) {
  return {
    ...row,
    /* Its own schedule number, entered against the DA bill in DA Difference
       Entry. A regular-salary schedule number is never shown here. */
    npsScheduleNo: row.npsScheduleNo || "",
    billMonthIndex: row.salaryMonthIndex,
    type: "DA DIFFERENCE",
  };
}

/**
 * One schedule row per (institute, source bill): the printed line. Employee
 * rows are kept alongside for the snapshot and the reconciliation check.
 */
function buildScheduleGroups(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    /* Keyed by institute + source bill + INSTANCE Bill Month: two Bill
       Month instances of the same bill (e.g. AUG-2026 REGULAR and JUL-2026
       OLD under one salary bill) are two schedule lines with their own
       month, type, schedule number, headcount and amount. Keying by bill
       alone merged the JUL-2026 instance into the AUG-2026 line. */
    const key = `${row.instituteCode}|${row.billCodeId}|${row.paidMonth || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        instituteCode: row.instituteCode,
        instituteName: row.instituteName,
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        sectionSrNo: row.sectionSrNo,
        scheduleNo: row.npsScheduleNo || "",
        salaryMonth: row.salaryMonth,
        salaryMonthIndex: row.salaryMonthIndex,
        billMonth: row.paidMonth,
        billMonthIndex: row.billMonthIndex,
        billType: row.type,
        billCodeId: row.billCodeId,
        billCode: row.billCode,
        employees: [],
        employeeCount: 0,
        amount: 0,
      });
    }
    const group = groups.get(key);
    group.employees.push({
      employeeId: row.employeeId,
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      pran: row.pran || "",
      nps: round2(row.nps),
      billCodeId: row.billCodeId,
      billCode: row.billCode,
      billMonth: row.paidMonth,
      salaryMonth: row.salaryMonth,
      billType: row.type,
    });
    group.employeeCount += 1;
    group.amount = round2(group.amount + toNum(row.nps));
  });

  return [...groups.values()];
}

/** Section order, then natural institute code, then chronological month. */
function sectionRank(group) {
  if (group.sectionSrNo != null) return group.sectionSrNo;
  if (group.sectionId != null) return Number(group.sectionId) + 100000;
  return Number.MAX_SAFE_INTEGER;
}

function compareGroups(a, b) {
  const ar = sectionRank(a);
  const br = sectionRank(b);
  if (ar !== br) return ar - br;

  const codes = compareGroupCodes(a.instituteCode || "", b.instituteCode || "");
  if (codes !== 0) return codes;

  const ai = a.salaryMonthIndex != null ? a.salaryMonthIndex : 0;
  const bi = b.salaryMonthIndex != null ? b.salaryMonthIndex : 0;
  if (ai !== bi) return ai - bi;

  /* Bill Month chronologically, so MAY-2026 precedes JUN-2026 within the
     same institute and salary month. Compared as a month index, never as
     text — "JUL" must not sort before "JUN". */
  const am = a.billMonthIndex != null ? a.billMonthIndex : 0;
  const bm = b.billMonthIndex != null ? b.billMonthIndex : 0;
  if (am !== bm) return am - bm;

  if (a.billType !== b.billType) return a.billType === "REGULAR" ? -1 : 1;
  return String(a.billCode || "").localeCompare(String(b.billCode || ""));
}

function filterByInstitute(groups, instituteCode) {
  const code = String(instituteCode == null ? "" : instituteCode).trim();
  if (!code || code.toUpperCase() === "ALL") return groups;
  return groups.filter((g) => String(g.instituteCode || "").trim() === code);
}

/**
 * The schedule for the current filters, built from ONE database read.
 * Only rows carrying a non-zero stored NPS take part — the same rule the
 * NPS Summary applies — so the totals reconcile.
 */
async function buildNpsScheduleReport(query = {}) {
  const billType = parseBillType(query.billType || query.salaryType);
  const wantsSalary = billType !== "DA_DIFFERENCE";
  const wantsDa = billType === "DA_DIFFERENCE" || billType === "ALL";
  /* DA Difference is a category, not a salary bill type: it joins REGULAR
     and OLD only under ALL, never inside them. */

  const [raws, scheduleNumbers, daRaws] = await Promise.all([
    wantsSalary ? loadEmployeeSalaryRows() : Promise.resolve([]),
    loadScheduleNumbers(),
    wantsDa ? loadDaDifferenceRows() : Promise.resolve([]),
  ]);

  const mapped = raws.map((raw) => {
    const base = mapSalaryRow(raw);
    return {
      ...base,
      sectionSrNo:
        raw.SectionSrNo == null || raw.SectionSrNo === ""
          ? null
          : Number(raw.SectionSrNo),
      billMonthIndex: (() => {
        const parts = billMonthPartsOf(
          raw.BillMonth, raw.SalaryMonth, raw.SalaryYear, raw.SalaryMonthNumber
        );
        return parts ? parts.year * 12 + parts.month : null;
      })(),
      /* The schedule number of THIS row's Bill Month instance, already
         resolved by the shared loader (its Bill-Month header, else its own
         workflow row). The bill+institute map below cannot tell a JUL-2026
         instance from the AUG-2026 one, so it is used for DA bills only. */
      npsScheduleNo:
        raw.NPSScheduleNo == null ? "" : String(raw.NPSScheduleNo).trim(),
      pran: raw.GPFNPSNumber == null ? "" : String(raw.GPFNPSNumber).trim(),
    };
  });

  /*
    DA Difference rows carry their own schedule number from the institute
    workflow row (the same NPSScheduleNo column DA Difference Entry writes),
    so a DA line never borrows a regular-salary schedule number.
  */
  const daMapped = daRaws.map((row) =>
    daRowToScheduleRow({
      ...row,
      npsScheduleNo:
        scheduleNumbers.get(
          `${Number(row.billCodeId)}|${String(row.instituteCode || "").trim()}`
        ) || "",
    })
  );

  /*
    Shared status / archived / SALARY-MONTH-period filter.

    Scope of each option in THIS report (a deliberate, report-local choice):

      REGULAR SALARY  -> every ordinary salary bill for the selected salary
                         month, whatever its bill month. A bill paid in a
                         later month (bill month MAY, salary month JUNE) is
                         part of that month's NPS remittance, so it belongs
                         on the schedule; the Bill Type column still shows it
                         as OLD so the two are never indistinguishable.
      OLD SALARY      -> only those later-bill-month bills, on their own.
      DA DIFFERENCE   -> DA Difference bills only.
      ALL             -> salary bills + DA Difference.

    NOTE: because REGULAR here spans REGULAR + OLD, this report's "Regular
    Salary" total is deliberately NOT the same figure as the Cheque
    Register's REGULAR total for the same month. Nothing shared was changed:
    resolveChequeSalaryType still classifies each row exactly as before, and
    every other report keeps its own narrower meaning of REGULAR.
  */
  const salaryType = billType === "OLD" ? "OLD" : "ALL";
  const scopedSalary = filterSalaryRows(mapped, { ...query, salaryType });
  const scopedDa = filterSalaryRows(daMapped, { ...query, salaryType: "ALL" });
  const scoped = [...scopedSalary, ...scopedDa];

  /* NPS Summary keeps only non-zero NPS rows; the schedule does the same. */
  const withNps = scoped.filter((row) => toNum(row.nps) !== 0);

  const groups = filterByInstitute(
    buildScheduleGroups(withNps),
    query.instituteCode
  ).sort(compareGroups);

  const rows = groups.map((group, index) => ({
    srNo: index + 1,
    instituteCode: group.instituteCode,
    instituteName: group.instituteName,
    sectionId: group.sectionId,
    sectionName: group.sectionName,
    scheduleNo: group.scheduleNo,
    salaryMonth: group.salaryMonth,
    billMonth: group.billMonth,
    billMonthIndex: group.billMonthIndex,
    billType: group.billType,
    billCodeId: group.billCodeId,
    billCode: group.billCode,
    employeeCount: group.employeeCount,
    amount: round2(group.amount),
    employees: group.employees,
  }));

  const totals = rows.reduce(
    (acc, row) => ({
      employeeCount: acc.employeeCount + row.employeeCount,
      amount: round2(acc.amount + row.amount),
    }),
    { employeeCount: 0, amount: 0 }
  );

  const months = [...new Set(rows.map((r) => r.salaryMonth))];

  return {
    heading: HEADING,
    subHeading: SUBHEADING,
    purposeLine: PURPOSE_LINE,
    billType,
    salaryMonthLabel: months.length === 1 ? months[0] : months.join(", "),
    rows,
    totals,
    rowCount: rows.length,

    /*
       Letter fields. Presentation only — nothing here is calculated, stored,
       or fed back into salary data.

       The amount is `totals.amount`, the very figure the table foots, so the
       letter and the report can never state different sums. Cheque number,
       cheque date, challan number and challan date do NOT exist anywhere in
       this schema and are therefore absent: the screen supplies blank,
       print-only inputs for them rather than the server inventing a value.

       A single NPS Schedule No. is likewise not exposed here. Schedule
       numbers are per institute/bill and several may be in scope; presenting
       one in a letter that covers them all would misstate the remittance.
       They remain in the table, where each row carries its own.
    */
    letter: {
      monthLabel: letterMonthLabelOf(query),
      amount: totals.amount,
      amountGujarati: gujaratiFigure(totals.amount),
      amountInWordsGujarati: gujaratiAmountInWords(totals.amount),
    },
  };
}

router.get("/", async (req, res) => {
  try {
    const report = await buildNpsScheduleReport(req.query || {});
    res.json({ message: "OK", data: report });
  } catch (error) {
    console.error("GET /api/nps-schedule error:", error);
    res.status(500).json({
      message: "Unable to load the NPS Schedule Summary.",
      error: error.message,
    });
  }
});

/*
   The eight printed columns, in the order the screen shows them. This list is
   the export contract; the report itself is unchanged.
*/
const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "instituteCode", label: "Code No." },
  { key: "instituteName", label: "Institute Name" },
  { key: "billMonth", label: "Bill Month" },
  { key: "billType", label: "Bill Type" },
  { key: "scheduleNo", label: "Schedule No." },
  { key: "employeeCount", label: "Count", type: "number" },
  { key: "amount", label: "Amount", type: "number" },
];

/* GET /api/nps-schedule/export.xlsx — the SAME builder the screen uses, so
   rows, filters and totals cannot drift between the two. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildNpsScheduleReport(req.query || {});

    const heading = [
      [data.heading],
      [data.subHeading],
      [`Salary Month: ${data.salaryMonthLabel || "-"}`],
      [`Bill Type: ${data.billType}`],
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

    /* The same TOTAL the table foots. */
    const totalsRow = [];
    if (data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column) => {
        if (column.key === "instituteName") totalsRow.push("TOTAL");
        else if (column.key === "employeeCount") {
          totalsRow.push(Number(data.totals.employeeCount));
        } else if (column.key === "amount") {
          totalsRow.push(Number(data.totals.amount));
        } else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = [
      { wch: 8 }, { wch: 14 }, { wch: 40 }, { wch: 14 },
      { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 16 },
    ];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "NPS Schedule");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const fileName = `NPS_Schedule_Summary_${String(
      data.salaryMonthLabel || "ALL"
    ).replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error("GET /api/nps-schedule/export.xlsx error:", error);
    res.status(500).json({
      message: "Unable to export the NPS Schedule Summary.",
      error: error.message,
    });
  }
});

/* --------------------------------------------------------------------- *
 * SAVED SCHEDULES
 * --------------------------------------------------------------------- */

async function scheduleTablesExist() {
  const result = await sql.query`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.NpsScheduleHeader',  N'U') IS NULL THEN 0 ELSE 1 END AS Header,
      CASE WHEN OBJECT_ID(N'dbo.NpsScheduleDetails', N'U') IS NULL THEN 0 ELSE 1 END AS Details
  `;
  const row = result.recordset[0] || {};
  return Number(row.Header || 0) === 1 && Number(row.Details || 0) === 1;
}

function missingTablesResponse(res) {
  return res.status(503).json({
    message:
      "NPS Schedule storage is not installed. Run: cd backend && npm run migrate:nps-schedule",
  });
}

/** Sortable YYYY-MM key from a MMM-YYYY label. */
const MONTH_KEYS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function monthPartsFromLabel(label) {
  const text = String(label || "").trim().toUpperCase();
  const match = text.match(/^([A-Z]{3})-(\d{4})$/);
  if (!match) return null;
  const month = MONTH_KEYS.indexOf(match[1]) + 1;
  if (month <= 0) return null;
  return { month, year: Number(match[2]) };
}

/*
  NPS Schedule Summary is a REPORT. Schedules are not created, saved,
  generated or revised from here — the save endpoint was removed deliberately.
  The saved-schedule tables and their data are untouched, and the two read
  endpoints below remain so historical schedules can still be viewed.
*/

/** GET /api/nps-schedule/saved — the saved schedules list. */
router.get("/saved", async (req, res) => {
  try {
    if (!(await scheduleTablesExist())) return missingTablesResponse(res);

    const billType = String(req.query?.billType || "").trim().toUpperCase();
    const monthKey = String(req.query?.salaryMonthKey || "").trim();

    const result = await sql.query`
      SELECT ScheduleId, ScheduleNo, SalaryMonthKey, SalaryMonthLabel, BillType,
             ScheduleDate, SectionId, SectionName, InstituteCode, InstituteName,
             EmployeeCount, TotalNPS, RevisionNo, Status, CreatedBy, CreatedAt
      FROM dbo.NpsScheduleHeader
      WHERE (${billType || null} IS NULL OR ${billType || null} = N'ALL' OR BillType = ${billType || null})
        AND (${monthKey || null} IS NULL OR SalaryMonthKey = ${monthKey || null})
      ORDER BY SalaryMonthKey DESC, BillType ASC, RevisionNo DESC
    `;

    res.json({
      message: "OK",
      data: result.recordset.map((r) => ({
        scheduleId: Number(r.ScheduleId),
        scheduleNo: r.ScheduleNo,
        salaryMonthKey: r.SalaryMonthKey,
        salaryMonth: r.SalaryMonthLabel,
        billType: r.BillType,
        scheduleDate: r.ScheduleDate,
        sectionId: r.SectionId == null ? null : Number(r.SectionId),
        sectionName: r.SectionName || "All Sections",
        instituteCode: r.InstituteCode || "",
        instituteName: r.InstituteName || "All Institutes",
        employeeCount: Number(r.EmployeeCount || 0),
        totalNps: Number(r.TotalNPS || 0),
        revisionNo: Number(r.RevisionNo || 1),
        status: r.Status,
        createdBy: r.CreatedBy || "",
        createdAt: r.CreatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/nps-schedule/saved error:", error);
    res.status(500).json({
      message: "Unable to load the saved NPS Schedules.",
      error: error.message,
    });
  }
});

/**
 * GET /api/nps-schedule/saved/:id — the stored snapshot.
 * Nothing is regenerated from current salary data: every value returned here
 * is the value that was saved.
 */
router.get("/saved/:id", async (req, res) => {
  try {
    if (!(await scheduleTablesExist())) return missingTablesResponse(res);

    const scheduleId = toIntOrNull(req.params.id);
    if (scheduleId == null) {
      return res.status(400).json({ message: "Invalid schedule id." });
    }

    const headerRes = await sql.query`
      SELECT ScheduleId, ScheduleNo, SalaryMonthLabel, BillType, ScheduleDate,
             SectionName, InstituteCode, InstituteName, EmployeeCount, TotalNPS,
             RevisionNo, Status, CreatedBy, CreatedAt
      FROM dbo.NpsScheduleHeader
      WHERE ScheduleId = ${scheduleId}
    `;
    const header = headerRes.recordset[0];
    if (!header) {
      return res.status(404).json({ message: "Schedule not found." });
    }

    const detailRes = await sql.query`
      SELECT RowKind, SrNo, InstituteCode, InstituteNameSnapshot, SectionNameSnapshot,
             NpsScheduleNoSnapshot, EmployeeCount, EmployeeId, EmployeeCodeSnapshot,
             EmployeeNameSnapshot, PranSnapshot, NpsAmount, SourceSalaryBillCode,
             BillMonthLabel, SalaryMonthLabel, BillType
      FROM dbo.NpsScheduleDetails
      WHERE ScheduleId = ${scheduleId}
      ORDER BY CASE WHEN RowKind = N'INSTITUTE' THEN 0 ELSE 1 END, SrNo
    `;

    const rows = detailRes.recordset
      .filter((d) => d.RowKind === "INSTITUTE")
      .map((d) => ({
        srNo: Number(d.SrNo),
        instituteCode: d.InstituteCode || "",
        instituteName: d.InstituteNameSnapshot || "",
        sectionName: d.SectionNameSnapshot || "",
        scheduleNo: d.NpsScheduleNoSnapshot || "",
        employeeCount: Number(d.EmployeeCount || 0),
        amount: Number(d.NpsAmount || 0),
        salaryMonth: d.SalaryMonthLabel || "",
        billMonth: d.BillMonthLabel || "",
        billType: d.BillType || "",
        billCode: d.SourceSalaryBillCode || "",
      }));

    const employees = detailRes.recordset
      .filter((d) => d.RowKind === "EMPLOYEE")
      .map((d) => ({
        instituteCode: d.InstituteCode || "",
        employeeId: d.EmployeeId == null ? null : Number(d.EmployeeId),
        employeeCode: d.EmployeeCodeSnapshot || "",
        employeeName: d.EmployeeNameSnapshot || "",
        pran: d.PranSnapshot || "",
        nps: Number(d.NpsAmount || 0),
        billMonth: d.BillMonthLabel || "",
        billType: d.BillType || "",
      }));

    res.json({
      message: "OK",
      data: {
        heading: HEADING,
        subHeading: SUBHEADING,
        purposeLine: PURPOSE_LINE,
        saved: true,
        scheduleId: Number(header.ScheduleId),
        scheduleNo: header.ScheduleNo,
        salaryMonthLabel: header.SalaryMonthLabel,
        billType: header.BillType,
        scheduleDate: header.ScheduleDate,
        sectionName: header.SectionName || "All Sections",
        instituteName: header.InstituteName || "All Institutes",
        revisionNo: Number(header.RevisionNo || 1),
        status: header.Status,
        createdBy: header.CreatedBy || "",
        createdAt: header.CreatedAt,
        rows,
        employees,
        totals: {
          employeeCount: Number(header.EmployeeCount || 0),
          amount: Number(header.TotalNPS || 0),
        },
        rowCount: rows.length,
      },
    });
  } catch (error) {
    console.error("GET /api/nps-schedule/saved/:id error:", error);
    res.status(500).json({
      message: "Unable to load the saved NPS Schedule.",
      error: error.message,
    });
  }
});

module.exports = router;

/* Exported for offline tests (scripts/testNpsScheduleSummary.js). */
module.exports.parseBillType = parseBillType;
module.exports.daRowToScheduleRow = daRowToScheduleRow;
module.exports.loadScheduleNumbers = loadScheduleNumbers;
module.exports.buildScheduleGroups = buildScheduleGroups;
module.exports.compareGroups = compareGroups;
module.exports.filterByInstitute = filterByInstitute;
module.exports.buildNpsScheduleReport = buildNpsScheduleReport;
module.exports.monthPartsFromLabel = monthPartsFromLabel;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
module.exports.letterMonthLabelOf = letterMonthLabelOf;
