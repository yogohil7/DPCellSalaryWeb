/**
 * Normalize salary/bill month labels to { year, month } for robust comparison.
 * Accepts: JAN-2027, JAN-27, 2027-01, January, AUG-26, monthNumber+year, etc.
 */

const MONTH_NAME_TO_NUM = {
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPT: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
};

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function expandTwoDigitYear(yy, hintYear) {
  const y = toInt(yy);
  if (y == null) return null;
  if (y >= 100) return y;
  const hint = toInt(hintYear);
  if (hint != null && hint >= 100) {
    const century = Math.floor(hint / 100) * 100;
    return century + y;
  }
  return y >= 70 ? 1900 + y : 2000 + y;
}

/**
 * @returns {{ year: number, month: number } | null}
 */
function normalizeYearMonth(monthValue, yearValue = null, monthNumber = null) {
  const explicitMonth = toInt(monthNumber);
  const explicitYear = toInt(yearValue);

  if (
    explicitMonth != null &&
    explicitMonth >= 1 &&
    explicitMonth <= 12 &&
    explicitYear != null &&
    explicitYear >= 1900
  ) {
    return { year: explicitYear, month: explicitMonth };
  }

  const raw = String(monthValue || "").trim();
  if (!raw && explicitYear == null) return null;

  /* 2027-01 / 2027/01 / 2027.01 */
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) {
    const month = toInt(m[2]);
    const year = toInt(m[1]);
    if (month >= 1 && month <= 12 && year) return { year, month };
  }

  /* 01-2027 / 1/2027 */
  m = raw.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const month = toInt(m[1]);
    const year = toInt(m[2]);
    if (month >= 1 && month <= 12 && year) return { year, month };
  }

  /* JAN-2027 / JANUARY-2027 / JAN-27 / AUG-26 */
  m = raw.match(/^([A-Za-z]+)\s*[-/.\s]\s*(\d{2,4})$/);
  if (m) {
    const month = MONTH_NAME_TO_NUM[m[1].toUpperCase()];
    const year = expandTwoDigitYear(m[2], explicitYear);
    if (month && year) return { year, month };
  }

  /* 01-Jan-2027 / 1 January 2027 */
  m = raw.match(/^(\d{1,2})[-/.\s]+([A-Za-z]+)[-/.\s]+(\d{2,4})$/);
  if (m) {
    const month = MONTH_NAME_TO_NUM[m[2].toUpperCase()];
    const year = expandTwoDigitYear(m[3], explicitYear);
    if (month && year) return { year, month };
  }

  /* Month name only + separate year: "December", "AUG" */
  const nameOnly = MONTH_NAME_TO_NUM[raw.toUpperCase()];
  if (nameOnly && explicitYear != null && explicitYear >= 1900) {
    return { year: explicitYear, month: nameOnly };
  }

  /* Numeric month only + year */
  const numOnly = toInt(raw);
  if (
    numOnly != null &&
    numOnly >= 1 &&
    numOnly <= 12 &&
    explicitYear != null &&
    explicitYear >= 1900
  ) {
    return { year: explicitYear, month: numOnly };
  }

  if (
    explicitMonth != null &&
    explicitMonth >= 1 &&
    explicitMonth <= 12 &&
    explicitYear != null
  ) {
    return { year: explicitYear, month: explicitMonth };
  }

  return null;
}

function yearMonthKey(parts) {
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

const MONTH_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** Canonical UI/DB label: MAY-2026 */
function formatMonthLabel(parts) {
  if (!parts) return "";
  const short = MONTH_SHORT[parts.month - 1];
  if (!short || !parts.year) return "";
  return `${short}-${parts.year}`;
}

/** Short bill-month option style: MAY-26 */
function formatBillMonthOption(parts) {
  if (!parts) return "";
  const short = MONTH_SHORT[parts.month - 1];
  if (!short || !parts.year) return "";
  const yy = String(parts.year).slice(-2);
  return `${short}-${yy}`;
}

/**
 * TYPE = REGULAR when Salary Month == Bill Month (normalized), else OLD.
 * Does not use Bill Code name.
 */
function resolveChequeSalaryType({
  salaryMonth,
  billMonth,
  salaryYear,
  billYear,
  salaryMonthNumber,
  billMonthNumber,
} = {}) {
  const salary = normalizeYearMonth(
    salaryMonth,
    salaryYear,
    salaryMonthNumber
  );
  const bill = normalizeYearMonth(
    billMonth,
    billYear != null ? billYear : salaryYear,
    billMonthNumber
  );
  if (!salary || !bill) return "REGULAR";
  return yearMonthKey(salary) === yearMonthKey(bill) ? "REGULAR" : "OLD";
}

/**
 * BILL TYPE FILTER — the one definition of what a "Salary Type" selection
 * means once a Salary Month has already been chosen.
 *
 * THE BUSINESS RULE
 *   A Salary Month is the period a salary belongs to. An OLD bill is an
 *   ordinary salary bill for that same Salary Month that happens to carry an
 *   earlier Bill Month (resolveChequeSalaryType above: REGULAR when Salary
 *   Month == Bill Month, otherwise OLD). Selecting
 *
 *       Salary Month = JUN-2026 , Salary Type = Regular Salary
 *
 *   must therefore return every ordinary salary bill of June 2026 —
 *   Bill Month APR, MAY and JUN alike. "Regular Salary" names the KIND of
 *   salary (as opposed to DA Difference), not the Bill Month it was raised
 *   in. Reports that required type === "REGULAR" dropped the OLD bills of the
 *   selected month and under-reported the period.
 *
 *   "Old Salary" stays a genuine narrowing option: it returns OLD only. That
 *   is how the NPS Schedule Summary already behaved, and its dropdown already
 *   says "Regular Salary (incl. Old)" — this makes every other report agree
 *   with it instead of each keeping its own rule.
 *
 * WHAT THIS DOES NOT DO
 *   It says nothing about Salary Category. DA Difference is a separate
 *   dimension, excluded by each report's own category check before this is
 *   reached, and never pulled in by "Regular Salary".
 *
 *   It says nothing about the period, the approval status or archiving.
 *   Membership of the month, the APPROVED/LOCKED rule and the archived
 *   exclusion are all decided elsewhere and are unchanged.
 *
 * @param wanted  the Salary Type asked for: ALL | REGULAR | OLD (blank = ALL)
 * @param rowType the row's own bill type from resolveChequeSalaryType
 */
function billTypeMatchesFilter(wanted, rowType) {
  const norm = (v) =>
    String(v == null ? "" : v).trim().toUpperCase().replace(/[\s-]+/g, "_");
  const want = norm(wanted);
  const type = norm(rowType);

  if (!want || want === "ALL") return true;
  if (want === "REGULAR" || want === "REGULAR_SALARY") {
    return type === "REGULAR" || type === "OLD";
  }
  if (want === "OLD" || want === "OLD_SALARY") return type === "OLD";
  return type === want;
}

function matchesFilterMonthYear(parts, filterMonth, filterYear) {
  if (!parts) return false;
  const m = toInt(filterMonth);
  const y = toInt(filterYear);
  if (m == null || y == null) return false;
  return parts.month === m && parts.year === y;
}

module.exports = {
  MONTH_NAME_TO_NUM,
  MONTH_SHORT,
  normalizeYearMonth,
  yearMonthKey,
  formatMonthLabel,
  formatBillMonthOption,
  resolveChequeSalaryType,
  billTypeMatchesFilter,
  matchesFilterMonthYear,
};
