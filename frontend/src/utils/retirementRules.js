/**
 * Retirement-based GPF/NPS deduction stop rule (2026-09-25).
 * Mirrors backend/utils/retirementRules.js — keep both in sync.
 *
 *   deductionStopMonth = retirementMonth - 2 calendar months
 *   stop when deductionStopMonth <= SalaryMonth <= retirementMonth
 *
 * Example — DateOfRetirement = 31-07-2027:
 *   Apr-2027 -> false (normal)     May-2027 -> true (stopped)
 *   Jun-2027 -> true               Jul-2027 -> true
 *   Aug-2027 -> false (normal)
 *
 * IMPORTANT: always compares against the Salary Month, never Bill Month —
 * Bill Month and Salary Month are independent in this app. A null/empty
 * dateOfRetirement, or a salaryMonth label that cannot be parsed, never
 * stops the deduction (fail open to the existing calculation).
 *
 * This is the CLIENT-SIDE mirror used only for immediate grid feedback
 * (live editing before Save). The backend recomputes the same rule fresh
 * from EmployeeMaster.DateOfRetirement at Save Draft / Submit time, which
 * is what's actually authoritative for what gets persisted.
 */

const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** Extracts {year, month(1-12)} from a calendar-date value: a JS Date, an
 *  ISO date/datetime string, or anything else Date() can parse. Reads the
 *  leading YYYY-MM-DD digits directly when present (never local time) so a
 *  date already anchored at UTC midnight can never shift a day/month
 *  backward depending on the browser's timezone. */
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
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return { year: Number(iso[1]), month };
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 };
}

/**
 * Parses a Salary Month LABEL (e.g. "AUG-2026", "AUG-26", "August-2026") —
 * a month identifier, not a calendar date — into {year, month(1-12)}.
 * Returns null when unparseable.
 */
function parseSalaryMonthLabel(label) {
  const raw = String(label || "").trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(/^([A-Z]{3,})[-\s/]?(\d{2,4})$/);
  if (!match) return null;
  const monthIndex = MONTH_NAMES.indexOf(match[1].slice(0, 3));
  if (monthIndex < 0) return null;
  let year = Number(match[2]);
  if (!Number.isFinite(year)) return null;
  if (match[2].length === 2) year += 2000;
  return { year, month: monthIndex + 1 };
}

function monthOrdinal(year, month) {
  return year * 12 + (month - 1);
}

/**
 * @param {object} input
 * @param {Date|string|null} input.dateOfRetirement - employee.dateOfRetirement, verbatim from the API.
 * @param {string} input.salaryMonth - the SALARY Month label (never Bill Month).
 * @returns {boolean} true when GPF/NPS deduction must be zero for this Salary Month.
 */
export function isGpfNpsStoppedForRetirement({ dateOfRetirement, salaryMonth } = {}) {
  const retirement = toYearMonth(dateOfRetirement);
  if (!retirement) return false;

  const salary = parseSalaryMonthLabel(salaryMonth);
  if (!salary) return false;

  const retirementOrdinal = monthOrdinal(retirement.year, retirement.month);
  const salaryOrdinal = monthOrdinal(salary.year, salary.month);

  return salaryOrdinal >= retirementOrdinal - 2 && salaryOrdinal <= retirementOrdinal;
}
