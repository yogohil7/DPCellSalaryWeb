const express = require("express");
const { sql } = require("../db");
const { withTransaction } = require("./salaryEmployeeDetails");
const {
  calculateForEmployee,
  mapCalcToGridRow,
  toNum,
} = require("./salaryCalculate");
const { loadActivePayrollConfig, isHraForcedZero } = require("../utils/payrollConfig");
const { calculateSalaryAmounts, calculateNps, calculateChequeAmount } = require("../utils/salaryBasicCalc");
const {
  getInstituteWorkflow,
  upsertInstituteWorkflow,
  assertInstituteEditable,
} = require("../utils/salaryBillInstituteWorkflow");
const {
  resolveSalaryMonthIncrement,
  recordIncrement,
  pad2,
} = require("../utils/employeeIncrement");
const { loadEmployee, resolveBasicPay } = require("./salaryCalculate");
const { resolveSalaryEntryBill } = require("../utils/resolveSalaryEntryBill");


const router = express.Router();

function actorFromBody(body = {}) {
  return {
    userName: body.userName || body.actorUserName || "SYSTEM",
    fullName:
      body.fullName ||
      body.actorFullName ||
      body.userName ||
      body.actorUserName ||
      "SYSTEM",
    userId:
      body.userId != null
        ? Number(body.userId)
        : body.actorUserId != null
          ? Number(body.actorUserId)
          : null,
  };
}

function makeRequest(transaction) {
  return transaction ? new sql.Request(transaction) : new sql.Request();
}

const MONTH_MAP = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function asOfFromBill(bill) {
  const monthText = String(bill.SalaryMonth || bill.BillCode || "")
    .trim()
    .toUpperCase();
  const year = String(bill.SalaryYear || "").trim();
  const match = monthText.match(/^([A-Z]{3})[-/]?(\d{2,4})?$/);
  if (match) {
    const m = MONTH_MAP[match[1]];
    let y = match[2] || year;
    if (y && y.length === 2) y = `20${y}`;
    if (m && y) {
      const lastDay = new Date(Number(y), m, 0).getDate();
      return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }
  if (year && bill.SalaryMonthNumber) {
    const m = Number(bill.SalaryMonthNumber);
    if (m >= 1 && m <= 12) {
      const lastDay = new Date(Number(year), m, 0).getDate();
      return `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

async function getBillByCode(billCode) {
  const code = String(billCode || "").trim();
  const result = await sql.query`
    SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${code}
  `;
  return result.recordset[0] || null;
}

async function getInstitute(instituteId, instituteCode) {
  if (instituteId) {
    const byId = await sql.query`
      SELECT TOP 1 * FROM dbo.Institutes WHERE InstituteId = ${Number(instituteId)}
    `;
    if (byId.recordset[0]) return byId.recordset[0];
  }
  if (instituteCode) {
    const byCode = await sql.query`
      SELECT TOP 1 * FROM dbo.Institutes WHERE InstituteCode = ${String(instituteCode).trim()}
    `;
    if (byCode.recordset[0]) return byCode.recordset[0];
  }
  return null;
}

/**
 * Reject a section/institute pair that does not match the real
 * dbo.Institutes.SectionId relationship, e.g. section=OGE with BD-01.
 *
 * The frontend filters the dropdown, but the API must not trust that.
 * Returns null when the pair is fine or when no section was supplied.
 */
/**
 * True when the operator typed the TA themselves instead of accepting the
 * master-derived amount. Mirrors the NPSManual flag exactly, including the
 * accepted shapes (true / 1 / "1"), because both flags travel the same
 * Salary Entry payload.
 *
 * A Basic-Pay-driven recalculation clears it: TA follows the new Basic in
 * that case, which is the rule the master derivation exists to enforce.
 */
function isManualTa(input) {
  const flagged =
    input?.taManual === true ||
    input?.taManual === 1 ||
    input?.taManual === "1" ||
    input?.TAManual === true ||
    input?.TAManual === 1;
  if (!flagged) return false;
  const basicDriven =
    input?.recalcFromBasic === true || input?.basicDriven === true;
  return !basicDriven;
}

function assertInstituteInSection(institute, requestedSectionId) {
  if (requestedSectionId == null || requestedSectionId === "") return null;

  const requested = Number(requestedSectionId);
  if (!Number.isFinite(requested) || requested <= 0) return null;

  const actual =
    institute?.SectionId != null ? Number(institute.SectionId) : null;

  if (actual === requested) return null;

  return {
    status: 400,
    message:
      `Institute ${institute?.InstituteCode || "?"} does not belong to the ` +
      `selected Institute Section.`,
  };
}

const EDITABLE_BILL_STATUSES = new Set([
  "OPEN",
  "DRAFT",
  "RETURNED",
]);

/*
 * Salary Entry may only ever act on a bill whose master Status is OPEN.
 * RETURNED / REJECTED are tolerated because the Returning Bills screen reuses
 * the Salary Entry screen for the correct-and-resubmit flow; every other
 * status (DRAFT/SUBMITTED/RESUBMITTED/VERIFIED/APPROVED/LOCKED/COMPLETED) is
 * rejected outright so the API cannot be driven by hand.
 */
const SALARY_ENTRY_OPEN_STATUS = "OPEN";
const SALARY_ENTRY_CORRECTION_STATUSES = new Set(["RETURNED", "REJECTED"]);

function assertBillOpenForSalaryEntry(bill) {
  if (!bill) return { status: 404, message: "Bill Code not found." };
  const status = String(bill.Status || "").trim().toUpperCase();
  if (status === SALARY_ENTRY_OPEN_STATUS) return null;
  if (SALARY_ENTRY_CORRECTION_STATUSES.has(status)) return null;
  return {
    status: 409,
    message: `Bill Code ${bill.BillCode} is ${status || "UNKNOWN"}. Only OPEN bill codes can be used in Salary Entry.`,
  };
}

function assertBillEditable(bill) {
  const notOpen = assertBillOpenForSalaryEntry(bill);
  if (notOpen) return notOpen;
  const status = String(bill.Status || "").toUpperCase();
  if (status === "LOCKED" || status === "APPROVED") {
    return {
      status: 403,
      message: `Bill Code ${bill.BillCode} is locked/approved and cannot be modified.`,
    };
  }
  if (status === "COMPLETED") {
    return {
      status: 403,
      message: `Bill Code ${bill.BillCode} is completed and cannot be modified.`,
    };
  }
  /* Institute workflow is the authoritative gate for SUBMITTED/etc. */
  if (!EDITABLE_BILL_STATUSES.has(status) && status !== "SUBMITTED" && status !== "RESUBMITTED" && status !== "VERIFIED" && status !== "REJECTED") {
    return {
      status: 403,
      message: `Bill Code ${bill.BillCode} status ${status} does not allow modification.`,
    };
  }
  return null;
}

/**
 * The bill whose status governs an operation.
 *
 * When Bill Month differs from Salary Month, resolveSalaryEntryBill returns
 * TWO rows: the exact Bill-Month variant (e.g. JUN-2026-BM-MAY) as `bill`,
 * and the salary-month master (JUN-2026) as `sourceBill`.
 *
 * These are independent salary bills. Gating on `sourceBill` meant a LOCKED
 * JUN-2026 master blocked an editable RETURNED JUN-2026-BM-MAY variant, which
 * is what produced the "locked / cannot be modified" failures for auditors
 * correcting returned bills.
 *
 * The exact resolved bill therefore governs; the master is only consulted
 * when the resolver returned the same row for both.
 */
function statusGateBill(resolved) {
  const bill = resolved?.bill;
  const sourceBill = resolved?.sourceBill || bill;
  if (!bill) return sourceBill;
  return String(bill.BillCode) !== String(sourceBill.BillCode) ? bill : sourceBill;
}

/**
 * Trace how a Salary Entry request resolved to a concrete bill.
 * Logged only for Bill-Month variants (the returned-bill path), so normal
 * salary traffic is not made noisy.
 */
function logBillResolution(context, { requested, resolved, institute, user }) {
  const bill = resolved?.bill;
  const sourceBill = resolved?.sourceBill || bill;
  if (!bill) return;
  const isVariant = String(bill.BillCode) !== String(sourceBill?.BillCode);
  if (!isVariant) return;

  console.log(
    `[salary-entry:${context}] requested ` +
      `billCode=${requested?.billCode || "-"} ` +
      `billMonth=${requested?.billMonth || "-"} ` +
      `salaryMonth=${requested?.salaryMonth || "-"} ` +
      `institute=${institute || requested?.instituteCode || "-"} ` +
      `user=${user?.userName || "-"} role=${user?.roleName || "-"} ` +
      `-> resolved billCodeId=${bill.BillCodeId} billCode=${bill.BillCode} ` +
      `billMonth=${bill.BillMonth} salaryMonth=${bill.SalaryMonth} ` +
      `status=${bill.Status} (master ${sourceBill?.BillCode}=${sourceBill?.Status})`
  );
}

function nonNeg(value, fieldName, errors, employeeId) {
  const n = toNum(value);
  if (n < 0) {
    errors.push({
      employeeId,
      message: `${fieldName} cannot be negative.`,
    });
  }
  return n;
}

/** Recalculate totals from component amounts (bill snapshot). */
function finalizeSnapshotAmounts(input, { pension, hraForcedZero }) {
  const employeeId = Number(input.employeeId);
  const errors = [];

  const basicPay = nonNeg(input.basicPay, "Basic Pay", errors, employeeId);
  const fixBasic = nonNeg(
    input.fixBasic ?? input.gradePay,
    "FIX Basic",
    errors,
    employeeId
  );
  const gradePay = fixBasic;
  let da = nonNeg(input.da, "DA", errors, employeeId);
  let hra = nonNeg(input.hra, "HRA", errors, employeeId);
  const ma = nonNeg(input.ma, "MA", errors, employeeId);
  const ta = nonNeg(input.ta, "TA", errors, employeeId);
  const cla = nonNeg(input.cla, "CLA", errors, employeeId);
  const specialAllowance = nonNeg(
    input.specialAllowance,
    "Special Allowance",
    errors,
    employeeId
  );
  const washingAllowance = nonNeg(
    input.washingAllowance,
    "Washing Allowance",
    errors,
    employeeId
  );
  const otherEarnings = nonNeg(
    input.otherEarnings,
    "Other Earnings",
    errors,
    employeeId
  );
  const nppa = nonNeg(input.nppa, "NPPA", errors, employeeId);

  let gpfSubscription = nonNeg(
    input.gpfSubscription,
    "GPF Subscription",
    errors,
    employeeId
  );
  let gpfAdvance = nonNeg(
    input.gpfAdvance ?? input.gpfAdv,
    "GPF Advance",
    errors,
    employeeId
  );
  /*
     GPF Advance is entered in Salary Entry and stored in
     dbo.SalaryEmployeeDetails.GPFAdvance. It was previously forced to 0 here
     because the column was hidden from the grid; the posted value is now kept.
     An NPS employee still has it zeroed further down, with GPF Subscription,
     because an NPS member has no GPF at all.
  */
  let nps = nonNeg(input.nps, "NPS", errors, employeeId);
  /* NPS Adv removed from Salary Entry — persist 0, never include in totals. */
  const npsAdvance = 0;
  const incomeTax = nonNeg(input.incomeTax, "Income Tax", errors, employeeId);
  const professionalTax = nonNeg(
    input.professionalTax ?? input.professionTax,
    "Professional Tax",
    errors,
    employeeId
  );
  const otherDeduction = nonNeg(
    input.otherDeduction,
    "Other Deduction",
    errors,
    employeeId
  );

  /* FIX employees cannot have Basic Pay */
  const empType = String(input.employeeType || "")
    .trim()
    .toUpperCase();
  let basicFinal = basicPay;
  if (empType === "FIX" || empType === "FIXED") {
    basicFinal = 0;
  }

  const daRate = Number(input.daRate ?? input.daPercentage);
  const hraRate = Number(input.hraRate ?? input.hraPercentage);
  const hasDaRate = Number.isFinite(daRate);
  const hasHraRate = Number.isFinite(hraRate);

  /*
    When rates are present and client requests basic-driven recalc
    (or did not mark DA/HRA as manual), recompute from Total Basic Pay.
  */
  const derived = calculateSalaryAmounts({
    basic: basicFinal,
    fixBasic,
    daPercentage: hasDaRate ? daRate : 0,
    hraPercentage: hasHraRate ? hraRate : 0,
    payrollHra: hraForcedZero,
  });

  const totalBasic = derived.totalBasicPay;

  if (input.recalcFromBasic === true || input.basicDriven === true) {
    if (hasDaRate) da = derived.da;
    if (hraForcedZero) {
      hra = 0;
    } else if (hasHraRate) {
      hra = derived.hra;
    }
  } else if (hraForcedZero) {
    hra = 0;
  }

  const pensionType = pension === "GPF" || pension === "NPS" ? pension : "";
  const npsManual = Boolean(
    input.npsManual === true ||
      input.npsManual === 1 ||
      input.npsManual === "1" ||
      input.NPSManual === true ||
      input.NPSManual === 1
  );
  const forceAutoNps =
    input.recalcFromBasic === true || input.basicDriven === true;
  /* Snapshot reload must keep the stored NPS; manual override must also stick. */
  const preserveSavedNps =
    input.fromSnapshot === true || npsManual;

  if (pensionType === "GPF") {
    nps = 0;
  } else if (pensionType === "NPS") {
    gpfSubscription = 0;
    gpfAdvance = 0;
    if (!forceAutoNps && preserveSavedNps) {
      nps = nonNeg(input.nps, "NPS", errors, employeeId);
    } else {
      nps = calculateNps(totalBasic, da);
    }
  }

  /* Gross uses Basic+FIX Basic via totalBasic once — never add Total Basic again. */
  const grossSalary =
    totalBasic +
    da +
    hra +
    ma +
    ta +
    cla +
    specialAllowance +
    washingAllowance +
    otherEarnings +
    nppa;
  const totalDeduction =
    gpfSubscription +
    gpfAdvance +
    nps +
    incomeTax +
    professionalTax +
    otherDeduction;
  const netSalary = grossSalary - totalDeduction;
  const chequeAmount = calculateChequeAmount({
    netSalary,
    incomeTax,
    professionalTax,
  });

  return {
    errors,
    row: {
      ...input,
      employeeId,
      pension: pensionType,
      gpfNps: pensionType,
      pensionType,
      basicPay: basicFinal,
      fixBasic,
      gradePay,
      totalBasic,
      totalBasicPay: totalBasic,
      da,
      daRate: hasDaRate ? daRate : input.daRate ?? null,
      hra,
      hraRate: hasHraRate ? hraRate : input.hraRate ?? null,
      ma,
      ta,
      taManual: isManualTa(input),
      cla,
      specialAllowance,
      washingAllowance,
      otherEarnings,
      nppa,
      grossSalary,
      grossAmount: grossSalary,
      gpfSubscription,
      gpfAdvance,
      gpfAdv: gpfAdvance,
      nps,
      npsAdvance: 0,
      npsManual: pensionType === "NPS" ? npsManual && !forceAutoNps : false,
      incomeTax,
      professionalTax,
      professionTax: professionalTax,
      otherDeduction,
      totalDeduction,
      netSalary,
      chequeAmount,
      hraForcedZero: Boolean(hraForcedZero),
    },
  };
}

function mapSavedDetailToGridRow(dbRow) {
  const pension = String(dbRow.PensionType || "")
    .trim()
    .toUpperCase();
  const npsManual = Boolean(dbRow.NPSManual);
  const finalized = finalizeSnapshotAmounts(
    {
      employeeId: dbRow.EmployeeId,
      employeeName: dbRow.EmployeeName,
      designation: dbRow.Designation,
      employeeType: dbRow.EmployeeType,
      basicPay: dbRow.BasicPay,
      fixBasic: dbRow.GradePay,
      gradePay: dbRow.GradePay,
      da: dbRow.DA,
      hra: dbRow.HRA,
      ma: dbRow.MA,
      ta: dbRow.TA,
      taManual: Boolean(dbRow.TAManual),
      cla: dbRow.CLA,
      specialAllowance: dbRow.SpecialAllowance,
      washingAllowance: dbRow.WashingAllowance,
      otherEarnings: dbRow.OtherEarnings,
      nppa: dbRow.NPPA,
      gpfSubscription: dbRow.GPFSubscription,
      gpfAdvance: dbRow.GPFAdvance,
      nps: dbRow.NPS,
      npsAdvance: 0,
      npsManual,
      fromSnapshot: true,
      incomeTax: dbRow.IncomeTax,
      professionalTax: dbRow.ProfessionalTax,
      professionTax: dbRow.ProfessionalTax,
      otherDeduction: dbRow.OtherDeduction,
      daRate: dbRow.DAPercentage,
      hraRate: dbRow.HRAPercentage,
    },
    {
      pension: pension === "GPF" || pension === "NPS" ? pension : "",
      hraForcedZero: Boolean(dbRow.HraForcedZero),
    }
  ).row;

  return {
    ...finalized,
    id: Number(dbRow.Id),
    salaryEmployeeDetailId: Number(dbRow.Id),
    fromSnapshot: true,
    instituteCode: dbRow.InstituteCode || "",
    displayOrder: Number(dbRow.DisplayOrder) || 1,
    payRevisionId:
      dbRow.PayRevisionId != null ? Number(dbRow.PayRevisionId) : null,
    payLevel: dbRow.PayLevel != null ? String(dbRow.PayLevel) : null,
    cellNo:
      dbRow.PayMatrixCellNo != null ? Number(dbRow.PayMatrixCellNo) : null,
    payMatrixCellNo:
      dbRow.PayMatrixCellNo != null ? Number(dbRow.PayMatrixCellNo) : null,
    payMatrixId: dbRow.PayMatrixId != null ? Number(dbRow.PayMatrixId) : null,
    daMasterId: dbRow.DAMasterId != null ? Number(dbRow.DAMasterId) : null,
    hraMasterId: dbRow.HRAMasterId != null ? Number(dbRow.HRAMasterId) : null,
    claMasterId: dbRow.CLAMasterId != null ? Number(dbRow.CLAMasterId) : null,
    payrollConfigId:
      dbRow.PayrollConfigId != null ? Number(dbRow.PayrollConfigId) : null,
    cityClass: dbRow.CityClass || "",
    asOfDate: dbRow.AsOfDate || null,
    daRate:
      dbRow.DAPercentage != null
        ? Number(dbRow.DAPercentage)
        : finalized.daRate ?? null,
    hraRate:
      dbRow.HRAPercentage != null
        ? Number(dbRow.HRAPercentage)
        : finalized.hraRate ?? null,
    warnings: [],
  };
}

async function loadSavedRows(billCodeId, instituteCode) {
  const result = instituteCode
    ? await sql.query`
        SELECT *
        FROM dbo.SalaryEmployeeDetails
        WHERE SalaryBillCodeId = ${billCodeId}
          AND (InstituteCode = ${instituteCode} OR InstituteCode IS NULL OR InstituteCode = N'')
      `
    : await sql.query`
        SELECT *
        FROM dbo.SalaryEmployeeDetails
        WHERE SalaryBillCodeId = ${billCodeId}
      `;
  const map = new Map();
  for (const row of result.recordset) {
    map.set(Number(row.EmployeeId), row);
  }
  return map;
}

async function loadEmployeePension(employeeId) {
  const result = await sql.query`
    SELECT TOP 1 GPFNPS FROM dbo.EmployeeMaster WHERE EmployeeId = ${employeeId}
  `;
  const raw = String(result.recordset[0]?.GPFNPS || "")
    .trim()
    .toUpperCase();
  return raw === "GPF" || raw === "NPS" ? raw : "";
}

/* Salary year + zero-padded month number for the bill being entered. */
function billPeriod(bill) {
  const year = String(bill.SalaryYear || "").trim();
  const monthNumber = pad2(Number(bill.SalaryMonthNumber || 0));
  const valid = /^\d{4}$/.test(year) && /^(0[1-9]|1[0-2])$/.test(monthNumber);
  return { year, monthNumber, valid };
}

/**
 * Increment decision for one employee in this bill's salary month.
 * Read-only. Returns null when the bill has no usable period or the
 * employee's pay cannot be resolved (the caller then behaves as before).
 */
async function resolveIncrementForBill(bill, employeeId) {
  const period = billPeriod(bill);
  if (!period.valid) return null;

  try {
    const employee = await loadEmployee(Number(employeeId));
    if (!employee) return null;

    const pay = await resolveBasicPay(employee);
    /* FIX-type employees have no matrix Basic, so no annual increment. */
    if (String(pay.employeeType || "").toUpperCase() === "FIX") return null;

    return await resolveSalaryMonthIncrement({
      employee,
      pay,
      year: period.year,
      monthNumber: period.monthNumber,
    });
  } catch (err) {
    console.warn(
      `Increment resolution skipped for employee ${employeeId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Persist an increment the first time a salary bill actually applies it.
 *
 * Called only from Save Draft / Submit, never from Get Data, so reading the
 * grid never writes history. The filtered unique index on
 * (EmployeeId, EffectiveMonth) makes a concurrent double-save harmless.
 */
async function ensureIncrementRecorded(
  transaction,
  bill,
  institute,
  employeeId,
  actor
) {
  try {
    const increment = await resolveIncrementForBill(bill, employeeId);
    if (!increment) return null;

    /* Already recorded (this month or an earlier one still in force):
       nothing to write, but report the id so the salary snapshot can
       reference the increment it was calculated from. */
    if (!increment.incrementDueNow || !increment.pendingIncrement) {
      return increment.appliedIncrementId || null;
    }

    const pending = increment.pendingIncrement;
    return await recordIncrement(transaction, {
      employeeId: Number(employeeId),
      incrementDate: pending.effectiveDate,
      previousBasic: pending.previousBasic,
      incrementAmount: pending.incrementAmount,
      newBasic: pending.newBasic,
      previousPayLevel: pending.previousPayLevel,
      newPayLevel: pending.newPayLevel,
      previousCellNo: pending.previousCellNo,
      newCellNo: pending.newCellNo,
      payRevisionId: pending.payRevisionId,
      payMatrixId: pending.payMatrixId,
      effectiveMonth: pending.effectiveMonth,
      effectiveDate: pending.effectiveDate,
      status: "Active",
      remarks: pending.reason,
      salaryBillCodeId: Number(bill.BillCodeId),
      instituteCode: institute.InstituteCode,
      appliedAutomatically: true,
      createdBy: actor.fullName || actor.userName,
    });
  } catch (err) {
    /* A duplicate simply means another save already recorded it. */
    if (/UQ_EmpInc_Employee_Month_Active|duplicate key/i.test(String(err.message))) {
      return null;
    }
    console.warn(
      `Increment not recorded for employee ${employeeId}:`,
      err.message
    );
    return null;
  }
}

async function buildEmployeeRows({ bill, institute, asOfDate }) {
  const empResult = await sql.query`
    SELECT e.EmployeeId, e.EmployeeName, e.EmployeeCode
    FROM dbo.EmployeeMaster e
    WHERE e.InstituteId = ${institute.InstituteId}
      AND UPPER(ISNULL(e.Status, N'Active')) = N'ACTIVE'
      AND ISNULL(e.IsActive, 1) = 1
    ORDER BY e.EmployeeName, e.EmployeeId
  `;

  const saved = await loadSavedRows(bill.BillCodeId, institute.InstituteCode);
  const rows = [];
  const errors = [];
  const warnings = [];
  let order = 1;

  for (const item of empResult.recordset) {
    const employeeId = Number(item.EmployeeId);
    const existing = saved.get(employeeId);

    /* Prefer saved bill snapshot — do not recalculate from today's masters.
       Still re-apply Payroll Config HRA force-zero as-of the bill month so a
       wrong/legacy HraForcedZero flag cannot keep calculating HRA. */
    if (existing) {
      const payrollConfig = await loadActivePayrollConfig(employeeId, asOfDate);
      const hraForcedZero = isHraForcedZero(payrollConfig);
      const row = mapSavedDetailToGridRow({
        ...existing,
        HraForcedZero: hraForcedZero ? 1 : 0,
        HRA: hraForcedZero ? 0 : existing.HRA,
      });
      row.displayOrder = existing.DisplayOrder || order;
      rows.push(row);
      order += 1;
      continue;
    }

    try {
      /* Increment is applied BEFORE the salary is calculated, so DA, HRA,
         MA, TA, CLA, NPS, Gross and Net all derive from the new Basic. */
      const increment = await resolveIncrementForBill(bill, employeeId);

      const calc = await calculateForEmployee(
        employeeId,
        asOfDate,
        increment && increment.incrementApplied ? increment.basic : null
      );
      const row = mapCalcToGridRow(calc, {
        displayOrder: order,
        salaryEmployeeDetailId: null,
      });

      if (increment && increment.incrementApplied) {
        row.incrementApplied = true;
        row.incrementDueNow = Boolean(increment.incrementDueNow);
        row.incrementMessage = increment.message;
        row.incrementId = increment.appliedIncrementId;
        if (increment.incrementDueNow) {
          warnings.push(`Employee ${employeeId}: ${increment.message}`);
        }
      }

      rows.push(row);
      for (const w of row.warnings || []) {
        warnings.push(`Employee ${employeeId}: ${w}`);
      }
    } catch (err) {
      console.error(
        `Salary calc failed for employee ${employeeId}:`,
        err.message
      );
      errors.push({
        employeeId,
        employeeName: item.EmployeeName || "",
        employeeCode: item.EmployeeCode || "",
        message: err.message || "Unable to calculate salary.",
      });
    }
    order += 1;
  }

  return { rows, errors, warnings };
}

/**
 * dbo.SalaryEmployeeDetails.TAManual arrives with migration 46. Until that
 * migration is applied the column is simply absent, so it is probed once and
 * the write is skipped rather than failing the whole save with
 * "Invalid column name 'TAManual'".
 */
let taManualColumnPresent = null;
async function hasTaManualColumn() {
  if (taManualColumnPresent != null) return taManualColumnPresent;
  try {
    const res = await sql.query`
      SELECT COL_LENGTH(N'dbo.SalaryEmployeeDetails', N'TAManual') AS Len
    `;
    taManualColumnPresent = res.recordset[0]?.Len != null;
  } catch (error) {
    taManualColumnPresent = false;
  }
  if (!taManualColumnPresent) {
    console.warn(
      "[salary-entry] dbo.SalaryEmployeeDetails.TAManual is missing - " +
        "run: npm run migrate:ta-manual. A manually entered TA still saves, " +
        "but the manual flag will not survive a reload."
    );
  }
  return taManualColumnPresent;
}

async function upsertEmployeeSalary(
  transaction,
  bill,
  institute,
  row,
  actor,
  asOfDate
) {
  const employeeId = Number(row.employeeId);
  const pension = await loadEmployeePension(employeeId);
  const payrollConfig = await loadActivePayrollConfig(employeeId, asOfDate);
  const hraForcedZero = isHraForcedZero(payrollConfig);

  /*
     TA is master-derived from the current edited Basic Pay, so a Basic Pay
     edit can never leave a stale TA behind.

     An explicitly entered TA is the one exception. It is the operator's
     decision and must reach the database exactly as typed — the same way a
     manual NPS already does — otherwise Salary Bill Approval, which reads
     the stored row verbatim, would show the master amount instead of the
     entered one. Overwriting it here was what turned an entered 7,200 into
     the master 3,600 by the time the bill was approved.
  */
  const taManual = isManualTa(row);
  const taCalc = await calculateForEmployee(employeeId, asOfDate, row.basicPay);
  const finalized = finalizeSnapshotAmounts(
    {
      ...row,
      ta: taManual ? row.ta : taCalc.earnings.ta,
      taManual,
      taMasterId: taManual
        ? row.taMasterId != null
          ? row.taMasterId
          : null
        : taCalc.taMasterId,
      taPayLevelGroup: taCalc.taPayLevelGroup,
    },
    { pension, hraForcedZero }
  );
  if (finalized.errors.length) {
    const err = new Error(finalized.errors.map((e) => e.message).join(" "));
    err.status = 400;
    err.details = finalized.errors;
    throw err;
  }

  const mapped = finalized.row;

  let payRevisionId =
    row.payRevisionId != null ? Number(row.payRevisionId) : null;
  let payLevel = row.payLevel != null ? String(row.payLevel) : null;
  let payMatrixCellNo =
    row.payMatrixCellNo != null
      ? Number(row.payMatrixCellNo)
      : row.cellNo != null
        ? Number(row.cellNo)
        : null;
  let payMatrixId = row.payMatrixId != null ? Number(row.payMatrixId) : null;
  let daMasterId = row.daMasterId != null ? Number(row.daMasterId) : null;
  let hraMasterId = row.hraMasterId != null ? Number(row.hraMasterId) : null;
  let claMasterId = row.claMasterId != null ? Number(row.claMasterId) : null;
  let payrollConfigId =
    row.payrollConfigId != null
      ? Number(row.payrollConfigId)
      : payrollConfig.id != null
        ? Number(payrollConfig.id)
        : null;
  let cityClass = row.cityClass || "";
  let employeeName = mapped.employeeName || row.employeeName || "";
  let designation = mapped.designation || row.designation || "";
  let employeeType = mapped.employeeType || row.employeeType || "";
  let daRate =
    mapped.daRate != null && Number.isFinite(Number(mapped.daRate))
      ? Number(mapped.daRate)
      : null;
  let hraRate =
    mapped.hraRate != null && Number.isFinite(Number(mapped.hraRate))
      ? Number(mapped.hraRate)
      : null;

  if (
    !employeeName ||
    payRevisionId == null ||
    daMasterId == null ||
    claMasterId == null ||
    daRate == null
  ) {
    try {
      const calc = await calculateForEmployee(employeeId, asOfDate);
      employeeName = employeeName || calc.employee.employeeName;
      designation = designation || calc.employee.designation;
      employeeType = employeeType || calc.employee.employeeType;
      if (payRevisionId == null) payRevisionId = calc.payRevision.payRevisionId;
      if (!payLevel) payLevel = calc.level;
      if (payMatrixCellNo == null) payMatrixCellNo = calc.cellNo;
      if (payMatrixId == null) payMatrixId = calc.payMatrixId;
      if (daMasterId == null) daMasterId = calc.daMasterId;
      if (hraMasterId == null && !hraForcedZero) hraMasterId = calc.hraMasterId;
      if (claMasterId == null) claMasterId = calc.claMasterId;
      if (daRate == null && calc.daRate != null) daRate = Number(calc.daRate);
      if (hraRate == null && calc.hraRate != null) hraRate = Number(calc.hraRate);
      if (!cityClass) cityClass = calc.employee.cityClassName || "";
      if (payrollConfigId == null) {
        payrollConfigId = calc.payrollConfig?.id || null;
      }
    } catch (err) {
      if (!employeeName) {
        throw err;
      }
    }
  }

  mapped.daRate = daRate;
  mapped.hraRate = hraRate;

  const displayOrder = Number(row.displayOrder) || 1;
  const existingReq = makeRequest(transaction);
  const existing = await existingReq.query`
    SELECT TOP 1 Id
    FROM dbo.SalaryEmployeeDetails
    WHERE SalaryBillCodeId = ${bill.BillCodeId}
      AND EmployeeId = ${employeeId}
      AND InstituteCode = ${institute.InstituteCode}
  `;

  let detailId = existing.recordset[0]?.Id
    ? Number(existing.recordset[0].Id)
    : null;

  if (detailId) {
    const upd = makeRequest(transaction);
    await upd.query`
      UPDATE dbo.SalaryEmployeeDetails
      SET
        EmployeeName = ${employeeName},
        Designation = ${designation},
        EmployeeType = ${employeeType},
        PensionType = ${mapped.pension || null},
        DisplayOrder = ${displayOrder},
        BasicPay = ${mapped.basicPay},
        GradePay = ${mapped.gradePay},
        TotalBasic = ${mapped.totalBasic},
        DA = ${mapped.da},
        HRA = ${mapped.hra},
        MA = ${mapped.ma},
        TA = ${mapped.ta},
        CLA = ${mapped.cla},
        SpecialAllowance = ${mapped.specialAllowance},
        WashingAllowance = ${mapped.washingAllowance},
        OtherEarnings = ${mapped.otherEarnings},
        NPPA = ${mapped.nppa},
        GrossSalary = ${mapped.grossSalary},
        GPFSubscription = ${mapped.gpfSubscription},
        GPFAdvance = ${mapped.gpfAdvance},
        NPS = ${mapped.nps},
        NPSAdvance = 0,
        NPSManual = ${mapped.npsManual ? 1 : 0},
        IncomeTax = ${mapped.incomeTax},
        ProfessionalTax = ${mapped.professionalTax},
        OtherDeduction = ${mapped.otherDeduction},
        TotalDeduction = ${mapped.totalDeduction},
        NetSalary = ${mapped.netSalary},
        ChequeAmount = ${mapped.chequeAmount},
        InstituteCode = ${institute.InstituteCode},
        PayRevisionId = ${payRevisionId},
        PayLevel = ${payLevel},
        PayMatrixCellNo = ${payMatrixCellNo},
        PayMatrixId = ${payMatrixId},
        DAMasterId = ${daMasterId},
        HRAMasterId = ${hraMasterId},
        CLAMasterId = ${claMasterId},
        PayrollConfigId = ${payrollConfigId},
        CityClass = ${cityClass || null},
        AsOfDate = ${asOfDate},
        HraForcedZero = ${hraForcedZero ? 1 : 0},
        DAPercentage = ${
          mapped.daRate != null && Number.isFinite(Number(mapped.daRate))
            ? Number(mapped.daRate)
            : null
        },
        HRAPercentage = ${
          mapped.hraRate != null && Number.isFinite(Number(mapped.hraRate))
            ? Number(mapped.hraRate)
            : null
        },
        UpdatedDate = SYSUTCDATETIME()
      WHERE Id = ${detailId}
    `;
  } else {
    const ins = makeRequest(transaction);
    const inserted = await ins.query`
      INSERT INTO dbo.SalaryEmployeeDetails
        (
          SalaryBillCodeId, EmployeeId, EmployeeName, Designation, EmployeeType, PensionType, DisplayOrder,
          BasicPay, GradePay, TotalBasic, DA, HRA, MA, TA, CLA, SpecialAllowance, WashingAllowance,
          OtherEarnings, NPPA, GrossSalary,
          GPFSubscription, GPFAdvance, NPS, NPSAdvance, IncomeTax, ProfessionalTax, OtherDeduction,
          TotalDeduction, NetSalary, ChequeAmount,
          InstituteCode, PayRevisionId, PayLevel, PayMatrixCellNo, PayMatrixId,
          DAMasterId, HRAMasterId, CLAMasterId, PayrollConfigId, CityClass, AsOfDate, HraForcedZero,
          DAPercentage, HRAPercentage, NPSManual
        )
      OUTPUT INSERTED.Id
      VALUES
        (
          ${bill.BillCodeId},
          ${employeeId},
          ${employeeName},
          ${designation},
          ${employeeType},
          ${mapped.pension || null},
          ${displayOrder},
          ${mapped.basicPay},
          ${mapped.gradePay},
          ${mapped.totalBasic},
          ${mapped.da},
          ${mapped.hra},
          ${mapped.ma},
          ${mapped.ta},
          ${mapped.cla},
          ${mapped.specialAllowance},
          ${mapped.washingAllowance},
          ${mapped.otherEarnings},
          ${mapped.nppa},
          ${mapped.grossSalary},
          ${mapped.gpfSubscription},
          ${mapped.gpfAdvance},
          ${mapped.nps},
          0,
          ${mapped.incomeTax},
          ${mapped.professionalTax},
          ${mapped.otherDeduction},
          ${mapped.totalDeduction},
          ${mapped.netSalary},
          ${mapped.chequeAmount},
          ${institute.InstituteCode},
          ${payRevisionId},
          ${payLevel},
          ${payMatrixCellNo},
          ${payMatrixId},
          ${daMasterId},
          ${hraMasterId},
          ${claMasterId},
          ${payrollConfigId},
          ${cityClass || null},
          ${asOfDate},
          ${hraForcedZero ? 1 : 0},
          ${
            mapped.daRate != null && Number.isFinite(Number(mapped.daRate))
              ? Number(mapped.daRate)
              : null
          },
          ${
            mapped.hraRate != null && Number.isFinite(Number(mapped.hraRate))
              ? Number(mapped.hraRate)
              : null
          },
          ${mapped.npsManual ? 1 : 0}
        )
    `;
    detailId = Number(inserted.recordset[0].Id);
  }

  /*
     Stored separately from the INSERT/UPDATE above so that a database which
     has not yet taken migration 46 keeps working unchanged. The flag is what
     lets a reopened or returned bill be saved again without the manual TA
     falling back to the master amount.
  */
  if (await hasTaManualColumn()) {
    const taFlag = makeRequest(transaction);
    await taFlag.query`
      UPDATE dbo.SalaryEmployeeDetails
      SET TAManual = ${mapped.taManual ? 1 : 0}
      WHERE Id = ${detailId}
    `;
  }

  try {
    const delComp = makeRequest(transaction);
    await delComp.query`
      DELETE FROM dbo.SalaryEmployeeComponentDetails
      WHERE SalaryEmployeeDetailId = ${detailId}
    `;

    const comps = await sql.query`
      SELECT SalaryComponentId, ComponentCode
      FROM dbo.SalaryComponentMaster
      WHERE IsActive = 1
    `;
    const amountMap = {
      BASIC: mapped.basicPay,
      DA: mapped.da,
      HRA: mapped.hra,
      MEDICAL: mapped.ma,
      TRANSPORT: mapped.ta,
      CLA: mapped.cla,
      SPECIAL: mapped.specialAllowance,
      WASHING: mapped.washingAllowance,
      WASHING_ALLOWANCE: mapped.washingAllowance,
      OTHER_EARNING: mapped.otherEarnings,
      NPPA: mapped.nppa,
      PF: mapped.gpfSubscription,
      GPF: mapped.gpfSubscription,
      NPS: mapped.nps,
      INCOME_TAX: mapped.incomeTax,
      PROFESSIONAL_TAX: mapped.professionalTax,
      OTHER_DEDUCTION: mapped.otherDeduction,
    };
    for (const c of comps.recordset) {
      const code = String(c.ComponentCode || "").toUpperCase();
      if (!(code in amountMap)) continue;
      const amount = toNum(amountMap[code]);
      const insComp = makeRequest(transaction);
      await insComp.query`
        INSERT INTO dbo.SalaryEmployeeComponentDetails
          (SalaryEmployeeDetailId, SalaryComponentId, Amount, CalculationBase, Rate, Remarks, CreatedBy)
        VALUES
          (
            ${detailId},
            ${Number(c.SalaryComponentId)},
            ${amount},
            NULL,
            NULL,
            N'Bill snapshot',
            ${actor.fullName}
          )
      `;
    }
  } catch (err) {
    console.warn("Component snapshot sync skipped:", err.message);
  }

  return {
    ...mapped,
    employeeName,
    designation,
    employeeType,
    npsManual: Boolean(mapped.npsManual),
    professionTax: mapped.professionalTax,
    professionalTax: mapped.professionalTax,
    payRevisionId,
    payLevel,
    cellNo: payMatrixCellNo,
    payMatrixCellNo,
    payMatrixId,
    daMasterId,
    hraMasterId,
    claMasterId,
    payrollConfigId,
    cityClass,
    asOfDate,
    fromSnapshot: true,
    id: detailId,
    salaryEmployeeDetailId: detailId,
    displayOrder,
    instituteCode: institute.InstituteCode,
  };
}

/*
 * GET /api/salary-entry/bill-codes
 * Bill Code dropdown source for the Salary Entry screen.
 * Reads live from SQL Server and returns ONLY Status = 'OPEN'.
 */
router.get("/bill-codes", async (_req, res) => {
  try {
    const result = await sql.query`
      SELECT
        BillCodeId, BillCode, BillMonth, SalaryMonth, SalaryMonthNumber,
        SalaryYear, BillCategory, BillType, Description, Status
      FROM dbo.SalaryBillCodes
      WHERE UPPER(LTRIM(RTRIM(Status))) = N'OPEN'
        AND ISNULL(IsArchived, 0) = 0
        AND UPPER(LTRIM(RTRIM(BillCategory))) = N'SALARY'
      /*
        Newest salary month first, and within that month the CANONICAL bill
        before any Bill-Month variant.

        "BillCodeId DESC" alone put the most recently created row first, so
        JUN-2026-BM-MAY (created after the JUN-2026 master) became the
        default selection and Salary Entry opened on Bill Month MAY-2026.

        The canonical bill is identified by its code having no -BM-XXX
        suffix — the same marker resolveSalaryEntryBill uses. BillMonth and
        SalaryMonth cannot be compared directly here: BillMonth stores
        'JUN-2026' while SalaryMonth stores 'June'.
      */
      ORDER BY
        SalaryYear DESC,
        SalaryMonthNumber DESC,
        CASE WHEN BillCode LIKE N'%-BM-%' THEN 1 ELSE 0 END,
        BillCodeId DESC
    `;
    res.json({
      message: "OK",
      data: result.recordset.map((row) => ({
        id: Number(row.BillCodeId),
        billCodeId: Number(row.BillCodeId),
        billCode: row.BillCode,
        billMonth: row.BillMonth,
        salaryMonth: row.SalaryMonth,
        salaryMonthNumber: row.SalaryMonthNumber,
        salaryYear: row.SalaryYear,
        billCategory: row.BillCategory,
        billType: row.BillType,
        description: row.Description || "",
        status: row.Status,
      })),
    });
  } catch (error) {
    console.error("GET /api/salary-entry/bill-codes error:", error);
    res.status(500).json({
      message: "Unable to load OPEN salary bill codes.",
      error: error.message,
    });
  }
});

router.get("/employees", async (req, res) => {
  try {
    const billCode = req.query.billCode;
    const instituteId = req.query.instituteId;
    const instituteCode = req.query.instituteCode;
    const billMonth = req.query.billMonth;
    const salaryMonth = req.query.salaryMonth;

    if (!billCode) {
      return res.status(400).json({ message: "Salary Bill Code is required." });
    }
    if (!instituteId && !instituteCode) {
      return res.status(400).json({ message: "Institute is required." });
    }

    /*
       Loading Salary Entry data (a GET) must never create a new Bill Code
       row as a side effect of merely opening/viewing a bill. Auto-creating
       a "-BM-XXX" Bill-Month variant here (e.g. AUG-2026-BM-JUL) whenever
       the requested Bill Month happened to differ from the Salary Month
       was exactly that: opening AUG-2026 silently wrote a second row to
       dbo.SalaryBillCodes. The variant is still created deliberately by
       Save Draft / Submit (see createIfMissing: true below in
       saveEmployeesHandler) — that is the only place a Bill-Month variant
       should ever be written. When no variant exists yet, fall back to
       the salary-month master bill so Get Data still works read-only.
    */
    const resolved = await resolveSalaryEntryBill({
      billCode,
      billMonth,
      salaryMonth,
      createIfMissing: false,
      actor: { fullName: "SYSTEM", userName: "SYSTEM" },
    }).catch(async (err) => {
      if (err.status === 404) {
        const master = await getBillByCode(billCode);
        if (!master) throw err;
        return { bill: master, sourceBill: master, created: false, billMonthMatched: false };
      }
      throw err;
    });
    const bill = resolved.bill;
    const sourceBill = resolved.sourceBill || bill;

    logBillResolution("load", {
      requested: { billCode, billMonth, salaryMonth, instituteCode },
      resolved,
      institute: instituteCode,
      user: req.user,
    });

    /* The EXACT resolved bill governs, not the salary-month master. */
    const notOpen = assertBillOpenForSalaryEntry(statusGateBill(resolved));
    if (notOpen) {
      return res
        .status(notOpen.status)
        .json({ message: notOpen.message, allowed: false });
    }

    const institute = await getInstitute(instituteId, instituteCode);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    const sectionMismatch = assertInstituteInSection(
      institute,
      req.query?.sectionId
    );
    if (sectionMismatch) {
      return res
        .status(sectionMismatch.status)
        .json({ message: sectionMismatch.message });
    }

    const asOfDate = asOfFromBill(bill);
    const { rows, errors, warnings } = await buildEmployeeRows({
      bill,
      institute,
      asOfDate,
    });

    let entryBillNo = "";
    let entryBillDate = null;
    let entryNpsScheduleNo = "";
    let instituteStatus = "DRAFT";
    try {
      /* Keyed on the EXACT resolved bill (e.g. JUN-2026-BM-MAY), so a
         Bill-Month variant never reads the salary-month master's header. */
      const workflow = await getInstituteWorkflow(
        Number(bill.BillCodeId),
        institute.InstituteCode
      );
      if (workflow) {
        entryBillNo = workflow.BillNo != null ? String(workflow.BillNo) : "";
        entryBillDate = workflow.BillDate || null;
        entryNpsScheduleNo =
          workflow.NPSScheduleNo != null ? String(workflow.NPSScheduleNo) : "";
        instituteStatus = String(workflow.Status || "DRAFT").toUpperCase();
      }
    } catch (_) {
      /* columns may be absent before migration */
    }

    res.json({
      message: errors.length
        ? `Loaded ${rows.length} employees with ${errors.length} calculation error(s).`
        : "OK",
      bill: {
        billCodeId: Number(bill.BillCodeId),
        billCode: bill.BillCode,
        sourceBillCode: sourceBill.BillCode,
        billMonth: bill.BillMonth || resolved.canonicalBillMonth || "",
        salaryMonth: bill.SalaryMonth || resolved.canonicalSalaryMonth || "",
        salaryYear: bill.SalaryYear,
        /* Institute workflow status for Salary Entry UI (not master month status). */
        status: instituteStatus,
        /* Master Status of the resolved SalaryBillCodes row (e.g. BM-MAY). */
        resolvedMasterStatus: String(bill.Status || "").toUpperCase(),
        /* Master Status of the salary-month source code (e.g. JUN-2026). */
        masterStatus: String(sourceBill.Status || "").toUpperCase(),
        billNo: entryBillNo,
        billDate: entryBillDate,
        npsScheduleNo: entryNpsScheduleNo,
        instituteCode: institute.InstituteCode,
      },
      institute: {
        instituteId: Number(institute.InstituteId),
        instituteCode: institute.InstituteCode,
        instituteName: institute.InstituteName,
      },
      asOfDate,
      data: rows,
      errors,
      warnings,
    });
  } catch (error) {
    console.error("GET /api/salary-entry/employees error:", error);
    const message = String(error.message || "");
    const userMessage =
      /Pay Matrix not found/i.test(message) ||
      /not configured/i.test(message) ||
      /Employee not found/i.test(message)
        ? message
        : "Unable to load salary entry employees.";
    res.status(error.status || 500).json({
      message: userMessage,
      error: message,
    });
  }
});

router.post("/calculate", async (req, res) => {
  try {
    const billCode = req.body?.billCode;
    const instituteId = req.body?.instituteId;
    const instituteCode = req.body?.instituteCode;
    const employeeIds = Array.isArray(req.body?.employeeIds)
      ? req.body.employeeIds.map(Number).filter((n) => Number.isFinite(n))
      : null;

    if (!billCode) {
      return res.status(400).json({ message: "Salary Bill Code is required." });
    }

    const bill = await getBillByCode(billCode);
    if (!bill) {
      return res.status(404).json({ message: "Bill Code not found." });
    }
    const notOpen = assertBillOpenForSalaryEntry(bill);
    if (notOpen) {
      return res
        .status(notOpen.status)
        .json({ message: notOpen.message, allowed: false });
    }

    const institute = await getInstitute(instituteId, instituteCode);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    const asOfDate = asOfFromBill(bill);
    const built = await buildEmployeeRows({ bill, institute, asOfDate });
    let rows = built.rows;
    if (employeeIds?.length) {
      const set = new Set(employeeIds);
      rows = rows.filter((r) => set.has(Number(r.employeeId)));
    }

    res.json({
      message: "OK",
      asOfDate,
      data: rows,
      errors: built.errors,
      warnings: built.warnings,
    });
  } catch (error) {
    console.error("POST /api/salary-entry/calculate error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to calculate salary.",
      error: error.message,
    });
  }
});

/* Recalculate master-derived TA after a Salary Entry Basic Pay edit. */
router.post("/transport-allowance", async (req, res) => {
  try {
    const employeeId = Number(req.body?.employeeId);
    const resolved = await resolveSalaryEntryBill({
      billCode: req.body?.billCode,
      billMonth: req.body?.billMonth,
      salaryMonth: req.body?.salaryMonth,
      createIfMissing: false,
      actor: actorFromBody(req.body),
    }).catch(async (err) => {
      /* Fall back to source bill code for TA calc when BM variant not created yet. */
      if (err.status === 404) {
        const bill = await getBillByCode(req.body?.billCode);
        if (!bill) throw err;
        return { bill, sourceBill: bill };
      }
      throw err;
    });
    const bill = resolved.bill;
    const institute = await getInstitute(req.body?.instituteId, req.body?.instituteCode);
    if (!Number.isFinite(employeeId) || !bill || !institute) {
      return res.status(400).json({ message: "Employee, Bill Code and Institute are required." });
    }
    const notOpen = assertBillOpenForSalaryEntry(statusGateBill(resolved));
    if (notOpen) {
      return res
        .status(notOpen.status)
        .json({ message: notOpen.message, allowed: false });
    }
    const owner = await sql.query`SELECT TOP 1 EmployeeId FROM dbo.EmployeeMaster WHERE EmployeeId = ${employeeId} AND InstituteId = ${institute.InstituteId}`;
    if (!owner.recordset[0]) return res.status(404).json({ message: "Employee does not belong to the selected institute." });
    const calc = await calculateForEmployee(employeeId, asOfFromBill(bill), req.body?.basicPay);
    res.json({
      message: "OK",
      data: {
        ta: calc.earnings.ta,
        taMasterId: calc.taMasterId,
        taPayLevelGroup: calc.taPayLevelGroup,
        taBasicUpgradeThreshold: calc.taBasicUpgradeThreshold,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "Unable to recalculate Transport Allowance." });
  }
});

async function saveEmployeesHandler(req, res, { submitted }) {
  const actor = actorFromBody(req.body);
  const billCode = req.body?.billCode;
  const instituteId = req.body?.instituteId;
  const instituteCode = req.body?.instituteCode;
  const billMonth = req.body?.billMonth;
  const salaryMonth = req.body?.salaryMonth;
  const employees = Array.isArray(req.body?.employees) ? req.body.employees : [];
  const billNo = String(req.body?.billNo || "").trim();
  const billDateRaw = String(req.body?.billDate || "").trim();
  const billDate = billDateRaw ? billDateRaw.slice(0, 10) : null;
  /* Cleared on purpose must stay cleared, so "" is stored as NULL rather
     than being treated as "not supplied". */
  const npsScheduleNo = String(req.body?.npsScheduleNo || "").trim();

  if (!billCode) {
    return res.status(400).json({ message: "Salary Bill Code is required." });
  }
  if (!instituteId && !instituteCode) {
    return res.status(400).json({ message: "Institute is required." });
  }
  if (!billMonth) {
    return res.status(400).json({ message: "Bill Month is required." });
  }
  if (!employees.length) {
    return res.status(400).json({ message: "At least one employee is required." });
  }
  if (submitted) {
    if (!billNo) {
      return res.status(400).json({ message: "Bill No. is required." });
    }
    if (!billDate) {
      return res.status(400).json({ message: "Bill Date is required." });
    }
  }

  /*
     NPS Schedule No. is the bank's reference for the NPS remittance, so a
     bill that deducts NPS from ANY employee cannot be stored without it.

     Enforced here rather than in the two routes because save-draft and submit
     share this handler, so the rule applies to both and cannot be bypassed by
     calling the API directly. It sits before resolveSalaryEntryBill and every
     other database write, so a rejected bill changes nothing.

     Number() maps null and "" to 0 and undefined to NaN; neither 0 nor NaN is
     > 0, so blank, missing, "0" and negative values all count as no NPS.
  */
  const hasNpsDeduction = employees.some((e) => Number(e?.nps) > 0);
  if (hasNpsDeduction && !npsScheduleNo.trim()) {
    return res.status(400).json({
      message:
        "NPS Schedule No. is required because at least one employee has an NPS deduction.",
    });
  }

  const resolved = await resolveSalaryEntryBill({
    billCode,
    billMonth,
    salaryMonth,
    createIfMissing: true,
    actor,
  });
  const bill = resolved.bill;
  const sourceBill = resolved.sourceBill || bill;

  logBillResolution(submitted ? "submit" : "save-draft", {
    requested: { billCode, billMonth, salaryMonth, instituteCode },
    resolved,
    institute: instituteCode,
    user: req.user,
  });

  /* The EXACT resolved bill governs. A LOCKED salary-month master must not
     block an editable RETURNED Bill-Month variant. */
  const blocked = assertBillEditable(statusGateBill(resolved));
  if (blocked) {
    return res
      .status(blocked.status)
      .json({ message: blocked.message, allowed: false });
  }
  if (String(bill.Status || "").toUpperCase() === "LOCKED") {
    return res.status(403).json({
      message: `Bill Code ${bill.BillCode} is locked and cannot be modified.`,
      allowed: false,
    });
  }

  const institute = await getInstitute(instituteId, instituteCode);
  if (!institute) {
    return res.status(404).json({ message: "Institute not found." });
  }

  const sectionMismatch = assertInstituteInSection(
    institute,
    req.body?.sectionId
  );
  if (sectionMismatch) {
    return res
      .status(sectionMismatch.status)
      .json({ message: sectionMismatch.message });
  }

  const instituteWorkflow = await getInstituteWorkflow(
    Number(bill.BillCodeId),
    institute.InstituteCode
  );
  const instituteBlocked = assertInstituteEditable(
    instituteWorkflow,
    bill.BillCode,
    institute.InstituteCode
  );
  if (instituteBlocked) {
    const status = String(instituteWorkflow?.Status || "").toUpperCase();
    const friendly =
      status === "SUBMITTED" || status === "RESUBMITTED"
        ? `Already Submitted: Institute ${institute.InstituteCode} for Bill Month ${bill.BillMonth} / Salary Month ${bill.SalaryMonth} (${bill.BillCode}) is ${status}. This does not block a different Bill Month for the same Salary Month.`
        : instituteBlocked.message;
    return res.status(instituteBlocked.status).json({
      message: friendly,
      allowed: false,
    });
  }

  /*
   * Submit is institute-specific.
   * Prefer an existing saved snapshot for this BillCode+Institute+BillMonth+SalaryMonth.
   * If the client already sends the full employee grid, persist it (Save+Submit)
   * instead of rejecting with "Save Draft before Submit".
   */
  if (submitted) {
    const savedCheck = await sql.query`
      SELECT COUNT(1) AS Cnt
      FROM dbo.SalaryEmployeeDetails
      WHERE SalaryBillCodeId = ${Number(bill.BillCodeId)}
        AND InstituteCode = ${institute.InstituteCode}
    `;
    const savedCount = Number(savedCheck.recordset[0]?.Cnt || 0);
    console.log("[salary-entry submit] lookup", {
      billCode: bill.BillCode,
      billCodeId: Number(bill.BillCodeId),
      instituteCode: institute.InstituteCode,
      billMonth: bill.BillMonth,
      salaryMonth: bill.SalaryMonth,
      savedCount,
      employeePayloadCount: employees.length,
    });
    if (savedCount <= 0 && employees.length <= 0) {
      return res.status(400).json({
        message: `No saved salary entry found for institute ${institute.InstituteCode} / Bill Month ${bill.BillMonth} / Salary Month ${bill.SalaryMonth} (${bill.BillCode}). Save Draft before Submit.`,
        allowed: false,
      });
    }
  } else {
    console.log("[salary-entry save-draft] resolve", {
      billCode: bill.BillCode,
      billCodeId: Number(bill.BillCodeId),
      instituteCode: institute.InstituteCode,
      billMonth: bill.BillMonth,
      salaryMonth: bill.SalaryMonth,
      employeePayloadCount: employees.length,
      createdBill: Boolean(resolved.created),
      sourceBillCode: sourceBill.BillCode,
    });
  }

  const asOfDate = asOfFromBill(bill);

  const preErrors = [];
  for (const emp of employees) {
    const employeeId = Number(emp.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      preErrors.push({ employeeId, message: "Invalid Employee ID." });
      continue;
    }
    try {
      const pension = await loadEmployeePension(employeeId);
      const payrollConfig = await loadActivePayrollConfig(employeeId, asOfDate);
      const hraForcedZero = isHraForcedZero(payrollConfig);
      const finalized = finalizeSnapshotAmounts(emp, {
        pension,
        hraForcedZero,
      });
      preErrors.push(...finalized.errors);
    } catch (err) {
      preErrors.push({
        employeeId,
        message: err.message || "Validation failed.",
      });
    }
  }
  if (preErrors.length) {
    return res.status(400).json({
      message: `Salary validation failed for ${preErrors.length} issue(s). No rows were saved.`,
      errors: preErrors,
    });
  }

  const previousStatus = String(
    instituteWorkflow?.Status || "DRAFT"
  ).toUpperCase();
  /*
    Save Draft used to set the institute workflow to DRAFT unconditionally.

    That silently destroyed the returned state: an auditor opening a
    RETURNED bill and clicking Save Draft flipped it to DRAFT, so it fell
    out of "Returning Salary Bills" (which lists RETURNED) while never
    reaching the Account Officer's queue (which lists SUBMITTED /
    RESUBMITTED). The bill disappeared from both sides.

    A draft save during correction is not a workflow transition — it keeps
    whichever auditor-actionable state the bill was already in. Only an
    explicit Submit advances the bill.
  */
  const AUDITOR_ACTIONABLE_STATUSES = new Set(["RETURNED", "REJECTED"]);

  let nextStatus = "DRAFT";
  if (submitted) {
    nextStatus = AUDITOR_ACTIONABLE_STATUSES.has(previousStatus)
      ? "RESUBMITTED"
      : "SUBMITTED";
  } else if (AUDITOR_ACTIONABLE_STATUSES.has(previousStatus)) {
    nextStatus = previousStatus;
  }

  const savedRows = await withTransaction(async (transaction) => {
    const out = [];

    /* Record any increment this bill is the first to apply, so the
       history exists before the salary snapshot referencing it is written.
       Runs inside the same transaction: if the salary save fails below,
       the increment rows roll back with it. */
    const incrementIdByEmployee = new Map();
    for (const emp of employees) {
      const incrementId = await ensureIncrementRecorded(
        transaction,
        bill,
        institute,
        Number(emp.employeeId),
        actor
      );
      if (incrementId) {
        incrementIdByEmployee.set(Number(emp.employeeId), incrementId);
      }
    }

    for (let i = 0; i < employees.length; i += 1) {
      const row = {
        ...employees[i],
        displayOrder: employees[i].displayOrder || i + 1,
      };
      const saved = await upsertEmployeeSalary(
        transaction,
        bill,
        institute,
        row,
        actor,
        asOfDate
      );
      out.push(saved);
    }

    /* Link each saved snapshot row to the increment it was derived from.
       Scoped to this bill + institute + employee, so no other month or
       institute is touched. */
    for (const [employeeId, incrementId] of incrementIdByEmployee) {
      try {
        await makeRequest(transaction).query`
          UPDATE dbo.SalaryEmployeeDetails
          SET IncrementId = ${Number(incrementId)}
          WHERE SalaryBillCodeId = ${Number(bill.BillCodeId)}
            AND InstituteCode = ${institute.InstituteCode}
            AND EmployeeId = ${Number(employeeId)}
        `;
      } catch (err) {
        /* Column absent on an un-migrated database — not fatal. */
        if (!/invalid column name/i.test(String(err.message))) throw err;
      }
    }

    await upsertInstituteWorkflow(transaction, {
      bill,
      institute,
      nextStatus,
      actor,
    });

    /* Persist Salary Entry Bill No. / Bill Date / NPS Schedule No. on the
       institute workflow row for the EXACT resolved bill. Scoping by
       SalaryBillCodeId is what keeps JUN-2026 and JUN-2026-BM-MAY apart. */
    try {
      await makeRequest(transaction).query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          BillNo = ${billNo || null},
          BillDate = ${billDate},
          NPSScheduleNo = ${npsScheduleNo || null},
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${actor.fullName || actor.userName}
        WHERE SalaryBillCodeId = ${Number(bill.BillCodeId)}
          AND InstituteCode = ${institute.InstituteCode}
      `;
    } catch (err) {
      if (!/invalid column name/i.test(String(err.message))) throw err;
      console.warn(
        "BillNo/BillDate/NPSScheduleNo columns missing — run " +
          "migrate:bill-no-date and migrate:nps-schedule-no"
      );
      /* Fall back to the pre-migration columns so a save never fails. */
      try {
        await makeRequest(transaction).query`
          UPDATE dbo.SalaryBillInstituteWorkflow
          SET
            BillNo = ${billNo || null},
            BillDate = ${billDate},
            UpdatedDate = SYSUTCDATETIME(),
            UpdatedBy = ${actor.fullName || actor.userName}
          WHERE SalaryBillCodeId = ${Number(bill.BillCodeId)}
            AND InstituteCode = ${institute.InstituteCode}
        `;
      } catch (inner) {
        if (!/invalid column name/i.test(String(inner.message))) throw inner;
      }
    }

    /*
     * IMPORTANT: Do NOT update dbo.SalaryBillCodes here.
     * Master month status (OPEN / COMPLETED / LOCKED) is controlled only by
     * Salary Bill Code Master Complete/Lock. Institute Submit updates only
     * SalaryBillInstituteWorkflow.
     */
    if (submitted) {
      /* Snapshot current institute salary for Variation Report (return/edit compare). */
      try {
        const snap = makeRequest(transaction);
        await snap.query`
          INSERT INTO dbo.SalaryEmployeeDetailHistory
            (
              SalaryBillCodeId, InstituteCode, EmployeeId, SnapshotType,
              EmployeeName, Designation, EmployeeType, PensionType,
              BasicPay, GradePay, TotalBasic, DA, HRA, MA, TA, CLA,
              SpecialAllowance, WashingAllowance, GrossSalary,
              GPFSubscription, GPFAdvance, NPS, IncomeTax, ProfessionalTax,
              OtherDeduction, TotalDeduction, NetSalary
            )
          SELECT
              d.SalaryBillCodeId,
              d.InstituteCode,
              d.EmployeeId,
              ${nextStatus},
              d.EmployeeName,
              d.Designation,
              d.EmployeeType,
              d.PensionType,
              d.BasicPay,
              d.GradePay,
              d.TotalBasic,
              d.DA,
              d.HRA,
              d.MA,
              d.TA,
              ISNULL(d.CLA, 0),
              d.SpecialAllowance,
              d.WashingAllowance,
              d.GrossSalary,
              d.GPFSubscription,
              d.GPFAdvance,
              d.NPS,
              d.IncomeTax,
              d.ProfessionalTax,
              d.OtherDeduction,
              d.TotalDeduction,
              d.NetSalary
          FROM dbo.SalaryEmployeeDetails d
          WHERE d.SalaryBillCodeId = ${bill.BillCodeId}
            AND d.InstituteCode = ${institute.InstituteCode}
        `;
      } catch (snapErr) {
        console.warn("Salary detail history snapshot skipped:", snapErr.message);
      }
    }

    try {
      const audit = makeRequest(transaction);
      await audit.query`
        INSERT INTO dbo.AuditLogs
          (ModuleName, ActionName, EntityKey, Details, UserName, FullName, TableName, RecordId, NewValues)
        VALUES
          (
            N'SalaryEntry',
            ${submitted ? "SUBMIT" : "SAVE_DRAFT"},
            ${bill.BillCode},
            ${submitted ? "Salary bill submitted" : "Salary draft saved"},
            ${actor.userName},
            ${actor.fullName},
            N'SalaryBillInstituteWorkflow',
            ${String(bill.BillCodeId)},
            ${JSON.stringify({
              billCode: bill.BillCode,
              billCodeId: Number(bill.BillCodeId),
              instituteCode: institute.InstituteCode,
              employeeCount: out.length,
              previousStatus,
              status: nextStatus,
              submitted: !!submitted,
            })}
          )
      `;
    } catch (_) {
      /* optional */
    }

    return out;
  });

  res.json({
    message: submitted
      ? nextStatus === "RESUBMITTED"
        ? "Salary bill resubmitted successfully."
        : "Salary bill submitted successfully."
      : "Salary draft saved successfully.",
    bill: {
      billCodeId: Number(bill.BillCodeId),
      billCode: bill.BillCode,
      sourceBillCode: sourceBill.BillCode,
      instituteCode: institute.InstituteCode,
      status: nextStatus,
      masterStatus: String(sourceBill.Status || "").toUpperCase(),
      salaryMonth: bill.SalaryMonth,
      salaryYear: bill.SalaryYear,
      billMonth: bill.BillMonth,
      billNo,
      billDate,
      npsScheduleNo,
    },
    data: savedRows,
  });
}

router.post("/save-draft", async (req, res) => {
  try {
    await saveEmployeesHandler(req, res, { submitted: false });
  } catch (error) {
    console.error("POST /api/salary-entry/save-draft error:", error);
    res.status(500).json({
      message: error.message || "Unable to save salary draft.",
      error: error.message,
    });
  }
});

router.post("/submit", async (req, res) => {
  try {
    await saveEmployeesHandler(req, res, { submitted: true });
  } catch (error) {
    console.error("POST /api/salary-entry/submit error:", error);
    res.status(500).json({
      message: error.message || "Unable to submit salary bill.",
      error: error.message,
    });
  }
});

const { buildSalaryVariationReport } = require("../utils/salaryVariationReport");

/* GET /api/salary-entry/variation-report
   Institute-scoped variation for the selected Salary Entry bill. */
router.get("/variation-report", async (req, res) => {
  try {
    const data = await buildSalaryVariationReport({
      billCode: req.query.billCode,
      instituteCode: req.query.instituteCode,
      previousBillCode: req.query.previousBillCode,
      compareMode: req.query.compareMode || "auto",
    });
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/salary-entry/variation-report error:", error);
    const status = error.status || 500;
    res.status(status).json({
      message: error.message || "Unable to load variation report.",
      error: error.message,
    });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testBillMonthAcceptance.js). */
module.exports.finalizeSnapshotAmounts = finalizeSnapshotAmounts;
module.exports.mapSavedDetailToGridRow = mapSavedDetailToGridRow;
module.exports.statusGateBill = statusGateBill;
module.exports.assertInstituteInSection = assertInstituteInSection;
module.exports.isManualTa = isManualTa;
