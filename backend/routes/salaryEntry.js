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
  isGpfNpsStoppedForRetirement,
  salaryYearMonthFromAsOfDate,
} = require("../utils/retirementRules");
const {
  getInstituteWorkflow,
  upsertInstituteWorkflow,
  assertInstituteEditable,
  canonicalBillMonthFromBill,
} = require("../utils/salaryBillInstituteWorkflow");
const { APPROVED_WORKFLOW_STATUSES } = require("./chequeRegister");
const {
  resolveSalaryMonthIncrement,
  recordIncrement,
  pad2,
} = require("../utils/employeeIncrement");
const { loadEmployee, resolveBasicPay } = require("./salaryCalculate");
const { resolveSalaryEntryBill } = require("../utils/resolveSalaryEntryBill");
const { normalizeYearMonth, yearMonthKey, formatMonthLabel } = require("../utils/salaryMonthKey");
const {
  getSalaryEntryBillHeader,
  upsertSalaryEntryBillHeader,
} = require("../utils/salaryEntryBillHeader");

/*
   Bill Month vs Salary Month display (2026-09-24, superseded same day by
   real persistence — migration 48, dbo.SalaryBillInstituteWorkflow.BillMonth):
   Bill Month is no longer merely echoed back for display — it is now saved
   per institute bill instance (see saveEmployeesHandler below) and reread
   here on Get Data. This decides what to show for a given call:

   1. The caller explicitly requested a Bill Month THIS call (e.g. the user
      just changed the dropdown and clicked Get Data, or Save/Submit always
      sends the selected value) — echo that back, canonicalized.
   2. Otherwise, fall back to whatever was last PERSISTED for this exact
      bill + institute (e.g. reopening a saved bill from Returned Bills
      without the frontend already knowing its Bill Month).
   3. Otherwise (nothing requested, nothing saved yet — a brand new bill),
      fall back to elseValue (defaults to the Salary Month).
*/
function resolveDisplayBillMonth({
  requestedBillMonth,
  canonicalBillMonth,
  persistedBillMonth,
  elseValue,
}) {
  if (requestedBillMonth && canonicalBillMonth) return canonicalBillMonth;
  if (persistedBillMonth) return persistedBillMonth;
  return canonicalBillMonth || elseValue;
}


/**
 * Identity of the Salary Entry bill INSTANCE being loaded/saved - the ONE
 * place GET /employees and Save Draft/Submit derive it, so they can never
 * disagree (2026-09-24, multiple-independent-bills rule).
 *
 *   instanceBillMonth   key for dbo.SalaryBillInstituteWorkflow,
 *                       dbo.SalaryEntryBillHeader and (non-canonical only)
 *                       dbo.SalaryEntryBillEmployeeDetails
 *   isCanonicalInstance true  -> employee data in dbo.SalaryEmployeeDetails
 *                       false -> dbo.SalaryEntryBillEmployeeDetails
 *   displayBillMonth    what the user selected, for the response only
 *
 * Plain master bill (e.g. AUG-2026, the normal case): the instance IS the
 * selected Bill Month. JUL-2026 and AUG-2026 are two instances of bill 1018;
 * AUG-2026 (== the bill's own Salary Month) is the canonical one.
 *
 * Pre-existing "-BM-" variant bill (e.g. 1019 AUG-2026-BM-JUL, reached by
 * exact code from Returned Bills): that row is ITSELF a separate bill whose
 * Bill Month is part of its own identity. Its data has always lived in
 * dbo.SalaryEmployeeDetails under its own BillCodeId, and migration 51
 * labelled its workflow rows with its canonical label - exactly as the
 * approval routes (canonicalBillMonthFromBill) read them. So it is always
 * its own canonical instance.
 */
function resolveEntryInstance(resolved) {
  const bill = resolved.bill;
  const sourceBill = resolved.sourceBill || bill;
  const displayBillMonth =
    formatMonthLabel(
      normalizeYearMonth(resolved.canonicalBillMonth, bill.SalaryYear, null)
    ) || resolved.canonicalBillMonth || "";
  const billCanonicalLabel =
    canonicalBillMonthFromBill(bill) || resolved.canonicalSalaryMonth || "";

  if (Number(bill.BillCodeId) !== Number(sourceBill.BillCodeId)) {
    return {
      instanceBillMonth: billCanonicalLabel,
      isCanonicalInstance: true,
      displayBillMonth,
    };
  }
  return {
    instanceBillMonth: displayBillMonth,
    isCanonicalInstance:
      Boolean(displayBillMonth) && displayBillMonth === billCanonicalLabel,
    displayBillMonth,
  };
}

const router = express.Router();

/*
 * Salary Entry response trace (2026-09-24, JUL-2026 shows LOCKED
 * investigation). One JSON line per Get Data / Save Draft / Submit,
 * written to the console AND to backend/logs/salary-entry-trace.log, with
 * the exact values returned to the browser and the workflow row they came
 * from. CODE_STAMP + pid identify which build/process answered. Never
 * throws - tracing must not break a request.
 */
const SALARY_ENTRY_CODE_STAMP = "retirement-date-fix-2026-09-25a";

/* TEMPORARY (2026-09-25) — the exact employee IDs under investigation for
   the Retirement Date column. Empty this Set (or delete the block that
   reads it in buildEmployeeRows) once the live API response is confirmed
   correct; it exists only to answer "is the value lost, or is the running
   process just old code" without logging the whole employee roster. */
const RETIREMENT_DEBUG_EMPLOYEE_IDS = new Set([2093, 2094, 2095, 2097, 2098, 2099]);
const PROCESS_STARTED_AT = new Date().toISOString();
function traceSalaryEntry(event, data) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    code: SALARY_ENTRY_CODE_STAMP,
    pid: process.pid,
    processStartedAt: PROCESS_STARTED_AT,
    ...data,
  });
  try {
    console.log(`[salary-entry-trace] ${line}`);
  } catch (_) {
    /* ignore */
  }
  /* Offline test scripts set SALARY_ENTRY_TRACE_FILE=0 so they never
     write into the real log folder. */
  if (process.env.SALARY_ENTRY_TRACE_FILE === "0") return;
  try {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "salary-entry-trace.log"), line + "\n");
  } catch (_) {
    /* ignore */
  }
}

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

/**
 * Recalculate totals from component amounts (bill snapshot).
 *
 * `retirementStop` (default false) is the retirement-based GPF/NPS stop
 * rule (2026-09-25) — see utils/retirementRules.js. It is an explicit,
 * opt-in parameter rather than something this function derives itself,
 * because finalizeSnapshotAmounts is called from two very different
 * contexts:
 *   - mapSavedDetailToGridRow(): re-derives totals for DISPLAY of an
 *     already-saved snapshot (any workflow status, including LOCKED /
 *     SUBMITTED / APPROVED / COMPLETED). It never passes this flag, so a
 *     historical saved amount is always shown exactly as it was saved —
 *     never silently zeroed just because today's date now falls in the
 *     retirement window (existing precedent: this same function already
 *     never recalculates DA/HRA from today's masters for a saved row).
 *   - upsertEmployeeSalary() (Save Draft / Submit): only ever reached for
 *     an editable bill (gated earlier by assertInstituteEditable), so it
 *     is the only caller that passes this flag, freshly computed from
 *     EmployeeMaster.DateOfRetirement + the bill's Salary Month.
 */
function finalizeSnapshotAmounts(input, { pension, hraForcedZero, retirementStop = false }) {
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

  /*
     Retirement-based GPF/NPS deduction stop (2026-09-25) — see
     utils/retirementRules.js. Wins over a preserved/manual NPS value too:
     the rule is not something the operator can override by typing over
     it. Only the deduction that actually applies to this employee's
     pension type is touched; GPF Advance, Income Tax, Professional Tax
     and Other Deduction are untouched, and this never invents a GPF
     deduction for an NPS employee or vice versa.
  */
  if (retirementStop) {
    if (pensionType === "GPF") gpfSubscription = 0;
    if (pensionType === "NPS") nps = 0;
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
      gpfNpsRetirementStop: Boolean(retirementStop),
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

/**
 * `retirementStop` (default false) is an explicit opt-in, exactly like
 * finalizeSnapshotAmounts' own parameter of the same name (2026-09-25,
 * live-bug fix): a saved snapshot of a bill that is still DRAFT/editable is
 * NOT the same thing as a genuinely historical APPROVED/LOCKED bill — the
 * former must keep reflecting the current retirement-stop rule every time
 * "Get Data" reloads it (an employee's DateOfRetirement can be set/edited
 * after the row was first saved), while the latter must never be silently
 * recalculated. buildEmployeeRows() is the only caller that computes and
 * passes this flag, and only for an instance it has confirmed is NOT
 * APPROVED/LOCKED; every other caller (including the offline tests that
 * reopen a saved row for display) omits it and keeps the old, unaffected
 * behavior.
 */
function mapSavedDetailToGridRow(dbRow, { retirementStop = false } = {}) {
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
      retirementStop,
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

async function loadSavedRows(billCodeId, instituteCode, billMonth, isCanonical) {
  /*
     Canonical instance (Bill Month == Salary Month, e.g. AUG-2026 bill for
     AUG-2026 salary) keeps reading dbo.SalaryEmployeeDetails exactly as
     before Bill-Month isolation existed - unaffected by any other Bill
     Month instance's data.

     Non-canonical instance (Bill Month < Salary Month, e.g. JUL-2026 bill
     for AUG-2026 salary) reads the dedicated
     dbo.SalaryEntryBillEmployeeDetails table, keyed additionally by the
     EXACT Bill Month, so it never sees another instance's saved rows.
  */
  if (!isCanonical) {
    const month = String(billMonth || "").trim();
    const result = await sql.query`
      SELECT *
      FROM dbo.SalaryEntryBillEmployeeDetails
      WHERE SalaryBillCodeId = ${billCodeId}
        AND InstituteCode = ${String(instituteCode || "").trim()}
        AND BillMonth = ${month}
    `;
    const map = new Map();
    for (const row of result.recordset) {
      map.set(Number(row.EmployeeId), row);
    }
    return map;
  }

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

async function buildEmployeeRows({ bill, institute, asOfDate, billMonth, isCanonical }) {
  const empResult = await sql.query`
    SELECT e.EmployeeId, e.EmployeeName, e.EmployeeCode, e.DateOfRetirement
    FROM dbo.EmployeeMaster e
    WHERE e.InstituteId = ${institute.InstituteId}
      AND UPPER(ISNULL(e.Status, N'Active')) = N'ACTIVE'
      AND ISNULL(e.IsActive, 1) = 1
    ORDER BY e.EmployeeName, e.EmployeeId
  `;

  /* Retirement Date is display-only in Salary Entry: read straight from
     dbo.EmployeeMaster (the single source of truth already used by Employee
     Master / Employee Report), never stored on or derived from the salary
     snapshot tables, and never recalculated here. */
  const retirementDateByEmployeeId = new Map();
  for (const item of empResult.recordset) {
    retirementDateByEmployeeId.set(
      Number(item.EmployeeId),
      item.DateOfRetirement || null
    );
  }

  const saved = await loadSavedRows(bill.BillCodeId, institute.InstituteCode, billMonth, isCanonical);

  /*
     Retirement-based GPF/NPS stop rule, applied to a SAVED-but-still-DRAFT
     row too (2026-09-25 live-bug fix). A saved snapshot only stays exempt
     from this recheck once the bill instance is genuinely historical
     (APPROVED/LOCKED) — see mapSavedDetailToGridRow's doc comment. A bill
     still being worked on (DRAFT/SUBMITTED/RETURNED, or no workflow row at
     all yet) must reflect the CURRENT rule every time Get Data reloads it,
     because DateOfRetirement on EmployeeMaster can be added or corrected
     after the row was first saved (exactly the live case reported: the row
     was saved before/without the correct retirement date being effective,
     then never touched again by Get Data). Looked up once per institute
     call, using the exact same (billCodeId, instituteCode, billMonth) key
     the caller uses for its own status display — never a different instance.
  */
  let instanceEditableForRetirementStop = true;
  if (billMonth) {
    try {
      const workflow = await getInstituteWorkflow(
        Number(bill.BillCodeId),
        institute.InstituteCode,
        billMonth
      );
      if (workflow) {
        const status = String(workflow.Status || "DRAFT").trim().toUpperCase();
        instanceEditableForRetirementStop = !APPROVED_WORKFLOW_STATUSES.has(status);
      }
    } catch (_) {
      /* No workflow row / lookup failure -> treat as an editable draft
         rather than silently skipping the rule. */
      instanceEditableForRetirementStop = true;
    }
  }
  const retirementSalaryYm = salaryYearMonthFromAsOfDate(asOfDate);

  const rows = [];
  const errors = [];
  const warnings = [];
  let order = 1;

  for (const item of empResult.recordset) {
    const employeeId = Number(item.EmployeeId);
    const existing = saved.get(employeeId);

    /* Prefer saved bill snapshot — do not recalculate from today's masters.
       Still re-apply Payroll Config HRA force-zero as-of the bill month so a
       wrong/legacy HraForcedZero flag cannot keep calculating HRA, and
       re-check the retirement-stop rule for a still-editable (non
       APPROVED/LOCKED) instance — see the comment above. */
    if (existing) {
      const payrollConfig = await loadActivePayrollConfig(employeeId, asOfDate);
      const hraForcedZero = isHraForcedZero(payrollConfig);
      const retirementStopForRow =
        instanceEditableForRetirementStop && retirementSalaryYm
          ? isGpfNpsStoppedForRetirement({
              dateOfRetirement: retirementDateByEmployeeId.get(employeeId),
              salaryYear: retirementSalaryYm.salaryYear,
              salaryMonth: retirementSalaryYm.salaryMonth,
            })
          : false;
      const row = mapSavedDetailToGridRow(
        {
          ...existing,
          HraForcedZero: hraForcedZero ? 1 : 0,
          HRA: hraForcedZero ? 0 : existing.HRA,
        },
        { retirementStop: retirementStopForRow }
      );
      row.displayOrder = existing.DisplayOrder || order;
      row.dateOfRetirement = retirementDateByEmployeeId.get(employeeId) || null;
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
      row.dateOfRetirement = retirementDateByEmployeeId.get(employeeId) || null;

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

  /*
     TEMPORARY DIAGNOSTIC (2026-09-25) — Retirement Date investigation.
     Prints ONLY the employees under active investigation (never the whole
     roster), one line each, showing the raw SQL value read from
     dbo.EmployeeMaster side-by-side with the value actually attached to the
     row that goes into the API response. This is the fastest way to tell
     "backend still running old code" apart from "value lost somewhere in
     this function" without touching the database or guessing.
     Safe to delete this block (and RETIREMENT_DEBUG_EMPLOYEE_IDS above it)
     once the live API response has been confirmed correct.
  */
  if (RETIREMENT_DEBUG_EMPLOYEE_IDS.size) {
    const fmt = (value) => {
      if (!value) return "NULL";
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
    };
    for (const row of rows) {
      const id = Number(row.employeeId);
      if (!RETIREMENT_DEBUG_EMPLOYEE_IDS.has(id)) continue;
      console.log(
        `[retirement-date-debug] ${id} SQL=${fmt(retirementDateByEmployeeId.get(id))} mapped=${fmt(row.dateOfRetirement)}`
      );
    }
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
  asOfDate,
  billMonth,
  isCanonical
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
  /*
     Retirement-based GPF/NPS deduction stop (2026-09-25): taCalc already
     computed this fresh (EmployeeMaster.DateOfRetirement as of right now,
     compared against this bill's Salary Month via asOfDate — never Bill
     Month) as part of the calculateForEmployee() call directly above, so
     reuse it rather than querying/deriving it a second time. This save
     path (upsertEmployeeSalary) is only ever reached for an editable bill
     — assertInstituteEditable() already gated the request before this
     function runs — so applying it here can never touch a LOCKED /
     SUBMITTED / APPROVED / COMPLETED bill's historical data.
  */
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
    { pension, hraForcedZero, retirementStop: Boolean(taCalc.gpfNpsRetirementStop) }
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
  let detailId;
  if (isCanonical) {
    const existingReq = makeRequest(transaction);
    const existing = await existingReq.query`
      SELECT TOP 1 Id
      FROM dbo.SalaryEmployeeDetails
      WHERE SalaryBillCodeId = ${bill.BillCodeId}
        AND EmployeeId = ${employeeId}
        AND InstituteCode = ${institute.InstituteCode}
    `;

    detailId = existing.recordset[0]?.Id
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
  } else {
    const existingReq = makeRequest(transaction);
    const existing = await existingReq.query`
      SELECT TOP 1 Id
      FROM dbo.SalaryEntryBillEmployeeDetails
      WHERE SalaryBillCodeId = ${bill.BillCodeId}
        AND EmployeeId = ${employeeId}
        AND InstituteCode = ${institute.InstituteCode}
        AND BillMonth = ${billMonth}
    `;

    detailId = existing.recordset[0]?.Id
      ? Number(existing.recordset[0].Id)
      : null;

    if (detailId) {
      const upd = makeRequest(transaction);
      await upd.query`
        UPDATE dbo.SalaryEntryBillEmployeeDetails
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
        INSERT INTO dbo.SalaryEntryBillEmployeeDetails
          (
            SalaryBillCodeId, BillMonth, EmployeeId, EmployeeName, Designation, EmployeeType, PensionType, DisplayOrder,
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
            ${billMonth},
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
    {
      const taFlag = makeRequest(transaction);
      await taFlag.query`
        UPDATE dbo.SalaryEntryBillEmployeeDetails
        SET TAManual = ${mapped.taManual ? 1 : 0}
        WHERE Id = ${detailId}
      `;
    }

    try {
      const delComp = makeRequest(transaction);
      await delComp.query`
        DELETE FROM dbo.SalaryEntryBillEmployeeComponentDetails
        WHERE SalaryEntryBillEmployeeDetailId = ${detailId}
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
          INSERT INTO dbo.SalaryEntryBillEmployeeComponentDetails
            (SalaryEntryBillEmployeeDetailId, SalaryComponentId, Amount, CalculationBase, Rate, Remarks, CreatedBy)
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
      /*
         A missing Bill-Month variant (e.g. AUG-2026 / Bill Month JUL-2026
         with no AUG-2026-BM-JUL row yet) must be reported to the user, not
         silently papered over by loading the salary-month master bill's
         data under the wrong Bill Month. Salary Bill Code Master remains
         the only place that may create the missing row; this path only
         ever searches. Logged explicitly so it's visible in the server log
         that nothing was auto-created.
      */
      if (err.status === 404 && err.code === "BILL_MONTH_VARIANT_NOT_FOUND") {
        console.log(
          `[Salary Entry] Bill Code NOT auto-created (search only) — ` +
            `requested BillCode=${billCode} SalaryMonth=${err.canonicalSalaryMonth} ` +
            `BillMonth=${err.canonicalBillMonth} Institute=${instituteCode || instituteId || ""}`
        );
        throw err;
      }
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

    /*
       instanceBillMonth is THE identity of the Salary Entry instance being
       loaded - canonicalized, defaults to the Salary Month when the caller
       requested nothing (2026-09-24, multiple-independent-bills business
       rule). isCanonical decides which storage this instance reads from:
       the ORIGINAL dbo.SalaryEmployeeDetails when it equals the bill's own
       Salary Month (unchanged, every existing consumer keeps working), or
       the new dbo.SalaryEntryBillEmployeeDetails (migration 50) for any
       earlier Bill Month instance - so a JUL-2026 bill and an AUG-2026
       bill of the SAME AUG-2026 salary bill never share a row. */
    const { instanceBillMonth, isCanonicalInstance, displayBillMonth } =
      resolveEntryInstance(resolved);

    const asOfDate = asOfFromBill(bill);
    const { rows, errors, warnings } = await buildEmployeeRows({
      bill,
      institute,
      asOfDate,
      billMonth: instanceBillMonth,
      isCanonical: isCanonicalInstance,
    });

    let instituteStatus = "DRAFT";
    /* Bill Month of the workflow row the status came from (null = this
       instance has no workflow row yet). Always equals instanceBillMonth;
       returned so a mismatch is visible in the response, never silent. */
    let workflowBillMonth = null;
    let workflowRow = null;
    try {
      /* Keyed on the EXACT resolved bill + EXACT Bill Month instance
         (migration 51) - a JUL-2026 instance and an AUG-2026 instance of
         the same bill + institute now have their own independent
         DRAFT/SUBMITTED/.../APPROVED/LOCKED status, so locking one never
         affects the other. */
      const workflow = await getInstituteWorkflow(
        Number(bill.BillCodeId),
        institute.InstituteCode,
        instanceBillMonth
      );
      if (workflow) {
        instituteStatus = String(workflow.Status || "DRAFT").toUpperCase();
        workflowBillMonth = workflow.BillMonth || null;
        workflowRow = workflow;
      }
    } catch (workflowErr) {
      /* Only a database that has not yet taken migration 48 (no BillMonth
         column) may fall back to DRAFT. Any other failure must surface:
         silently reporting DRAFT would make a LOCKED instance look
         editable. */
      if (!/invalid column name|invalid object name/i.test(String(workflowErr.message))) {
        throw workflowErr;
      }
    }

    const responseBillMonth = displayBillMonth || bill.BillMonth || "";

    /*
       Bill No. / Bill Date / NPS Schedule No. are per-Bill-Month-instance
       (migration 49, dbo.SalaryEntryBillHeader) — a JUL-2026 bill and an
       AUG-2026 bill for the SAME AUG-2026 salary data each have their own.
       Looked up by the EXACT Bill Month being displayed (responseBillMonth,
       canonicalized), never by the bill+institute alone. If no header
       exists yet for this specific Bill Month, the fields come back blank —
       NEVER copied from another Bill Month's saved header. */
    let entryBillNo = "";
    let entryBillDate = null;
    let entryNpsScheduleNo = "";
    try {
      const headerBillMonth = instanceBillMonth || responseBillMonth;
      const header = await getSalaryEntryBillHeader(
        Number(bill.BillCodeId),
        institute.InstituteCode,
        headerBillMonth
      );
      if (header) {
        entryBillNo = header.BillNo != null ? String(header.BillNo) : "";
        entryBillDate = header.BillDate || null;
        entryNpsScheduleNo =
          header.NPSScheduleNo != null ? String(header.NPSScheduleNo) : "";
      }
    } catch (_) {
      /* dbo.SalaryEntryBillHeader absent before migration 49 — blank is
         the correct, documented behavior either way. */
    }

    traceSalaryEntry("GET /employees", {
      request: { billCode, billMonth, salaryMonth, instituteCode, instituteId },
      resolvedBill: {
        BillCodeId: Number(bill.BillCodeId),
        BillCode: bill.BillCode,
        BillMonth: bill.BillMonth,
        SalaryMonth: bill.SalaryMonth,
        SalaryYear: bill.SalaryYear,
        SalaryMonthNumber: bill.SalaryMonthNumber,
        Status: bill.Status,
        sourceBillCodeId: Number(sourceBill.BillCodeId),
        canonicalBillMonth: resolved.canonicalBillMonth,
        canonicalSalaryMonth: resolved.canonicalSalaryMonth,
      },
      instance: { instanceBillMonth, isCanonicalInstance, displayBillMonth },
      workflow: workflowRow
        ? { WorkflowId: workflowRow.WorkflowId, BillMonth: workflowRow.BillMonth, Status: workflowRow.Status }
        : null,
      response: {
        billCodeId: Number(bill.BillCodeId),
        billMonth: responseBillMonth,
        status: instituteStatus,
        workflowBillMonth,
        resolvedMasterStatus: String(bill.Status || "").toUpperCase(),
        masterStatus: String(sourceBill.Status || "").toUpperCase(),
        employeeRows: rows.length,
        firstBasicPay: rows[0] ? rows[0].basicPay : null,
        /* Retirement Date diagnostics (2026-09-25 fix): confirms whether the
           value actually reached the response returned to the browser — so
           a report of "still shows -" can be told apart from "genuinely no
           date on file in EmployeeMaster" without touching the database
           from outside this request. (rows is buildEmployeeRows()'s
           already-computed output; nothing here is queried again.) */
        retirementDate: {
          employeesTotal: rows.length,
          rowsWithDateOfRetirement: rows.filter((r) => r.dateOfRetirement).length,
          sample: rows.slice(0, 3).map((r) => ({
            employeeId: r.employeeId,
            dateOfRetirement: r.dateOfRetirement,
          })),
        },
      },
    });

    res.json({
      message: errors.length
        ? `Loaded ${rows.length} employees with ${errors.length} calculation error(s).`
        : "OK",
      bill: {
        billCodeId: Number(bill.BillCodeId),
        billCode: bill.BillCode,
        sourceBillCode: sourceBill.BillCode,
        billMonth: responseBillMonth,
        salaryMonth: bill.SalaryMonth || resolved.canonicalSalaryMonth || "",
        salaryYear: bill.SalaryYear,
        /* Institute workflow status for Salary Entry UI (not master month status). */
        status: instituteStatus,
        workflowBillMonth,
        workflowId: workflowRow ? Number(workflowRow.WorkflowId) : null,
        instanceBillMonth,
        codeStamp: SALARY_ENTRY_CODE_STAMP,
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
      error.code === "BILL_MONTH_VARIANT_NOT_FOUND" ||
      error.code === "BILL_MONTH_AFTER_SALARY_MONTH" ||
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

  /* Same identity as GET /employees: THE Bill Month instance being saved,
     and whether it is the canonical (Bill Month == Salary Month) instance
     that keeps using the original SalaryEmployeeDetails storage, or an
     earlier instance routed to the new per-Bill-Month tables. */
  const { instanceBillMonth, isCanonicalInstance } =
    resolveEntryInstance(resolved);

  const instituteWorkflow = await getInstituteWorkflow(
    Number(bill.BillCodeId),
    institute.InstituteCode,
    instanceBillMonth
  );
  const instituteBlocked = assertInstituteEditable(
    instituteWorkflow,
    bill.BillCode,
    institute.InstituteCode
  );
  traceSalaryEntry(submitted ? "POST /submit gate" : "POST /save-draft gate", {
    request: { billCode, billMonth, salaryMonth, instituteCode, instituteId },
    resolvedBill: { BillCodeId: Number(bill.BillCodeId), BillCode: bill.BillCode },
    instance: { instanceBillMonth, isCanonicalInstance },
    workflow: instituteWorkflow
      ? { WorkflowId: instituteWorkflow.WorkflowId, BillMonth: instituteWorkflow.BillMonth, Status: instituteWorkflow.Status }
      : null,
    blocked: instituteBlocked ? instituteBlocked.status : null,
  });
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
        asOfDate,
        instanceBillMonth,
        isCanonicalInstance
      );
      out.push(saved);
    }

    /* Link each saved snapshot row to the increment it was derived from.
       Scoped to this bill + institute + employee (+ Bill Month for a
       non-canonical instance), so no other month or institute is touched. */
    for (const [employeeId, incrementId] of incrementIdByEmployee) {
      try {
        if (isCanonicalInstance) {
          await makeRequest(transaction).query`
            UPDATE dbo.SalaryEmployeeDetails
            SET IncrementId = ${Number(incrementId)}
            WHERE SalaryBillCodeId = ${Number(bill.BillCodeId)}
              AND InstituteCode = ${institute.InstituteCode}
              AND EmployeeId = ${Number(employeeId)}
          `;
        } else {
          await makeRequest(transaction).query`
            UPDATE dbo.SalaryEntryBillEmployeeDetails
            SET IncrementId = ${Number(incrementId)}
            WHERE SalaryBillCodeId = ${Number(bill.BillCodeId)}
              AND InstituteCode = ${institute.InstituteCode}
              AND EmployeeId = ${Number(employeeId)}
              AND BillMonth = ${instanceBillMonth}
          `;
        }
      } catch (err) {
        /* Column absent on an un-migrated database — not fatal. */
        if (!/invalid column name/i.test(String(err.message))) throw err;
      }
    }

    /* Institute workflow status (DRAFT/SUBMITTED/.../APPROVED/LOCKED) is
       now Bill-Month-specific (migration 51) — a separate row per exact
       Bill Month instance, so locking AUG-2026 never touches JUL-2026's
       row. The old "persist BillMonth as a display fallback" UPDATE
       (migration 48 follow-up) is retired: it blindly matched every row
       for this bill+institute, which is no longer safe or meaningful now
       that more than one such row can exist. upsertInstituteWorkflow
       creates/updates the exact (bill, institute, instanceBillMonth) row
       directly. */
    await upsertInstituteWorkflow(transaction, {
      bill,
      institute,
      nextStatus,
      actor,
      billMonth: instanceBillMonth,
    });

    /*
       Bill No. / Bill Date / NPS Schedule No. are per-Bill-Month-instance
       (migration 49, dbo.SalaryEntryBillHeader) — the SAME AUG-2026 salary
       bill can have a JUL-2026 instance and an AUG-2026 instance, each
       keeping its own values without overwriting the other. Written
       ONLY here, keyed by the EXACT (SalaryBillCodeId, InstituteCode,
       canonical BillMonth) triple — NEVER on dbo.SalaryBillInstituteWorkflow
       (see utils/salaryEntryBillHeader.js). */
    try {
      await upsertSalaryEntryBillHeader(transaction, {
        billCodeId: bill.BillCodeId,
        instituteCode: institute.InstituteCode,
        billMonth: instanceBillMonth,
        billNo,
        billDate,
        npsScheduleNo,
        actor,
      });
    } catch (err) {
      if (!/invalid object name|invalid column name/i.test(String(err.message))) {
        throw err;
      }
      console.warn(
        "dbo.SalaryEntryBillHeader missing — run migrate:salary-entry-bill-header"
      );
    }

    /*
     * IMPORTANT: Do NOT update dbo.SalaryBillCodes here.
     * Master month status (OPEN / COMPLETED / LOCKED) is controlled only by
     * Salary Bill Code Master Complete/Lock. Institute Submit updates only
     * SalaryBillInstituteWorkflow.
     */
    if (submitted && isCanonicalInstance) {
      /* Snapshot current institute salary for Variation Report
         (return/edit compare). Variation Report reads only the canonical
         Salary-Month snapshot (dbo.SalaryEmployeeDetails) - unchanged by
         this feature, so this only runs for the canonical instance; a
         non-canonical (earlier Bill Month) instance is not yet wired into
         Variation Report and is skipped here rather than snapshotting the
         wrong table's data under the master bill's identity. */
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

  /* Save/Submit always supplies billMonth explicitly (validated required
     above), so the just-saved value is always the canonical one — no
     persisted-fallback needed here (that's a Get Data / reopen concern). */
  const saveResponseBillMonth = resolveDisplayBillMonth({
    requestedBillMonth: billMonth,
    canonicalBillMonth: resolved.canonicalBillMonth,
    persistedBillMonth: "",
    elseValue: bill.BillMonth,
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
      billMonth: saveResponseBillMonth,
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
    /* error.status: e.g. 400 BILL_MONTH_AFTER_SALARY_MONTH must reach the
       client as a rejection, not a generic 500. */
    res.status(error.status || 500).json({
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
    res.status(error.status || 500).json({
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
module.exports.resolveDisplayBillMonth = resolveDisplayBillMonth;
module.exports.resolveEntryInstance = resolveEntryInstance;
module.exports.buildEmployeeRows = buildEmployeeRows;
module.exports.asOfFromBill = asOfFromBill;
