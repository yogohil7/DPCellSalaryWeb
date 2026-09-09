/**
 * EMPLOYEE REPORT — administrative / HR, not a salary report.
 *
 * One report, four ways of selecting employees from the Employee Master:
 *
 *   RETIREMENT_DATE   EmployeeMaster.DateOfRetirement  in [From..To]
 *   CCC_PASS_DATE     EmployeeMaster.CCCPassDate       in [From..To]
 *   JOINING_DATE      EmployeeMaster.DateOfJoining     in [From..To]
 *   INCREMENT_MONTH   EmployeeMaster.MonthOfIncrement  = the chosen month
 *
 * FIELDS — every one of these already exists; none is derived or invented.
 *   DateOfRetirement  DATE NULL   (schema 07)
 *   DateOfJoining     DATE NULL   (schema 07)
 *   CCCPassDate       DATE NULL   (read and written by routes/employees.js)
 *   MonthOfIncrement  INT  NULL   1-12, the explicit increment month that
 *                                 routes/employees.js already validates
 *                                 through parseMonthOfIncrement
 *
 *   The increment month is taken from MonthOfIncrement alone. It is NEVER
 *   computed from Date of Joining, and EmployeeMaster.IncrementDate — a
 *   different, DA-Difference-related column added by migration 33 — is not
 *   used as a substitute for it.
 *
 * NULLS
 *   An employee with no value in the selected field is absent from that
 *   selection: SQL comparison against NULL is never true, so such rows never
 *   match, and nothing is defaulted to a zero or current date to make them.
 *
 * DATES
 *   The range is inclusive at both ends. Comparison is done in SQL against
 *   sql.Date parameters and the columns are DATE, so no time component and no
 *   timezone conversion enters the comparison. Values are handed to the client
 *   as a plain YYYY-MM-DD string built from the date's own parts, so a date
 *   never shifts by a day on the way out.
 *
 * READ-ONLY
 *   SELECT only. This report never writes to the Employee Master, and it
 *   copies nothing into a table of its own — it reads the master as it stands.
 *
 * FILTERING happens in SQL, in one query, with no per-row follow-up lookups.
 */

const express = require("express");
const { sql } = require("../db");

const router = express.Router();

const HEADING = "DIRECTOR OF SOCIAL DEFENCE";
const SUBHEADING = "EMPLOYEE REPORT";

/* The four selections. Values are stable and are what the API expects. */
const SELECTION_RETIREMENT = "RETIREMENT_DATE";
const SELECTION_CCC = "CCC_PASS_DATE";
const SELECTION_JOINING = "JOINING_DATE";
const SELECTION_INCREMENT = "INCREMENT_MONTH";

const SELECTION_TYPES = [
  { value: SELECTION_RETIREMENT, label: "Retirement Date Wise", mode: "DATE_RANGE" },
  { value: SELECTION_CCC, label: "CCC Pass Date Wise", mode: "DATE_RANGE" },
  { value: SELECTION_JOINING, label: "Joining Date Wise", mode: "DATE_RANGE" },
  { value: SELECTION_INCREMENT, label: "Increment Month Wise", mode: "MONTH" },
];

/**
 * The Employee Master column each selection filters on.
 *
 * The value is a fixed identifier chosen here, never anything taken from the
 * request, so the selection can be interpolated into the WHERE clause while
 * every user-supplied value still travels as a bound parameter.
 */
const SELECTION_COLUMN = {
  [SELECTION_RETIREMENT]: "e.DateOfRetirement",
  [SELECTION_CCC]: "e.CCCPassDate",
  [SELECTION_JOINING]: "e.DateOfJoining",
  [SELECTION_INCREMENT]: "e.MonthOfIncrement",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_OPTIONS = MONTH_NAMES.map((label, i) => ({ value: i + 1, label }));

function parseSelectionType(value) {
  const text = String(value == null ? "" : value)
    .trim().toUpperCase().replace(/[\s-]+/g, "_");
  const found = SELECTION_TYPES.find((t) => t.value === text);
  return found ? found.value : SELECTION_RETIREMENT;
}

function selectionLabel(type) {
  const found = SELECTION_TYPES.find((t) => t.value === type);
  return found ? found.label : "";
}

function selectionMode(type) {
  const found = SELECTION_TYPES.find((t) => t.value === type);
  return found ? found.mode : "DATE_RANGE";
}

/**
 * An ISO date (YYYY-MM-DD) from a request value, or null.
 *
 * Only the calendar parts are kept, so a value that arrives with a time or a
 * zone cannot move the day. Anything unparseable is null, which the caller
 * treats as "this end of the range was not given".
 */
function parseIsoDate(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;

  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }
  /* DD-MM-YYYY / DD-MM-YYYY, the form the printed reports use. */
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(text);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }
  return null;
}

/** 1-12, or null. */
function parseMonth(value) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === text);
  return idx >= 0 ? idx + 1 : null;
}

function toIntOrNull(value) {
  if (value == null || value === "" || value === "ALL") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A DATE column rendered as YYYY-MM-DD.
 *
 * The driver hands back a JS Date built from the stored calendar date. Reading
 * its UTC parts returns exactly those parts, where toISOString on a local-time
 * Date can roll back a day west of Greenwich. A string that already looks like
 * a date is passed straight through.
 */
function dateOnly(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : text || null;
}

/** DD-MM-YYYY for display, from an ISO date. */
function displayDate(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

function monthName(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 1 && i <= 12 ? MONTH_NAMES[i - 1] : "";
}

function mapEmployeeRow(row) {
  return {
    employeeId: row.EmployeeId != null ? Number(row.EmployeeId) : null,
    employeeCode:
      row.EmployeeCode != null && String(row.EmployeeCode).trim() !== ""
        ? String(row.EmployeeCode).trim()
        : String(row.EmployeeId == null ? "" : row.EmployeeId),
    employeeName: row.EmployeeName || "",
    designation: row.DesignationName || "",
    employeeType: row.EmployeeType || "",
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    sectionName: row.SectionName || "",
    sectionSrNo: row.SectionSrNo == null ? null : Number(row.SectionSrNo),
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || row.InstituteCode || "",
    dateOfJoining: dateOnly(row.DateOfJoining),
    cccPassDate: dateOnly(row.CCCPassDate),
    dateOfRetirement: dateOnly(row.DateOfRetirement),
    monthOfIncrement:
      row.MonthOfIncrement == null ? null : Number(row.MonthOfIncrement),
    monthOfIncrementName: monthName(row.MonthOfIncrement),
    /* The same values again, formatted the way the report prints them. */
    joiningDateText: displayDate(dateOnly(row.DateOfJoining)),
    cccPassDateText: displayDate(dateOnly(row.CCCPassDate)),
    retirementDateText: displayDate(dateOnly(row.DateOfRetirement)),
  };
}

/**
 * Loads the matching employees.
 *
 * Everything the user supplied is a bound parameter. The only interpolated
 * text is SELECTION_COLUMN[selection], one of four fixed column names chosen
 * in this file.
 */
async function loadEmployees(criteria) {
  const {
    selectionType, fromDate, toDate, incrementMonth, sectionId, instituteCode,
  } = criteria;

  const request = new sql.Request();
  const where = [];

  /* The report lists employees on the payroll, matching the Employee Master's
     own active rule (routes/employees.js). */
  where.push("ISNULL(e.IsActive, 1) = 1");
  where.push("UPPER(ISNULL(e.Status, N'Active')) = N'ACTIVE'");

  const column = SELECTION_COLUMN[selectionType];

  if (selectionType === SELECTION_INCREMENT) {
    /* NULL never equals anything, so employees with no increment month are
       excluded without a special case. */
    request.input("IncrementMonth", sql.Int, incrementMonth);
    where.push(`${column} = @IncrementMonth`);
  } else {
    /* Inclusive at both ends; a NULL date can satisfy neither comparison. */
    if (fromDate) {
      request.input("FromDate", sql.Date, fromDate);
      where.push(`${column} >= @FromDate`);
    }
    if (toDate) {
      request.input("ToDate", sql.Date, toDate);
      where.push(`${column} <= @ToDate`);
    }
    /* With neither end given, the selection still means "has this date". */
    where.push(`${column} IS NOT NULL`);
  }

  if (sectionId != null) {
    request.input("SectionId", sql.Int, sectionId);
    where.push("ISNULL(e.SectionId, i.SectionId) = @SectionId");
  }
  if (instituteCode) {
    request.input("InstituteCode", sql.NVarChar(50), instituteCode);
    where.push("UPPER(LTRIM(RTRIM(i.InstituteCode))) = UPPER(@InstituteCode)");
  }

  const result = await request.query(`
    SELECT
      e.EmployeeId,
      e.EmployeeCode,
      e.EmployeeName,
      e.EmployeeType,
      e.DateOfJoining,
      e.DateOfRetirement,
      e.CCCPassDate,
      e.MonthOfIncrement,
      ISNULL(e.SectionId, i.SectionId) AS SectionId,
      d.DesignationName,
      i.InstituteCode,
      i.InstituteName,
      s.SectionName,
      s.SrNo AS SectionSrNo
    FROM dbo.EmployeeMaster e
    LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    LEFT JOIN dbo.Sections s ON s.SectionId = ISNULL(e.SectionId, i.SectionId)
    WHERE ${where.join("\n      AND ")}
  `);

  return (result.recordset || []).map(mapEmployeeRow);
}

/**
 * Sorting: the selected date or month first — the column the user chose the
 * report by — then Section, Institute and Employee Name, the same section-then-
 * institute order the salary reports use. Employee Master's own ordering is
 * untouched; this applies to this report only.
 */
function sortKeyOf(row, selectionType) {
  if (selectionType === SELECTION_RETIREMENT) return row.dateOfRetirement || "";
  if (selectionType === SELECTION_CCC) return row.cccPassDate || "";
  if (selectionType === SELECTION_JOINING) return row.dateOfJoining || "";
  return String(row.monthOfIncrement == null ? "" : row.monthOfIncrement)
    .padStart(2, "0");
}

function compareRows(a, b, selectionType) {
  const ka = sortKeyOf(a, selectionType);
  const kb = sortKeyOf(b, selectionType);
  if (ka !== kb) return ka < kb ? -1 : 1;

  const sa = a.sectionSrNo == null ? Number.MAX_SAFE_INTEGER : a.sectionSrNo;
  const sb = b.sectionSrNo == null ? Number.MAX_SAFE_INTEGER : b.sectionSrNo;
  if (sa !== sb) return sa - sb;

  const ia = String(a.instituteCode || "");
  const ib = String(b.instituteCode || "");
  if (ia !== ib) return ia.localeCompare(ib);

  const na = String(a.employeeName || "");
  const nb = String(b.employeeName || "");
  if (na !== nb) return na.localeCompare(nb);

  return (a.employeeId || 0) - (b.employeeId || 0);
}

/**
 * The single data builder. The screen, the .xlsx export, the PDF and Print all
 * go through this, so no output can filter differently from another.
 */
async function buildEmployeeReport(query = {}) {
  const selectionType = parseSelectionType(query.selectionType || query.type);
  const mode = selectionMode(selectionType);

  const fromDate = mode === "DATE_RANGE" ? parseIsoDate(query.fromDate) : null;
  const toDate = mode === "DATE_RANGE" ? parseIsoDate(query.toDate) : null;
  const incrementMonth =
    mode === "MONTH" ? parseMonth(query.incrementMonth || query.month) : null;

  const sectionId = toIntOrNull(query.sectionId);
  const instituteCodeRaw = String(query.instituteCode || "").trim();
  const instituteCode =
    instituteCodeRaw && instituteCodeRaw.toUpperCase() !== "ALL"
      ? instituteCodeRaw
      : "";

  /* Increment Month Wise needs a month; without one there is nothing to
     select by, and an unfiltered dump of the Employee Master would be wrong. */
  if (mode === "MONTH" && incrementMonth == null) {
    return {
      heading: HEADING,
      subHeading: SUBHEADING,
      selectionType,
      selectionLabel: selectionLabel(selectionType),
      selectionMode: mode,
      columns: columnsFor(selectionType),
      filters: filtersOf(selectionType, {
        fromDate, toDate, incrementMonth, sectionId, instituteCode,
      }),
      rows: [],
      count: 0,
      emptyMessage: "Select an Increment Month to run this report.",
    };
  }

  const loaded = await loadEmployees({
    selectionType, fromDate, toDate, incrementMonth, sectionId, instituteCode,
  });

  const rows = loaded
    .sort((a, b) => compareRows(a, b, selectionType))
    .map((row, index) => ({ ...row, srNo: index + 1 }));

  return {
    heading: HEADING,
    subHeading: SUBHEADING,
    selectionType,
    selectionLabel: selectionLabel(selectionType),
    selectionMode: mode,
    columns: columnsFor(selectionType),
    filters: filtersOf(selectionType, {
      fromDate, toDate, incrementMonth, sectionId, instituteCode,
    }),
    rows,
    count: rows.length,
    emptyMessage: "No employees found for the selected criteria.",
  };
}

function filtersOf(selectionType, f) {
  return {
    selectionType,
    selectionLabel: selectionLabel(selectionType),
    fromDate: f.fromDate,
    toDate: f.toDate,
    fromDateText: displayDate(f.fromDate),
    toDateText: displayDate(f.toDate),
    incrementMonth: f.incrementMonth,
    incrementMonthName: monthName(f.incrementMonth),
    sectionId: f.sectionId,
    instituteCode: f.instituteCode || "",
  };
}

/**
 * Columns per selection: the identity of the employee, then the date the
 * report was chosen by, kept clearly visible, then the other useful dates —
 * without making every variant as wide as the union of all of them.
 */
const COLUMN_IDENTITY = [
  { key: "srNo", label: "Sr. No.", type: "number" },
  { key: "employeeCode", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "designation", label: "Designation" },
  { key: "employeeType", label: "Employee Type" },
  { key: "sectionName", label: "Section" },
  { key: "instituteCode", label: "Institute Code" },
  { key: "instituteName", label: "Institute Name" },
];

const COL_JOINING = { key: "joiningDateText", label: "Date of Joining" };
const COL_CCC = { key: "cccPassDateText", label: "CCC Pass Date" };
const COL_RETIREMENT = { key: "retirementDateText", label: "Retirement Date" };
const COL_INCREMENT = { key: "monthOfIncrementName", label: "Increment Month" };

function columnsFor(selectionType) {
  if (selectionType === SELECTION_CCC) {
    return [...COLUMN_IDENTITY, COL_CCC, COL_JOINING];
  }
  if (selectionType === SELECTION_INCREMENT) {
    return [...COLUMN_IDENTITY, COL_INCREMENT, COL_JOINING];
  }
  /* Retirement and Joining both read best with the two service dates. */
  return [...COLUMN_IDENTITY, COL_JOINING, COL_RETIREMENT];
}

/* Section and Institute lookups — the existing master data, not a copy. */
async function loadMeta() {
  const sections = await sql.query`
    SELECT SectionId, SectionName, SrNo
    FROM dbo.Sections
    ORDER BY SrNo ASC, SectionId ASC
  `;
  const institutes = await sql.query`
    SELECT InstituteId, InstituteCode, InstituteName, SectionId
    FROM dbo.Institutes
    ORDER BY InstituteCode ASC
  `;
  return {
    selectionTypes: SELECTION_TYPES,
    months: MONTH_OPTIONS,
    sections: [
      { sectionId: null, sectionName: "All Sections" },
      ...(sections.recordset || []).map((r) => ({
        sectionId: Number(r.SectionId),
        sectionName: r.SectionName || "",
      })),
    ],
    institutes: [
      { instituteCode: "", instituteName: "All Institutes", sectionId: null },
      ...(institutes.recordset || []).map((r) => ({
        instituteCode: r.InstituteCode || "",
        instituteName: r.InstituteName || "",
        sectionId: r.SectionId == null ? null : Number(r.SectionId),
      })),
    ],
  };
}

/* GET /api/employee-report/meta — filter options */
router.get("/meta", async (_req, res) => {
  try {
    res.json({ message: "OK", data: await loadMeta() });
  } catch (error) {
    console.error("GET /api/employee-report/meta error:", error);
    res.status(500).json({
      message: "Unable to load Employee Report filters.",
      error: error.message,
    });
  }
});

/* GET /api/employee-report */
router.get("/", async (req, res) => {
  try {
    const data = await buildEmployeeReport(req.query || {});
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/employee-report error:", error);
    res.status(500).json({
      message: "Unable to load the Employee Report.",
      error: error.message,
    });
  }
});

/* GET /api/employee-report/export.xlsx — the SAME builder. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildEmployeeReport(req.query || {});
    const columns = data.columns;

    const criteriaLine =
      data.selectionMode === "MONTH"
        ? `Increment Month: ${data.filters.incrementMonthName}`
        : `From: ${data.filters.fromDateText || "-"}   To: ${data.filters.toDateText || "-"}`;

    const heading = [
      [data.heading],
      [data.subHeading],
      [`Selection: ${data.selectionLabel}`],
      [criteriaLine],
      [`Employees: ${data.count}`],
      [],
    ];
    const header = columns.map((c) => c.label);
    const body = data.rows.map((row) =>
      columns.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      })
    );

    const sheet = XLSX.utils.aoa_to_sheet([...heading, header, ...body]);
    sheet["!cols"] = columns.map((c) =>
      c.key === "employeeName" || c.key === "instituteName"
        ? { wch: 30 }
        : { wch: 16 }
    );

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Employee Report");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Employee_Report.xlsx"'
    );
    res.send(buffer);
  } catch (error) {
    console.error("GET /api/employee-report/export.xlsx error:", error);
    res.status(500).json({
      message: "Unable to export the Employee Report.",
      error: error.message,
    });
  }
});

module.exports = router;
module.exports.buildEmployeeReport = buildEmployeeReport;
module.exports.loadEmployees = loadEmployees;
module.exports.mapEmployeeRow = mapEmployeeRow;
module.exports.compareRows = compareRows;
module.exports.columnsFor = columnsFor;
module.exports.parseSelectionType = parseSelectionType;
module.exports.parseIsoDate = parseIsoDate;
module.exports.parseMonth = parseMonth;
module.exports.dateOnly = dateOnly;
module.exports.displayDate = displayDate;
module.exports.SELECTION_TYPES = SELECTION_TYPES;
module.exports.SELECTION_COLUMN = SELECTION_COLUMN;
module.exports.HEADING = HEADING;
module.exports.SUBHEADING = SUBHEADING;
