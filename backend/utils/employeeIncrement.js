/**
 * Employee Increment engine.
 *
 * Responsibilities:
 *   - decide WHETHER an increment is due for a given salary month
 *     (month-aware, never July-hard-coded)
 *   - work out the NEW Basic, preferring the next Pay Matrix cell
 *   - resolve the Basic that applies to any salary month, so an increment
 *     stays in effect for every later month and never leaks backwards
 *
 * It deliberately does NOT recalculate DA/HRA/MA/TA/CLA/NPS itself.
 * The new Basic is handed to calculateForEmployee(id, asOfDate, newBasic),
 * which is the single existing engine for every salary component.
 */

const { sql } = require("../db");

const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

const MONTH_NAME = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Number(toNum(value).toFixed(2));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 'YYYY-MM' key used for ordering and for the unique index. */
function monthKey(year, monthNumber) {
  return `${String(year).trim()}-${pad2(Number(monthNumber))}`;
}

/** 'JAN-2026' style label. */
function monthLabel(year, monthNumber) {
  const idx = Number(monthNumber) - 1;
  const short = MONTH_SHORT[idx] || String(monthNumber);
  return `${short}-${String(year).trim()}`;
}

function monthName(monthNumber) {
  return MONTH_NAME[Number(monthNumber) - 1] || "";
}

/** First day of a salary month, which is what the masters are keyed on. */
function firstOfMonth(year, monthNumber) {
  return `${String(year).trim()}-${pad2(Number(monthNumber))}-01`;
}

/**
 * Inclusive list of months between two YYYY/MM pairs.
 * Returns [{ year, monthNumber, key, label, name, asOfDate }, ...]
 */
function buildMonthRange(fromYear, fromMonth, toYear, toMonth) {
  const start = Number(fromYear) * 12 + (Number(fromMonth) - 1);
  const end = Number(toYear) * 12 + (Number(toMonth) - 1);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return [];
  }
  /* Guard against an absurd range being requested by a caller. */
  if (end - start > 60) {
    const err = new Error(
      "Difference period cannot be longer than 60 months."
    );
    err.status = 400;
    throw err;
  }

  const months = [];
  for (let i = start; i <= end; i += 1) {
    const year = Math.floor(i / 12);
    const monthNumber = (i % 12) + 1;
    months.push({
      year: String(year),
      monthNumber: pad2(monthNumber),
      key: monthKey(year, monthNumber),
      label: monthLabel(year, monthNumber),
      name: monthName(monthNumber),
      asOfDate: firstOfMonth(year, monthNumber),
    });
  }
  return months;
}

/**
 * Is this increment in effect for the given salary month?
 * In effect from its EffectiveMonth onward, and never before it.
 */
function isIncrementEffectiveFor(increment, targetMonthKey) {
  if (!increment) return false;
  if (String(increment.Status || "").toLowerCase() !== "active") return false;
  return String(increment.EffectiveMonth || "") <= String(targetMonthKey);
}

/**
 * The increment that governs a salary month: the latest ACTIVE increment
 * whose EffectiveMonth is on or before that month.
 */
function pickEffectiveIncrement(increments, targetMonthKey) {
  let chosen = null;
  for (const inc of increments || []) {
    if (!isIncrementEffectiveFor(inc, targetMonthKey)) continue;
    if (
      !chosen ||
      String(inc.EffectiveMonth) > String(chosen.EffectiveMonth) ||
      (String(inc.EffectiveMonth) === String(chosen.EffectiveMonth) &&
        Number(inc.IncrementId) > Number(chosen.IncrementId))
    ) {
      chosen = inc;
    }
  }
  return chosen;
}

/**
 * Is an increment DUE in this specific month for this employee?
 * Driven by EmployeeMaster.IncrementDate when present, otherwise by
 * EmployeeMaster.MonthOfIncrement. No month is hard-coded.
 */
function isIncrementDueInMonth(employee, year, monthNumber) {
  const target = Number(monthNumber);
  const targetYear = Number(year);

  const incrementDate = employee.IncrementDate
    ? new Date(employee.IncrementDate)
    : null;

  if (incrementDate && !Number.isNaN(incrementDate.getTime())) {
    const incMonth = incrementDate.getUTCMonth() + 1;
    const incYear = incrementDate.getUTCFullYear();
    /* Due in its own month, and in the same month of every later year
       (an annual increment recurs). */
    if (incMonth !== target) return false;
    return targetYear >= incYear;
  }

  const monthOfIncrement = Number(employee.MonthOfIncrement);
  if (!Number.isFinite(monthOfIncrement) || monthOfIncrement < 1) {
    return false;
  }
  return monthOfIncrement === target;
}

/* =========================================================
   DATA ACCESS
   ========================================================= */

/** Every increment row for an employee, newest effective month first. */
async function listIncrements(employeeId, options = {}) {
  const includeCancelled = Boolean(options.includeCancelled);
  const result = await sql.query`
    SELECT *
    FROM dbo.EmployeeIncrement
    WHERE EmployeeId = ${Number(employeeId)}
      AND (${includeCancelled ? 1 : 0} = 1 OR Status = N'Active')
    ORDER BY EffectiveMonth DESC, IncrementId DESC
  `;
  return result.recordset;
}

async function getIncrementById(incrementId) {
  const result = await sql.query`
    SELECT TOP 1 * FROM dbo.EmployeeIncrement
    WHERE IncrementId = ${Number(incrementId)}
  `;
  return result.recordset[0] || null;
}

/** The active increment already recorded for exactly this month, if any. */
async function findIncrementForMonth(employeeId, targetMonthKey) {
  const result = await sql.query`
    SELECT TOP 1 *
    FROM dbo.EmployeeIncrement
    WHERE EmployeeId = ${Number(employeeId)}
      AND EffectiveMonth = ${String(targetMonthKey)}
      AND Status = N'Active'
    ORDER BY IncrementId DESC
  `;
  return result.recordset[0] || null;
}

/**
 * Next Pay Matrix cell in the same level — the standard annual increment.
 * Returns null when the employee is at the top of the level or the matrix
 * has no next cell, in which case the caller falls back to a flat amount.
 */
async function findNextMatrixCell(payRevisionId, payLevel, currentCellNo) {
  if (
    !Number.isFinite(Number(payRevisionId)) ||
    !payLevel ||
    !Number.isFinite(Number(currentCellNo))
  ) {
    return null;
  }

  const result = await sql.query`
    SELECT TOP 1 PayMatrixId, Level, CellNo, BasicPay
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = ${Number(payRevisionId)}
      AND LTRIM(RTRIM(CAST(Level AS NVARCHAR(50)))) = ${String(payLevel).trim()}
      AND CellNo > ${Number(currentCellNo)}
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY CellNo ASC
  `;

  const row = result.recordset[0];
  if (!row) return null;

  return {
    payMatrixId: Number(row.PayMatrixId),
    payLevel: String(row.Level),
    cellNo: Number(row.CellNo),
    basicPay: toNum(row.BasicPay),
  };
}

/**
 * Find the Pay Matrix cell whose Basic equals a given amount, within the
 * employee's own level. Used when a manually typed New Basic coincides
 * with a real cell, so the increment chain keeps its place in the matrix.
 */
async function findMatrixCellByBasic(payRevisionId, payLevel, basicPay) {
  if (!Number.isFinite(Number(payRevisionId)) || !payLevel) return null;

  const result = await sql.query`
    SELECT TOP 1 PayMatrixId, Level, CellNo, BasicPay
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = ${Number(payRevisionId)}
      AND LTRIM(RTRIM(CAST(Level AS NVARCHAR(50)))) = ${String(payLevel).trim()}
      AND BasicPay = ${roundMoney(basicPay)}
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY CellNo ASC
  `;

  const row = result.recordset[0];
  if (!row) return null;

  return {
    payMatrixId: Number(row.PayMatrixId),
    payLevel: String(row.Level),
    cellNo: Number(row.CellNo),
    basicPay: toNum(row.BasicPay),
  };
}

/* =========================================================
   CALCULATION
   ========================================================= */

/**
 * Work out the increment that WOULD apply for a salary month.
 * Pure decision + matrix lookup; writes nothing.
 *
 * @returns {object} {
 *   due, alreadyRecorded, increment, previousBasic, newBasic,
 *   incrementAmount, previousPayLevel, newPayLevel,
 *   previousCellNo, newCellNo, source, reason
 * }
 */
async function resolveIncrementForMonth({
  employee,
  currentBasic,
  year,
  monthNumber,
  manualAmount = null,
  manualNewBasic = null,
}) {
  const key = monthKey(year, monthNumber);
  const employeeId = Number(employee.EmployeeId);

  const existing = await findIncrementForMonth(employeeId, key);
  if (existing) {
    return {
      due: true,
      alreadyRecorded: true,
      increment: existing,
      previousBasic: toNum(existing.PreviousBasic),
      newBasic: toNum(existing.NewBasic),
      incrementAmount: toNum(existing.IncrementAmount),
      previousPayLevel: existing.PreviousPayLevel,
      newPayLevel: existing.NewPayLevel,
      previousCellNo: existing.PreviousCellNo,
      newCellNo: existing.NewCellNo,
      source: "recorded",
      reason: `Increment already recorded for ${monthLabel(year, monthNumber)}.`,
    };
  }

  if (!isIncrementDueInMonth(employee, year, monthNumber)) {
    return {
      due: false,
      alreadyRecorded: false,
      increment: null,
      previousBasic: roundMoney(currentBasic),
      newBasic: roundMoney(currentBasic),
      incrementAmount: 0,
      source: "none",
      reason: `No increment due in ${monthLabel(year, monthNumber)}.`,
    };
  }

  const previousBasic = roundMoney(currentBasic);
  const previousPayLevel = employee.PayLevel ?? employee.MatrixLevel ?? null;
  const previousCellNo = Number(
    employee.PayMatrixCellNo ?? employee.MatrixCellNo
  );

  /*
    A manually entered New Basic wins over everything, including the Pay
    Matrix cell. The increment amount is derived from it so the stored
    history stays internally consistent and later increments chain from
    this Basic rather than from the matrix value it replaced.
  */
  if (
    manualNewBasic != null &&
    manualNewBasic !== "" &&
    toNum(manualNewBasic) > 0
  ) {
    const newBasic = roundMoney(manualNewBasic);
    if (newBasic <= previousBasic) {
      return {
        due: true,
        alreadyRecorded: false,
        increment: null,
        previousBasic,
        newBasic: previousBasic,
        incrementAmount: 0,
        previousPayLevel,
        newPayLevel: previousPayLevel,
        previousCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
        newCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
        source: "manual-basic-invalid",
        reason:
          `Manual New Basic ${newBasic} must be greater than the previous ` +
          `Basic ${previousBasic}.`,
      };
    }

    /* If the typed Basic happens to match a matrix cell, keep that cell so
       the next annual increment continues correctly down the level. */
    const matched = await findMatrixCellByBasic(
      employee.PayRevisionId,
      previousPayLevel,
      newBasic
    );

    return {
      due: true,
      alreadyRecorded: false,
      increment: null,
      previousBasic,
      newBasic,
      incrementAmount: roundMoney(newBasic - previousBasic),
      previousPayLevel,
      newPayLevel: matched ? matched.payLevel : previousPayLevel,
      previousCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
      newCellNo: matched
        ? matched.cellNo
        : Number.isFinite(previousCellNo)
          ? previousCellNo
          : null,
      payMatrixId: matched ? matched.payMatrixId : null,
      source: "manual-basic",
      reason:
        `Manual New Basic applied for ${monthLabel(year, monthNumber)}: ` +
        `${previousBasic} → ${newBasic}` +
        (matched ? ` (matches Pay Matrix cell ${matched.cellNo}).` : "."),
    };
  }

  /* An explicit amount is next — it is what the user typed. */
  if (manualAmount != null && manualAmount !== "" && toNum(manualAmount) > 0) {
    const amount = roundMoney(manualAmount);
    return {
      due: true,
      alreadyRecorded: false,
      increment: null,
      previousBasic,
      newBasic: roundMoney(previousBasic + amount),
      incrementAmount: amount,
      previousPayLevel,
      newPayLevel: previousPayLevel,
      previousCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
      newCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
      source: "manual",
      reason: `Manual increment of ${amount} applied for ${monthLabel(year, monthNumber)}.`,
    };
  }

  /* Standard annual increment: move to the next cell of the same level. */
  const next = await findNextMatrixCell(
    employee.PayRevisionId,
    previousPayLevel,
    previousCellNo
  );

  if (!next) {
    return {
      due: true,
      alreadyRecorded: false,
      increment: null,
      previousBasic,
      newBasic: previousBasic,
      incrementAmount: 0,
      previousPayLevel,
      newPayLevel: previousPayLevel,
      previousCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
      newCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
      source: "matrix-exhausted",
      reason:
        `Increment is due in ${monthLabel(year, monthNumber)} but no higher ` +
        `Pay Matrix cell exists for level ${previousPayLevel || "?"}. ` +
        `Basic is unchanged; enter a manual increment if one is payable.`,
    };
  }

  return {
    due: true,
    alreadyRecorded: false,
    increment: null,
    previousBasic,
    newBasic: roundMoney(next.basicPay),
    incrementAmount: roundMoney(next.basicPay - previousBasic),
    previousPayLevel,
    newPayLevel: next.payLevel,
    previousCellNo: Number.isFinite(previousCellNo) ? previousCellNo : null,
    newCellNo: next.cellNo,
    payMatrixId: next.payMatrixId,
    source: "matrix",
    reason:
      `Annual increment for ${monthLabel(year, monthNumber)}: ` +
      `cell ${previousCellNo} → ${next.cellNo}.`,
  };
}

/**
 * The Basic that applies to a salary month, given the increment history.
 * Used so that a month BEFORE an increment keeps the old Basic and every
 * month from the effective month onward keeps the new one.
 */
function resolveBasicForMonth(increments, targetMonthKey, fallbackBasic) {
  const effective = pickEffectiveIncrement(increments, targetMonthKey);
  if (!effective) return roundMoney(fallbackBasic);
  return roundMoney(effective.NewBasic);
}

/**
 * The employee's pay state for a salary month, after applying whatever
 * increment history is in effect for that month.
 *
 * EmployeeMaster is left untouched and stays the BASE state. The current
 * cell/level/Basic for any month is derived from the increment history, so
 * increments chain correctly year after year and an already-saved earlier
 * month is never affected by a later increment.
 */
function resolveEmployeeStateForMonth({ pay, increments, targetMonthKey }) {
  const applied = pickEffectiveIncrement(increments, targetMonthKey);

  if (!applied) {
    return {
      basic: roundMoney(pay.basicPay),
      payLevel: pay.level,
      cellNo: pay.cellNo,
      payMatrixId: pay.payMatrixId,
      appliedIncrement: null,
      appliedIncrementId: null,
    };
  }

  return {
    basic: roundMoney(applied.NewBasic),
    payLevel: applied.NewPayLevel || pay.level,
    cellNo:
      applied.NewCellNo != null ? Number(applied.NewCellNo) : pay.cellNo,
    payMatrixId:
      applied.PayMatrixId != null ? Number(applied.PayMatrixId) : pay.payMatrixId,
    appliedIncrement: applied,
    appliedIncrementId: Number(applied.IncrementId),
  };
}

/**
 * Everything Salary Entry needs to know about increments for one employee
 * in one salary month. Read-only: decides, never writes.
 *
 * Returns the Basic that Salary Entry must calculate from, which is:
 *   - the increment already in effect, plus
 *   - a newly due increment for THIS month, if one is due and unrecorded.
 */
async function resolveSalaryMonthIncrement({
  employee,
  pay,
  year,
  monthNumber,
}) {
  const targetMonthKey = monthKey(year, monthNumber);
  const increments = await listIncrements(employee.EmployeeId);

  const state = resolveEmployeeStateForMonth({
    pay,
    increments,
    targetMonthKey,
  });

  /* Already carrying an increment recorded for exactly this month. */
  if (
    state.appliedIncrement &&
    String(state.appliedIncrement.EffectiveMonth) === targetMonthKey
  ) {
    return {
      basic: state.basic,
      payLevel: state.payLevel,
      cellNo: state.cellNo,
      incrementApplied: true,
      incrementDueNow: false,
      pendingIncrement: null,
      appliedIncrementId: state.appliedIncrementId,
      message:
        `Increment already recorded for ${monthLabel(year, monthNumber)}: ` +
        `Basic ${state.appliedIncrement.PreviousBasic} → ${state.appliedIncrement.NewBasic}.`,
    };
  }

  /* Is a NEW increment due this month? Decided from the state in force
     for this month, so the chain continues from the right Basic. */
  const resolved = await resolveIncrementForMonth({
    employee: {
      ...employee,
      PayLevel: state.payLevel,
      PayMatrixCellNo: state.cellNo,
      PayRevisionId: employee.PayRevisionId ?? pay.payRevisionId,
    },
    currentBasic: state.basic,
    year,
    monthNumber,
  });

  if (!resolved.due || resolved.incrementAmount <= 0) {
    return {
      basic: state.basic,
      payLevel: state.payLevel,
      cellNo: state.cellNo,
      incrementApplied: Boolean(state.appliedIncrement),
      incrementDueNow: false,
      pendingIncrement: null,
      appliedIncrementId: state.appliedIncrementId,
      message: resolved.reason,
    };
  }

  return {
    basic: resolved.newBasic,
    payLevel: resolved.newPayLevel || state.payLevel,
    cellNo: resolved.newCellNo != null ? resolved.newCellNo : state.cellNo,
    incrementApplied: true,
    incrementDueNow: true,
    pendingIncrement: {
      ...resolved,
      effectiveMonth: targetMonthKey,
      effectiveDate: firstOfMonth(year, monthNumber),
      payRevisionId: employee.PayRevisionId ?? pay.payRevisionId,
    },
    appliedIncrementId: null,
    message:
      `Increment applied for ${monthLabel(year, monthNumber)}: ` +
      `Basic ${resolved.previousBasic} → ${resolved.newBasic} ` +
      `(+${resolved.incrementAmount}).`,
  };
}

/** Persist an increment. Append-only: never updates a historical row. */
async function recordIncrement(transaction, payload) {
  const request = transaction
    ? new sql.Request(transaction)
    : new sql.Request();

  const result = await request.query`
    INSERT INTO dbo.EmployeeIncrement
      (
        EmployeeId, IncrementDate,
        PreviousBasic, IncrementAmount, NewBasic,
        PreviousPayLevel, NewPayLevel, PreviousCellNo, NewCellNo,
        PayRevisionId, PayMatrixId,
        EffectiveMonth, EffectiveDate,
        Status, Remarks,
        SalaryBillCodeId, InstituteCode, AppliedAutomatically,
        CreatedBy
      )
    OUTPUT INSERTED.IncrementId
    VALUES
      (
        ${Number(payload.employeeId)},
        ${payload.incrementDate},
        ${roundMoney(payload.previousBasic)},
        ${roundMoney(payload.incrementAmount)},
        ${roundMoney(payload.newBasic)},
        ${payload.previousPayLevel || null},
        ${payload.newPayLevel || null},
        ${payload.previousCellNo != null ? Number(payload.previousCellNo) : null},
        ${payload.newCellNo != null ? Number(payload.newCellNo) : null},
        ${payload.payRevisionId != null ? Number(payload.payRevisionId) : null},
        ${payload.payMatrixId != null ? Number(payload.payMatrixId) : null},
        ${payload.effectiveMonth},
        ${payload.effectiveDate},
        ${payload.status || "Active"},
        ${payload.remarks || null},
        ${payload.salaryBillCodeId != null ? Number(payload.salaryBillCodeId) : null},
        ${payload.instituteCode || null},
        ${payload.appliedAutomatically ? 1 : 0},
        ${payload.createdBy || "SYSTEM"}
      )
  `;

  return Number(result.recordset[0]?.IncrementId) || null;
}

module.exports = {
  MONTH_SHORT,
  MONTH_NAME,
  toNum,
  roundMoney,
  pad2,
  monthKey,
  monthLabel,
  monthName,
  firstOfMonth,
  buildMonthRange,
  isIncrementDueInMonth,
  isIncrementEffectiveFor,
  pickEffectiveIncrement,
  resolveBasicForMonth,
  resolveIncrementForMonth,
  resolveEmployeeStateForMonth,
  resolveSalaryMonthIncrement,
  listIncrements,
  getIncrementById,
  findIncrementForMonth,
  findNextMatrixCell,
  findMatrixCellByBasic,
  recordIncrement,
};
