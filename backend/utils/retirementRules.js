/**
 * Retirement-based GPF/NPS deduction stop rule (2026-09-25).
 *
 * Business rule: GPF/NPS employee deduction becomes ZERO starting from the
 * 3rd calendar month before the employee's retirement month (i.e. the
 * retirement month itself plus the two months immediately before it).
 *
 *   deductionStopMonth = retirementMonth - 2 calendar months
 *   stop when deductionStopMonth <= SalaryMonth <= retirementMonth
 *
 * Example — DateOfRetirement = 31-07-2027:
 *   Apr-2027 -> false (normal)     May-2027 -> true (stopped)
 *   Jun-2027 -> true               Jul-2027 -> true
 *   Aug-2027 -> false (normal)
 *
 * IMPORTANT: the comparison is always against the Salary Month, never the
 * Bill Month — Bill Month and Salary Month are independent in this app.
 * A NULL/empty DateOfRetirement never stops the deduction.
 *
 * This module has no database/network dependency (pure functions only) so
 * it can be unit-tested offline and reused by every calculation path.
 */

/** Extracts {year, month(1-12)} from a calendar-date value: a JS Date, an
 *  ISO date/datetime string ("2027-07-31" or "2027-07-31T00:00:00.000Z"),
 *  or any other string Date() can parse. Returns null when the value is
 *  missing/unparseable. Uses UTC getters / the leading YYYY-MM-DD digits
 *  directly (never local time) so a date already anchored at UTC midnight
 *  can never shift a day/month backward depending on server timezone. */
function toYearMonth(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return { year, month };
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 };
}

function monthOrdinal(year, month) {
  return year * 12 + (month - 1);
}

/**
 * @param {object} input
 * @param {Date|string|null} input.dateOfRetirement - EmployeeMaster.DateOfRetirement, verbatim.
 * @param {number|string} input.salaryYear - the SALARY Month's year (never Bill Month).
 * @param {number|string} input.salaryMonth - the SALARY Month's month, 1-12 (never Bill Month).
 * @returns {boolean} true when GPF/NPS deduction must be zero for this Salary Month.
 */
function isGpfNpsStoppedForRetirement({ dateOfRetirement, salaryYear, salaryMonth } = {}) {
  const retirement = toYearMonth(dateOfRetirement);
  if (!retirement) return false; // no retirement date on file -> never stop

  const year = Number(salaryYear);
  const month = Number(salaryMonth);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return false;
  }

  const retirementOrdinal = monthOrdinal(retirement.year, retirement.month);
  const salaryOrdinal = monthOrdinal(year, month);

  return salaryOrdinal >= retirementOrdinal - 2 && salaryOrdinal <= retirementOrdinal;
}

/**
 * Convenience for callers that already have the Salary Month as a
 * YYYY-MM-DD "as of" date (see asOfFromBill() in routes/salaryEntry.js,
 * which anchors it to the LAST DAY of the Salary Month, never Bill Month).
 * Returns null when the string isn't in that shape.
 */
function salaryYearMonthFromAsOfDate(asOfDate) {
  const raw = String(asOfDate || "");
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return { salaryYear: Number(match[1]), salaryMonth: Number(match[2]) };
}

module.exports = {
  isGpfNpsStoppedForRetirement,
  salaryYearMonthFromAsOfDate,
  toYearMonth,
};
