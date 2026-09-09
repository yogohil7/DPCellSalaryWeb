/**
 * DA Difference Month Lock helpers.
 * Lock identity is normalized (year, monthNumber) — never display-string compare.
 */
const { sql } = require("../db");
const { normalizeYearMonth, yearMonthKey } = require("./salaryMonthKey");
const { pad2, monthName } = require("./employeeIncrement");

const MONTH_SHORT = [
  "",
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

function formatMonthLabel(year, monthNumber) {
  const m = Number(monthNumber);
  const y = Number(year);
  const short = MONTH_SHORT[m] || pad2(m);
  return `${short}-${y}`;
}

function resolveMonthParts({
  month,
  year,
  monthNumber,
  salaryMonth,
  paymentSalaryMonth,
  paymentSalaryMonthNumber,
  paymentSalaryYear,
} = {}) {
  const ym =
    normalizeYearMonth(
      month || salaryMonth || paymentSalaryMonth,
      year || paymentSalaryYear,
      monthNumber || paymentSalaryMonthNumber
    ) || null;
  if (!ym) return null;
  return {
    year: ym.year,
    month: ym.month,
    monthNumber: pad2(ym.month),
    label: formatMonthLabel(ym.year, ym.month),
    key: yearMonthKey(ym),
  };
}

function lockedMessage(label) {
  return `DA Difference month ${label} is locked and cannot be modified.`;
}

async function getMonthLock(year, monthNumber) {
  const y = Number(year);
  const m = Number(monthNumber);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  const result = await sql.query`
    SELECT TOP 1 *
    FROM dbo.DADifferenceMonthLock
    WHERE LockYear = ${y}
      AND LockMonthNumber = ${m}
  `;
  return result.recordset[0] || null;
}

async function isDaDifferenceMonthLocked(parts) {
  const resolved =
    typeof parts === "object" && parts?.year != null
      ? parts.year && parts.month
        ? {
            year: Number(parts.year),
            month: Number(parts.month),
            label:
              parts.label ||
              formatMonthLabel(parts.year, parts.month),
          }
        : resolveMonthParts(parts)
      : resolveMonthParts(parts);
  if (!resolved) return { locked: false, parts: null, row: null };

  const row = await getMonthLock(resolved.year, resolved.month);
  const locked = Boolean(row && Number(row.IsLocked) === 1);
  return {
    locked,
    parts: {
      year: resolved.year,
      month: resolved.month,
      monthNumber: pad2(resolved.month),
      label: resolved.label || formatMonthLabel(resolved.year, resolved.month),
      key: yearMonthKey({ year: resolved.year, month: resolved.month }),
    },
    row,
  };
}

/**
 * Returns a 409-style block object when locked, else null.
 */
async function assertDaDifferenceMonthEditable(monthInput) {
  const status = await isDaDifferenceMonthLocked(monthInput);
  if (!status.locked) return null;
  return {
    status: 409,
    message: lockedMessage(status.parts.label),
    monthLock: mapLockRow(status.row, status.parts),
  };
}

function mapLockRow(row, parts) {
  const year = parts?.year ?? Number(row?.LockYear);
  const month = parts?.month ?? Number(row?.LockMonthNumber);
  const label =
    parts?.label ||
    row?.MonthLabel ||
    formatMonthLabel(year, month);
  const locked = Boolean(row && Number(row.IsLocked) === 1);
  return {
    year,
    month,
    monthNumber: pad2(month),
    label,
    status: locked ? "LOCKED" : "OPEN",
    isLocked: locked,
    lockedDate: row?.LockedDate || null,
    lockedBy: row?.LockedBy || "",
    lockedByUserId:
      row?.LockedByUserId != null ? Number(row.LockedByUserId) : null,
    remarks: row?.Remarks || "",
  };
}

async function lockDaDifferenceMonth({ year, month, actor, remarks }) {
  const parts = resolveMonthParts({ year, monthNumber: month });
  if (!parts) {
    const err = new Error("A valid DA Difference month and year are required.");
    err.status = 400;
    throw err;
  }

  const existing = await getMonthLock(parts.year, parts.month);
  if (existing && Number(existing.IsLocked) === 1) {
    const err = new Error(
      `DA Difference month ${parts.label} is already locked.`
    );
    err.status = 409;
    throw err;
  }

  const who = actor?.fullName || actor?.userName || "SYSTEM";
  const userId =
    actor?.userId != null && Number.isFinite(Number(actor.userId))
      ? Number(actor.userId)
      : null;

  if (existing) {
    await sql.query`
      UPDATE dbo.DADifferenceMonthLock
      SET
        IsLocked = 1,
        MonthLabel = ${parts.label},
        LockedDate = SYSUTCDATETIME(),
        LockedBy = ${who},
        LockedByUserId = ${userId},
        Remarks = ${remarks || null},
        UpdatedDate = SYSUTCDATETIME(),
        UpdatedBy = ${who}
      WHERE LockYear = ${parts.year}
        AND LockMonthNumber = ${parts.month}
    `;
  } else {
    await sql.query`
      INSERT INTO dbo.DADifferenceMonthLock
        (
          LockYear, LockMonthNumber, MonthLabel, IsLocked,
          LockedDate, LockedBy, LockedByUserId, Remarks, CreatedBy
        )
      VALUES
        (
          ${parts.year}, ${parts.month}, ${parts.label}, 1,
          SYSUTCDATETIME(), ${who}, ${userId}, ${remarks || null}, ${who}
        )
    `;
  }

  const row = await getMonthLock(parts.year, parts.month);
  return mapLockRow(row, parts);
}

async function listDaDifferenceMonthLocks() {
  const result = await sql.query`
    SELECT *
    FROM dbo.DADifferenceMonthLock
    WHERE IsLocked = 1
    ORDER BY LockYear DESC, LockMonthNumber DESC
  `;
  return result.recordset.map((row) =>
    mapLockRow(row, {
      year: Number(row.LockYear),
      month: Number(row.LockMonthNumber),
      label: row.MonthLabel,
    })
  );
}

module.exports = {
  formatMonthLabel,
  resolveMonthParts,
  lockedMessage,
  getMonthLock,
  isDaDifferenceMonthLocked,
  assertDaDifferenceMonthEditable,
  lockDaDifferenceMonth,
  listDaDifferenceMonthLocks,
  mapLockRow,
  monthName,
};
