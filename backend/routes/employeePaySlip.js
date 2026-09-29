/**
 * EMPLOYEE PAY SLIP
 *
 * The official monthly salary statement for ONE employee in ONE bill.
 *
 * This module computes NO salary. Every amount is the stored value from
 * dbo.SalaryEmployeeDetails — the same row Salary Entry saved and Salary Bill
 * Approval displays — read through the shared loader in
 * routes/employeeWiseSalary.js so the Pay Slip can never disagree with the
 * Employee Wise Salary report:
 *
 *   loadEmployeeSalaryRows()   the single approved-rows query
 *
 * That loader already enforces, in SQL, the universal report rules:
 *   - workflow Status IN ('APPROVED','LOCKED')   nothing else is official
 *   - ISNULL(b.IsArchived, 0) = 0                archived bills excluded
 *   - BillCategory <> 'DIFFERENCE'               DA Difference is a separate
 *     AND BillType <> 'DA DIFFERENCE'            statement, never this slip
 *
 * Grain: one slip per (bill, institute, employee). Bills are NEVER merged —
 * a JUN-2026 bill and a JUN-2026-BM-MAY bill are two separate payments with
 * different Bill Months, Bill Nos. and Bill Dates, so they are two slips.
 */

const express = require("express");
const {
  resolveChequeSalaryType,
  matchesFilterMonthYear,
} = require("../utils/salaryMonthKey");
const { loadEmployeeSalaryRows } = require("./employeeWiseSalary");
const {
  billMonthPartsOf,
  salaryMonthPartsOf,
  compareGroupCodes,
} = require("./chequeRegister");
const { amountInWordsIndian } = require("../utils/amountInWords");

const router = express.Router();

const HEADING = ["GOVERNMENT OF GUJARAT", "DIRECTORATE OF SOCIAL DEFENCE"];
const TITLE = "PAY SLIP";
const DISCLAIMER =
  "Digitally generated Pay Slip. Directorate of Social Defence.";

const MONTH_FULL_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNum(value).toFixed(2));
}

function fullMonthLabel(parts) {
  if (!parts) return "";
  return `${MONTH_FULL_NAMES[parts.month - 1]} ${parts.year}`;
}

function dateOnly(value) {
  if (!value) return "";
  const raw = String(value instanceof Date ? value.toISOString() : value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : raw;
}

/*
   The Pay Slip's earning and deduction lines, in order.

   This list IS the contract: it is exactly the Salary Entry grid's earning
   and deduction columns, no more. OtherEarnings, NPPA, NPSAdvance and
   ChequeAmount are stored in the table but are NOT Salary Entry grid columns,
   so they are deliberately absent.

   "FixPay / Grade Pay" is the Pay Slip label for the grid's "FIX Basic",
   which Salary Entry stores in the GradePay column. It is ONE field. The
   database column is not renamed and no separate Grade Pay exists.
*/
const EARNING_LINES = [
  { key: "basic", label: "Basic", column: "BasicPay" },
  { key: "fixPay", label: "FixPay / Grade Pay", column: "GradePay" },
  { key: "totalBasicPay", label: "Total Basic Pay", column: "TotalBasic" },
  { key: "da", label: "DA", column: "DA" },
  { key: "hra", label: "HRA", column: "HRA" },
  { key: "ma", label: "MA", column: "MA" },
  { key: "ta", label: "TA", column: "TA" },
  { key: "cla", label: "CLA", column: "CLA" },
  { key: "specialAllowance", label: "Special Allow.", column: "SpecialAllowance" },
  { key: "washingAllowance", label: "Washing Allow.", column: "WashingAllowance" },
];

const DEDUCTION_LINES = [
  { key: "gpfSubscription", label: "GPF Subscription", column: "GPFSubscription" },
  { key: "gpfAdvance", label: "GPF Adv", column: "GPFAdvance" },
  { key: "nps", label: "NPS", column: "NPS" },
  { key: "incomeTax", label: "Income Tax", column: "IncomeTax" },
  { key: "professionalTax", label: "Professional Tax", column: "ProfessionalTax" },
  { key: "otherDeduction", label: "Other Deduction", column: "OtherDeduction" },
];

/**
 * One stored salary row -> one Pay Slip document.
 *
 * Every amount is read straight from its stored column. Gross Salary, Total
 * Deduction and Net Salary are the STORED totals — they are never re-summed
 * from the component lines, because the stored value is what was approved and
 * what the bank was told to pay.
 */
function buildPaySlip(row) {
  const salaryYm = salaryMonthPartsOf(
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );
  /*
     Bill Month is parsed on its own. normalizeYearMonth short-circuits on an
     explicit month number + year, so passing SalaryMonthNumber here would
     silently yield the SALARY month for a JUN-2026-BM-MAY bill.
  */
  const billYm = billMonthPartsOf(
    row.BillMonth,
    row.SalaryMonth,
    row.SalaryYear,
    row.SalaryMonthNumber
  );

  const salaryType = resolveChequeSalaryType({
    salaryMonth: row.SalaryMonth,
    billMonth: row.BillMonth,
    salaryYear: row.SalaryYear,
    billYear: row.SalaryYear,
    salaryMonthNumber: row.SalaryMonthNumber,
  });

  /* Zero is printed, never hidden: the slip is a fixed, auditable form. */
  const earnings = EARNING_LINES.map((line) => ({
    key: line.key,
    label: line.label,
    amount: round2(row[line.column]),
  }));
  const deductions = DEDUCTION_LINES.map((line) => ({
    key: line.key,
    label: line.label,
    amount: round2(row[line.column]),
  }));

  /* STORED totals. Not recomputed. */
  const grossSalary = round2(row.GrossSalary);
  const totalDeduction = round2(row.TotalDeduction);
  const netSalary = round2(row.NetSalary);

  return {
    heading: HEADING,
    title: TITLE,
    disclaimer: DISCLAIMER,

    bill: {
      billCodeId: Number(row.BillCodeId),
      billCode: row.BillCode || "",
      /* Independent, and both shown. Never substituted for one another. */
      salaryMonth: fullMonthLabel(salaryYm) || row.SalaryMonth || "",
      billMonth: fullMonthLabel(billYm) || row.BillMonth || "",
      salaryType,
      billNo: row.BillNo == null ? "" : String(row.BillNo),
      billDate: dateOnly(row.BillDate),
      workflowStatus: String(row.WorkflowStatus || "").trim().toUpperCase(),
    },

    institute: {
      instituteCode: row.InstituteCode || "",
      instituteName: row.InstituteName || row.InstituteCode || "",
      sectionId: row.SectionId == null ? null : Number(row.SectionId),
      sectionName: row.SectionName || "",
    },

    employee: {
      employeeId: Number(row.EmployeeId),
      employeeName: row.EmployeeName || "",
      designation: row.Designation || "",
      employeeType: row.EmployeeType || "",
      /*
         Bill-time snapshot, so reprinting an old month shows what was true
         then. EmployeeMaster.GPFNPS is the CURRENT value and is not used.
      */
      pension: row.PensionType == null ? "" : String(row.PensionType),
      bankAccountNumber:
        row.BankAccountNumber == null ? "" : String(row.BankAccountNumber),
    },

    earnings,
    deductions,
    grossSalary,
    totalDeduction,
    netSalary,
    /* Words are of the NET amount actually payable. */
    netSalaryInWords: amountInWordsIndian(netSalary),
  };
}

/** Approved/locked salary rows narrowed by whatever the caller supplied. */
function filterRows(rows, query) {
  const month =
    query.month != null && query.month !== "" ? Number(query.month) : null;
  const year =
    query.year != null && query.year !== "" ? Number(query.year) : null;
  const sectionId =
    query.sectionId != null && query.sectionId !== ""
      ? Number(query.sectionId)
      : null;
  const instituteCode = String(query.instituteCode || "").trim();
  const billCodeId =
    query.billCodeId != null && query.billCodeId !== ""
      ? Number(query.billCodeId)
      : null;
  const employeeId =
    query.employeeId != null && query.employeeId !== ""
      ? Number(query.employeeId)
      : null;

  return rows.filter((row) => {
    /* The period is the SALARY month, as in every other report. */
    if (month != null && year != null) {
      const parts = salaryMonthPartsOf(
        row.SalaryMonth,
        row.SalaryYear,
        row.SalaryMonthNumber
      );
      if (!matchesFilterMonthYear(parts, month, year)) return false;
    }
    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.SectionId) !== sectionId) return false;
    }
    if (instituteCode) {
      if (String(row.InstituteCode || "").trim() !== instituteCode) return false;
    }
    if (billCodeId != null && Number.isFinite(billCodeId)) {
      if (Number(row.BillCodeId) !== billCodeId) return false;
    }
    if (employeeId != null && Number.isFinite(employeeId)) {
      if (Number(row.EmployeeId) !== employeeId) return false;
    }
    return true;
  });
}

/**
 * Cascading filter options, derived from the SAME approved rows the slips are
 * built from — so the pickers can only ever offer a selection that really has
 * an official Pay Slip behind it.
 */
function buildOptions(rows, query) {
  const scoped = filterRows(rows, query);

  const years = [
    ...new Set(
      rows
        .map((r) => salaryMonthPartsOf(r.SalaryMonth, r.SalaryYear, r.SalaryMonthNumber))
        .filter(Boolean)
        .map((p) => p.year)
    ),
  ].sort((a, b) => b - a);

  const sections = new Map();
  const institutes = new Map();
  const bills = new Map();
  const employees = new Map();

  for (const row of filterRows(rows, { month: query.month, year: query.year })) {
    if (row.SectionId != null) {
      sections.set(Number(row.SectionId), {
        sectionId: Number(row.SectionId),
        sectionName: row.SectionName || "",
      });
    }
  }
  for (const row of filterRows(rows, {
    month: query.month, year: query.year, sectionId: query.sectionId,
  })) {
    const code = String(row.InstituteCode || "").trim();
    if (code && !institutes.has(code)) {
      institutes.set(code, {
        instituteCode: code,
        instituteName: row.InstituteName || code,
      });
    }
  }
  for (const row of filterRows(rows, {
    month: query.month, year: query.year,
    sectionId: query.sectionId, instituteCode: query.instituteCode,
  })) {
    const id = Number(row.BillCodeId);
    if (!bills.has(id)) {
      const billYm = billMonthPartsOf(
        row.BillMonth, row.SalaryMonth, row.SalaryYear, row.SalaryMonthNumber
      );
      bills.set(id, {
        billCodeId: id,
        billCode: row.BillCode || "",
        billMonth: fullMonthLabel(billYm) || row.BillMonth || "",
        salaryType: resolveChequeSalaryType({
          salaryMonth: row.SalaryMonth,
          billMonth: row.BillMonth,
          salaryYear: row.SalaryYear,
          billYear: row.SalaryYear,
          salaryMonthNumber: row.SalaryMonthNumber,
        }),
      });
    }
  }
  for (const row of scoped) {
    const id = Number(row.EmployeeId);
    if (!employees.has(id)) {
      employees.set(id, {
        employeeId: id,
        employeeName: row.EmployeeName || "",
        designation: row.Designation || "",
      });
    }
  }

  return {
    years,
    sections: [...sections.values()].sort((a, b) =>
      String(a.sectionName).localeCompare(String(b.sectionName))
    ),
    institutes: [...institutes.values()].sort((a, b) =>
      compareGroupCodes(a.instituteCode, b.instituteCode)
    ),
    /* Every bill is offered separately — they are never merged. */
    bills: [...bills.values()].sort((a, b) =>
      String(a.billCode).localeCompare(String(b.billCode))
    ),
    employees: [...employees.values()].sort((a, b) =>
      String(a.employeeName).localeCompare(String(b.employeeName))
    ),
  };
}

/**
 * The slips for a selection.
 *
 * One slip per (bill, institute, employee). A selection spanning several
 * bills yields several slips rather than one combined document.
 */
async function buildPaySlipReport(query) {
  const rows = filterRows(await loadEmployeeSalaryRows(), query);

  const ordered = [...rows].sort((a, b) => {
    const inst = compareGroupCodes(a.InstituteCode, b.InstituteCode);
    if (inst !== 0) return inst;
    const order = toNum(a.DisplayOrder) - toNum(b.DisplayOrder);
    if (order !== 0) return order;
    return Number(a.EmployeeId) - Number(b.EmployeeId);
  });

  const slips = ordered.map(buildPaySlip);

  return {
    slips,
    count: slips.length,
    filters: {
      month: query.month != null && query.month !== "" ? Number(query.month) : null,
      year: query.year != null && query.year !== "" ? Number(query.year) : null,
      sectionId:
        query.sectionId != null && query.sectionId !== ""
          ? Number(query.sectionId)
          : null,
      instituteCode: String(query.instituteCode || "").trim() || null,
      billCodeId:
        query.billCodeId != null && query.billCodeId !== ""
          ? Number(query.billCodeId)
          : null,
      employeeId:
        query.employeeId != null && query.employeeId !== ""
          ? Number(query.employeeId)
          : null,
    },
  };
}

/* GET /api/employee-pay-slip/options?month=&year=&sectionId=&instituteCode=&billCodeId= */
router.get("/options", async (req, res) => {
  try {
    const rows = await loadEmployeeSalaryRows();
    res.json({ message: "OK", data: buildOptions(rows, req.query || {}) });
  } catch (error) {
    console.error("GET /api/employee-pay-slip/options error:", error);
    res
      .status(500)
      .json({ message: error.message || "Unable to load Pay Slip options." });
  }
});

/*
   GET /api/employee-pay-slip?month=&year=&sectionId=&instituteCode=
                             &billCodeId=&employeeId=

   Omitting employeeId returns every employee of the selection — the bulk
   print. The eligibility rules are enforced in SQL by the shared loader, so
   they hold no matter what the client sends.
*/
router.get("/", async (req, res) => {
  try {
    const query = req.query || {};
    if (!query.billCodeId && !(query.month && query.year)) {
      return res.status(400).json({
        message:
          "Select a Salary Month and Year, or a Bill, to generate a Pay Slip.",
      });
    }
    const data = await buildPaySlipReport(query);
    res.json({ message: "OK", data });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/employee-pay-slip error:", error);
    res
      .status(status)
      .json({ message: error.message || "Unable to generate the Pay Slip." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testEmployeePaySlip.js). */
module.exports.buildPaySlip = buildPaySlip;
module.exports.buildPaySlipReport = buildPaySlipReport;
module.exports.buildOptions = buildOptions;
module.exports.filterRows = filterRows;
module.exports.EARNING_LINES = EARNING_LINES;
module.exports.DEDUCTION_LINES = DEDUCTION_LINES;
module.exports.HEADING = HEADING;
module.exports.TITLE = TITLE;
