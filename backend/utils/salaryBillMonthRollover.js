/**
 * Salary Bill Code Master — "Lock Month" rollover helpers.
 *
 * Pure functions only (no database access) so they can be unit-tested
 * offline. The transactional endpoint lives in routes/salaryBillCodes.js
 * (POST /:id/lock-month) and uses these to:
 *   - work out the next calendar month (DEC-YYYY -> JAN-(YYYY+1)),
 *   - write the next month's SalaryMonth / BillMonth in the SAME textual
 *     format the source row uses (rows hold either "August" or "AUG-2026"),
 *   - carry the Description forward with the month/year rewritten,
 *   - detect an already-existing next-month master row whatever its format,
 *   - apply the month-closure completeness gate (every institute workflow
 *     row APPROVED or LOCKED, and at least one row).
 */

"use strict";

const { normalizeYearMonth } = require("./salaryMonthKey");

const ROLLOVER_MONTHS = [
  { number: 1, name: "January", short: "JAN" },
  { number: 2, name: "February", short: "FEB" },
  { number: 3, name: "March", short: "MAR" },
  { number: 4, name: "April", short: "APR" },
  { number: 5, name: "May", short: "MAY" },
  { number: 6, name: "June", short: "JUN" },
  { number: 7, name: "July", short: "JUL" },
  { number: 8, name: "August", short: "AUG" },
  { number: 9, name: "September", short: "SEP" },
  { number: 10, name: "October", short: "OCT" },
  { number: 11, name: "November", short: "NOV" },
  { number: 12, name: "December", short: "DEC" },
];

const LOCK_MONTH_COMPLETE_STATUSES = new Set(["APPROVED", "LOCKED"]);

function monthMeta(monthNumber) {
  return ROLLOVER_MONTHS[Number(monthNumber) - 1] || null;
}

/** { year, month } of the SalaryBillCodes row, or null. */
function periodOfBillRow(row) {
  if (!row) return null;
  return normalizeYearMonth(row.SalaryMonth, row.SalaryYear, row.SalaryMonthNumber);
}

/** Next calendar month. { year: 2026, month: 12 } -> { year: 2027, month: 1 }. */
function nextCalendarMonth(period) {
  const year = Number(period?.year);
  const month = Number(period?.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** "August 2026" */
function periodLabel(period) {
  const meta = monthMeta(period?.month);
  return meta ? `${meta.name} ${period.year}` : "";
}

/**
 * Format `period` the way `sample` is formatted:
 *   "AUG-2026" -> "SEP-2026", "AUG-26" -> "SEP-26", "AUG" -> "SEP",
 *   "AUGUST" -> "SEPTEMBER", "August" / anything else -> "September".
 */
function formatMonthLike(sample, period) {
  const meta = monthMeta(period?.month);
  if (!meta) return "";
  const raw = String(sample || "").trim();
  if (/^[A-Za-z]{3,9}\s*-\s*\d{4}$/.test(raw)) return `${meta.short}-${period.year}`;
  if (/^[A-Za-z]{3,9}\s*-\s*\d{2}$/.test(raw)) {
    return `${meta.short}-${String(period.year).slice(-2)}`;
  }
  if (/^[A-Z]{3}$/.test(raw) && raw !== "MAY") return meta.short;
  if (/^[A-Z]{4,9}$/.test(raw) || raw === "MAY") return meta.name.toUpperCase();
  return meta.name;
}

function matchCase(source, replacement) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source === source.toLowerCase()) return replacement.toLowerCase();
  return replacement;
}

/**
 * Carry a Description forward to the next month. Month names / short codes of
 * the source month are replaced; the year is replaced only when a month was
 * found and the rollover crosses into a new year. Text with no month in it is
 * kept unchanged; an empty description stays empty.
 */
function rollDescription(description, fromPeriod, toPeriod) {
  const text = String(description || "");
  if (!text.trim()) return "";
  const from = monthMeta(fromPeriod?.month);
  const to = monthMeta(toPeriod?.month);
  if (!from || !to) return text;

  /* One pass over name-or-short so a replacement is never re-matched. */
  let replaced = false;
  const pattern = new RegExp(`\\b(${from.name}|${from.short})\\b`, "gi");
  let out = text.replace(pattern, (match) => {
    replaced = true;
    const isName = match.toUpperCase() === from.name.toUpperCase();
    return matchCase(match, isName ? to.name : to.short);
  });

  if (replaced && Number(fromPeriod.year) !== Number(toPeriod.year)) {
    out = out
      .replace(new RegExp(`\\b${fromPeriod.year}\\b`, "g"), String(toPeriod.year))
      .replace(
        new RegExp(`(\\b${to.short}\\s*-\\s*)${String(fromPeriod.year).slice(-2)}\\b`, "gi"),
        `$1${String(toPeriod.year).slice(-2)}`
      );
  }
  return out;
}

/**
 * Among candidate SalaryBillCodes rows, return the one that already represents
 * the next month's master bill: the exact generated BillCode first, otherwise
 * a same-category/type row for the same year+month that is not a Bill-Month
 * variant ("-BM-XXX"). Archived rows count — they still own the BillCode.
 */
function findExistingNextMonthBill(rows, { billCode, period, billCategory, billType }) {
  const list = Array.isArray(rows) ? rows : [];
  const code = String(billCode || "").trim().toUpperCase();
  const sameText = (a, b) =>
    String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();

  const exact = list.find((row) => String(row.BillCode || "").trim().toUpperCase() === code);
  if (exact) return exact;

  return (
    list.find((row) => {
      if (/-BM-[A-Z]{3}$/i.test(String(row.BillCode || ""))) return false;
      if (!sameText(row.BillCategory, billCategory) || !sameText(row.BillType, billType)) {
        return false;
      }
      const p = periodOfBillRow(row);
      return Boolean(p && p.year === period.year && p.month === period.month);
    }) || null
  );
}

/**
 * Month-closure completeness gate (same rule as POST /:id/complete).
 * Returns null when the month may be locked, else { status, message, ... }.
 */
function evaluateLockMonthGate(workflowRows, billCode) {
  const rows = Array.isArray(workflowRows) ? workflowRows : [];
  if (rows.length === 0) {
    return {
      status: 400,
      message:
        `Bill Code ${billCode} cannot be locked: no institute workflow entries exist. ` +
        `At least one institute must have submitted and been approved before the month can be locked.`,
      incompleteCount: 0,
      totalCount: 0,
      incompleteInstitutes: [],
    };
  }
  const incomplete = rows.filter(
    (r) => !LOCK_MONTH_COMPLETE_STATUSES.has(String(r.Status || "").trim().toUpperCase())
  );
  if (incomplete.length > 0) {
    return {
      status: 400,
      message:
        `Bill Code ${billCode} cannot be locked: ${incomplete.length} of ${rows.length} ` +
        `institute(s) have not been approved. All applicable institutes must be ` +
        `APPROVED or LOCKED before the month can be locked.`,
      incompleteCount: incomplete.length,
      totalCount: rows.length,
      incompleteInstitutes: incomplete.map((r) => ({
        instituteCode: r.InstituteCode,
        instituteName: r.InstituteName,
        status: r.Status,
      })),
    };
  }
  return null;
}

module.exports = {
  ROLLOVER_MONTHS,
  LOCK_MONTH_COMPLETE_STATUSES,
  monthMeta,
  periodOfBillRow,
  nextCalendarMonth,
  periodLabel,
  formatMonthLike,
  rollDescription,
  findExistingNextMonthBill,
  evaluateLockMonthGate,
};
