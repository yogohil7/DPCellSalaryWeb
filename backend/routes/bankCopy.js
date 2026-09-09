/**
 * BANK COPY
 *
 * The payment instruction the department hands to the bank: one credit per
 * employee for that employee's NET SALARY, plus one credit per institute for
 * that institute's Professional Tax + Income Tax total.
 *
 * Nothing here recalculates salary. Every amount is read from the stored,
 * approved dbo.SalaryEmployeeDetails row — the same row Salary Bill Approval
 * displays — and the eligibility, month and ordering rules are the ones the
 * Cheque Register already uses, imported rather than copied:
 *
 *   APPROVED_WORKFLOW_STATUSES  which bills may appear at all
 *   compareGroupCodes           natural Institute Code ordering
 *   normalizeYearMonth /        Bill Month vs Salary Month handling
 *   matchesFilterMonthYear
 */

const express = require("express");
const { sql } = require("../db");
const {
  normalizeYearMonth,
  matchesFilterMonthYear,
} = require("../utils/salaryMonthKey");
const {
  APPROVED_WORKFLOW_STATUSES,
  compareGroupCodes,
  salaryMonthPartsOf,
} = require("./chequeRegister");

const {
  CATEGORY_REGULAR,
  CATEGORY_DA_DIFFERENCE,
  excludedScopeNote,
  loadDaDifferenceRows,
} = require("../utils/salaryCategory");

const router = express.Router();

const HEADING = [
  "BANK COPY",
  "DIRECTOR OF SOCIAL DEFENCE",
  "BLOCK NO. 16 OLD SACHIVALAY,",
  "GANDHINAGAR",
];

/*
  The DA Difference payment file is a SEPARATE instruction to the bank, so its
  title says so. Only the first line differs; the department block, the five
  columns and the layout are identical.
*/
const DA_HEADING = [
  "DA DIFFERENCE BANK COPY",
  ...HEADING.slice(1),
];

/* The two payment outputs. Anything else normalises to REGULAR. */
const PAYMENT_REGULAR = CATEGORY_REGULAR;
const PAYMENT_DA_DIFFERENCE = CATEGORY_DA_DIFFERENCE;

/**
 * Which payment file is being produced.
 *
 * REGULAR is the default so every existing caller — and the .xlsx export of
 * an older bookmarked URL — keeps its current behaviour untouched. An
 * unrecognised value is normalised to REGULAR rather than rejected, matching
 * how the other filters on this route treat unusable input.
 */
function parsePaymentType(query = {}) {
  const raw = String(query.paymentType || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (raw === PAYMENT_DA_DIFFERENCE) return PAYMENT_DA_DIFFERENCE;
  return PAYMENT_REGULAR;
}
const SCHEME_LINE = "CORE BANKING UNDER CORPORATE SALARY PACKAGE SCHEME";

/* Spelled out for the heading line, e.g. "JULY 2026". */
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

/**
 * Approved employee salary rows for the period.
 *
 * DA Difference bills are excluded: a Bank Copy pays salary, and the DA
 * arrears bill is a separate payment with its own register entry.
 */
async function loadApprovedSalaryRows() {
  const result = await sql.query`
    SELECT
      b.BillCodeId,
      b.BillCode,
      b.BillMonth,
      b.SalaryMonth,
      b.SalaryMonthNumber,
      b.SalaryYear,
      w.InstituteCode,
      w.Status               AS WorkflowStatus,
      i.InstituteId,
      i.InstituteName,
      i.SectionId,
      sec.SrNo               AS SectionSrNo,
      sec.SectionName,
      i.BankAccountNumber    AS InstituteBankAccount,
      d.Id                   AS SalaryEmployeeDetailId,
      d.EmployeeId,
      d.EmployeeName,
      d.DisplayOrder,
      d.NetSalary,
      d.IncomeTax,
      d.ProfessionalTax,
      e.EmployeeCode,
      e.BankAccountNumber    AS EmployeeBankAccount
    FROM dbo.SalaryBillInstituteWorkflow w
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = w.SalaryBillCodeId
    INNER JOIN dbo.SalaryEmployeeDetails d
      ON d.SalaryBillCodeId = w.SalaryBillCodeId
     AND d.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Institutes i
      ON i.InstituteCode = w.InstituteCode
    LEFT JOIN dbo.Sections sec
      ON sec.SectionId = i.SectionId
    LEFT JOIN dbo.EmployeeMaster e
      ON e.EmployeeId = d.EmployeeId
    WHERE UPPER(LTRIM(RTRIM(w.Status))) IN (N'APPROVED', N'LOCKED')
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
      AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
      AND ISNULL(b.IsArchived, 0) = 0
    ORDER BY w.InstituteCode, d.DisplayOrder, d.Id
  `;
  return result.recordset;
}

/**
 * Keeps only rows the Bank Copy may pay.
 *
 * The month filter is the SALARY MONTH — the same rule the Cheque Register
 * applies — so every approved bill of that salary month is paid together
 * however many Bill Months it spans. (An earlier version of this comment said
 * BILL MONTH; that was wrong. The executable logic below has always resolved
 * the salary month and is unchanged.)
 */
function filterBankCopyRows(rows, query) {
  const month =
    query.month != null && query.month !== "" ? Number(query.month) : null;
  const year =
    query.year != null && query.year !== "" ? Number(query.year) : null;
  const sectionId =
    query.sectionId != null && query.sectionId !== ""
      ? Number(query.sectionId)
      : null;

  return rows.filter((row) => {
    const status = String(row.WorkflowStatus || "").trim().toUpperCase();
    if (!APPROVED_WORKFLOW_STATUSES.has(status)) return false;

    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.SectionId) !== sectionId) return false;
    }

    if (month != null && year != null) {
      /*
         Selected by SALARY MONTH, the same rule the Cheque Register uses, so
         every approved bill of that salary month is paid together however
         many Bill Months it spans (JUN-2026, JUN-2026-BM-MAY, JUN-2026-BM-APR
         are all salary month June).
      */
      const salaryParts = salaryMonthPartsOf(
        row.SalaryMonth,
        row.SalaryYear,
        row.SalaryMonthNumber
      );
      if (!matchesFilterMonthYear(salaryParts, month, year)) return false;
    }

    return true;
  });
}

/**
 * Section order, then institute number.
 *
 * Level 1 is the Section Master's own ordering (dbo.Sections.SrNo, then
 * SectionId to break a tie) — the same order the Section Master screen
 * shows, so BD, DD, OGE, CPD come out in the order the department keeps
 * them rather than alphabetically. An institute with no section sorts last.
 *
 * Level 2 is the existing natural code comparison inside that section, so
 * CPD-06 < CPD-17 < CPD-25 < CPD-100 rather than lexical order.
 *
 * The institute's CODE is never inspected to decide its section.
 */
function sectionRank(group) {
  const raw = group?.sectionSrNo;
  /*
     null/undefined/"" mean "no SrNo recorded" and must fall in BEHIND every
     section that has one. Number(null) is 0, so the emptiness is checked
     before the conversion — otherwise a section-less institute would sort
     ahead of SrNo 1.
  */
  if (raw == null || raw === "") return Number.MAX_SAFE_INTEGER;
  const srNo = Number(raw);
  return Number.isFinite(srNo) ? srNo : Number.MAX_SAFE_INTEGER;
}

function compareInstituteGroups(a, b) {
  const rank = sectionRank(a) - sectionRank(b);
  if (rank !== 0) return rank < 0 ? -1 : 1;

  const rawA = a?.sectionId;
  const rawB = b?.sectionId;
  const idA = rawA == null || rawA === "" ? NaN : Number(rawA);
  const idB = rawB == null || rawB === "" ? NaN : Number(rawB);
  const aHas = Number.isFinite(idA);
  const bHas = Number.isFinite(idB);
  if (aHas && bHas && idA !== idB) return idA < idB ? -1 : 1;
  if (aHas !== bHas) return aHas ? -1 : 1;

  return compareGroupCodes(a.code, b.code);
}

/**
 * Builds the printable rows.
 *
 * Institutes are ordered naturally by Institute Code (CPD-06, CPD-17, CPD-25,
 * CPD-100), employees keep the order the salary bill already gave them, and
 * Sr. No. is handed out only once the whole list is in its final order.
 */
function buildBankCopyRows(salaryRows) {
  const byInstitute = new Map();

  for (const row of salaryRows) {
    const code = String(row.InstituteCode || "").trim();
    if (!byInstitute.has(code)) {
      byInstitute.set(code, {
        code,
        /*
           Section ordering comes from dbo.Sections.SrNo — the same column
           routes/sections.js orders the Section Master by. The institute's
           code is never parsed to work out its section.
        */
        sectionSrNo: row.SectionSrNo,
        sectionId: row.SectionId,
        sectionName: row.SectionName || "",
        instituteName: row.InstituteName || code,
        instituteBankAccount: row.InstituteBankAccount || "",
        /* Keyed by EmployeeId so one employee is one credit. */
        employees: new Map(),
        taxTotal: 0,
      });
    }
    const group = byInstitute.get(code);

    /*
       One salary month can hold several bills, and the same employee can
       legitimately appear in more than one of them (a JUN-2026 bill and a
       JUN-2026-BM-MAY bill, say). Each of those is a real amount owed, so
       they are ADDED into a single credit for that employee rather than one
       overwriting the other: dropping a bill would underpay, and printing the
       employee twice would look like a duplicate instruction to the bank.
       Identity is the salary row's own (InstituteCode, EmployeeId).
    */
    const employeeId = Number(row.EmployeeId);
    const existing = group.employees.get(employeeId);
    if (existing) {
      existing.amount = round2(existing.amount + toNum(row.NetSalary));
      existing.sourceBillCodes.push(row.BillCode);
      /* Keep the earliest position the employee holds in any of the bills. */
      existing.displayOrder = Math.min(
        existing.displayOrder,
        toNum(row.DisplayOrder)
      );
    } else {
      group.employees.set(employeeId, {
        type: "EMPLOYEE",
        code,
        employeeId,
        employeeCode: row.EmployeeCode || "",
        name: row.EmployeeName || "",
        bankAccount: row.EmployeeBankAccount || "",
        /* Paid NET SALARY — never gross, never cheque amount. */
        amount: round2(row.NetSalary),
        displayOrder: toNum(row.DisplayOrder),
        sourceBillCodes: [row.BillCode],
        salaryMonth: row.SalaryMonth,
      });
    }

    /*
       The institute's credit accumulates across EVERY applicable row, so a
       salary month spanning several bills contributes all of their tax.
    */
    group.taxTotal = round2(
      group.taxTotal + toNum(row.ProfessionalTax) + toNum(row.IncomeTax)
    );
  }

  const ordered = [...byInstitute.values()].sort(compareInstituteGroups);

  /*
     Inside an institute the salary bill's own DisplayOrder decides the order,
     the same sequence Salary Entry and Salary Approval show. The SQL already
     returns rows this way; sorting here as well keeps the function correct on
     its own rather than depending on the caller's ordering.
  */
  for (const group of ordered) {
    group.employeeRows = [...group.employees.values()].sort(
      (a, b) => toNum(a.displayOrder) - toNum(b.displayOrder)
    );
  }

  const flat = [];
  for (const group of ordered) {
    /*
       The institute's own credit is its Professional Tax + Income Tax total
       across every employee of that institute. A zero total is not a payment,
       so no instruction is emitted for it.
    */
    if (group.taxTotal > 0) {
      flat.push({
        type: "INSTITUTE",
        code: group.code,
        name: group.instituteName,
        bankAccount: group.instituteBankAccount,
        amount: group.taxTotal,
      });
    }
    flat.push(...group.employeeRows);
  }

  /*
     Sr. No. over EVERY payment line, once the order is final.

     An institute row is a real credit to the bank — the institute's own
     Professional Tax + Income Tax total — so it is numbered alongside the
     employee credits and the serial is a dense 1..n over all of them. The
     TOTAL line is a summary, not a payment, and stays unnumbered.
  */
  let srNo = 1;
  return flat.map((row) => ({ ...row, srNo: srNo++ }));
}

/**
 * Approved/locked DA Difference employee rows.
 *
 * The shared loader in utils/salaryCategory.js is reused rather than copied,
 * so the DA Bank Copy sees exactly the rows every other DA-aware report sees.
 * That loader already excludes archived bills in SQL
 * (WHERE ISNULL(c.IsArchived, 0) = 0); the workflow status is applied here
 * with the same APPROVED_WORKFLOW_STATUSES set the regular path uses.
 */
async function loadApprovedDaRows() {
  const rows = await loadDaDifferenceRows();
  return rows.filter((row) =>
    APPROVED_WORKFLOW_STATUSES.has(
      String(row.workflowStatus || "").trim().toUpperCase()
    )
  );
}

/**
 * Narrows DA rows to the selected period and section.
 *
 * Identical rules to the regular path: SALARY MONTH (for a DA bill that is
 * the month the difference is paid in, which the shared loader already
 * resolves into salaryMonthIndex/salaryMonthKey), plus the optional section.
 */
function filterDaBankCopyRows(rows, query) {
  const month =
    query.month != null && query.month !== "" ? Number(query.month) : null;
  const year =
    query.year != null && query.year !== "" ? Number(query.year) : null;
  const sectionId =
    query.sectionId != null && query.sectionId !== ""
      ? Number(query.sectionId)
      : null;

  return rows.filter((row) => {
    if (!APPROVED_WORKFLOW_STATUSES.has(row.workflowStatus)) return false;

    if (sectionId != null && Number.isFinite(sectionId)) {
      if (Number(row.sectionId) !== sectionId) return false;
    }

    if (month != null && year != null) {
      /*
         Resolve the ROW's own payment month and nothing else. The selected
         month/year must never be passed as fallbacks here: normalizeYearMonth
         short-circuits on an explicit month+year, which would make every row
         resolve to the selected period and match unconditionally.
      */
      const parts = normalizeYearMonth(row.salaryMonthKey);
      if (!matchesFilterMonthYear(parts, month, year)) return false;
    }

    return true;
  });
}

/**
 * Builds the DA Difference payment rows.
 *
 * Ordering and numbering are the regular path's own — section rank, then
 * natural institute code, then the bill's DisplayOrder, with Sr. No. handed
 * out only once the list is final. Grouping is by (InstituteCode, EmployeeId)
 * so one employee is one credit, exactly as for salary.
 *
 * There is NO institute line. dbo.DADifferenceEmployeeDetails has no
 * ProfessionalTax and no IncomeTax column, so a DA institute credit would
 * have to be invented — a regular-salary figure carried over, or a fabricated
 * zero. Neither is a real payment, so the DA file is employee rows only.
 */
function buildDaBankCopyRows(daRows) {
  const byInstitute = new Map();

  for (const row of daRows) {
    const code = String(row.instituteCode || "").trim();
    if (!byInstitute.has(code)) {
      byInstitute.set(code, {
        code,
        sectionSrNo: row.sectionSrNo,
        sectionId: row.sectionId,
        sectionName: row.sectionName || "",
        instituteName: row.instituteName || code,
        employees: new Map(),
      });
    }
    const group = byInstitute.get(code);

    const employeeId = Number(row.employeeId);
    const existing = group.employees.get(employeeId);
    if (existing) {
      /*
         Same aggregation rule as salary: several applicable DA bills in one
         payment month are one credit for the employee, never two lines.
      */
      existing.amount = round2(existing.amount + toNum(row.net));
      existing.sourceBillCodes.push(row.billCode);
      existing.displayOrder = Math.min(
        existing.displayOrder,
        toNum(row.displayOrder)
      );
    } else {
      group.employees.set(employeeId, {
        type: "EMPLOYEE",
        code,
        employeeId,
        employeeCode: row.employeeCode || "",
        name: row.employeeName || "",
        bankAccount: row.bankAccount || "",
        /*
           The stored TotalNetDifferenceAmount — the amount actually payable
           after the DA NPS deduction. Never TotalDifferenceAmount (the
           gross), never a salary NetSalary, never a fabricated figure.
        */
        amount: round2(row.net),
        displayOrder: toNum(row.displayOrder),
        sourceBillCodes: [row.billCode],
        salaryMonth: row.salaryMonth,
      });
    }
  }

  const ordered = [...byInstitute.values()].sort(compareInstituteGroups);
  for (const group of ordered) {
    group.employeeRows = [...group.employees.values()].sort(
      (a, b) => toNum(a.displayOrder) - toNum(b.displayOrder)
    );
  }

  const flat = [];
  for (const group of ordered) flat.push(...group.employeeRows);

  /*
     An employee whose FINAL payable is 0.00 or less is not a payment, so no
     instruction is sent to the bank for them.

     This runs AFTER aggregation on purpose. Several DA bills can fall in one
     payment month and can offset each other; dropping individual bill rows
     first would discard a negative correction before it could cancel the
     amount it corrects, and the bank would be paid money that is not owed.
     Aggregating first and testing the total is the only safe order.

     It also runs BEFORE Sr. No. is assigned, so the serial stays a dense
     1..n with no gaps where a row was removed.
  */
  const payable = flat.filter((row) => toNum(row.amount) > 0);

  /* Sr. No. only once the order is final, over employee rows only. */
  let empNo = 1;
  return payable.map((row) => ({ ...row, srNo: empNo++ }));
}

async function buildBankCopyReport(query) {
  const month = query.month;
  const year = query.year;
  if (month == null || month === "" || year == null || year === "") {
    const err = new Error("Month and Year are required to show the Bank Copy.");
    err.status = 400;
    throw err;
  }

  const paymentType = parsePaymentType(query);
  const isDa = paymentType === PAYMENT_DA_DIFFERENCE;

  /*
     Two separate payment files. The regular path below is byte-for-byte the
     one that has always run; the DA path never touches it. The same employee
     may legitimately appear in both files — they are different payments — and
     no amount is ever combined across the two.
  */
  const rows = isDa
    ? buildDaBankCopyRows(
        filterDaBankCopyRows(await loadApprovedDaRows(), query)
      )
    : buildBankCopyRows(
        filterBankCopyRows(await loadApprovedSalaryRows(), query)
      );

  /* The total is the sum of what is displayed — nothing is re-derived. */
  const total = round2(rows.reduce((sum, row) => sum + toNum(row.amount), 0));

  /*
     The month shown in the heading is the BILL MONTH the user selected — the
     month the bills are passed and paid — spelled out the way the printed
     form does it ("JULY 2026"), not the short JUL-2026 code.
  */
  const monthParts = normalizeYearMonth(
    `${year}-${String(month).padStart(2, "0")}`,
    year,
    month
  );
  const monthLabel = monthParts
    ? `${MONTH_FULL_NAMES[monthParts.month - 1]} ${monthParts.year}`
    : `${month}-${year}`;

  return {
    heading: isDa ? DA_HEADING : HEADING,
    paymentType,
    paymentTypeLabel: isDa
      ? "DA Difference Bank Copy"
      : "Regular Salary Bank Copy",
    /* The scope of each file is stated explicitly, never left implied. */
    salaryCategoryScope: isDa
      ? excludedScopeNote(
          "Regular and Old Salary are not part of the DA Difference bank payment"
        )
      : excludedScopeNote(
          "DA Difference is not part of the salary bank payment"
        ),
    monthLine: isDa
      ? `DA DIFFERENCE PAYMENT FOR THE MONTH OF  ${monthLabel}`
      : `SALARY PAYMENT FOR THE MONTH OF  ${monthLabel}`,
    schemeLine: SCHEME_LINE,
    monthLabel,
    rows,
    total,
    rowCount: rows.length,
    employeeCount: rows.filter((r) => r.type === "EMPLOYEE").length,
    instituteCount: rows.filter((r) => r.type === "INSTITUTE").length,
    filters: {
      month: Number(month),
      year: Number(year),
      paymentType,
      sectionId: query.sectionId != null && query.sectionId !== ""
        ? Number(query.sectionId)
        : null,
    },
  };
}

/* GET /api/bank-copy?month=&year=&sectionId= */
router.get("/", async (req, res) => {
  try {
    const data = await buildBankCopyReport(req.query || {});
    res.json({ message: "OK", data });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/bank-copy error:", error);
    res.status(status).json({ message: error.message || "Bank Copy failed." });
  }
});

/* The five printed columns, in order — exact labels as per the bank copy spec. */
const XLSX_COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "code", label: "CODE" },
  { key: "name", label: "EMPLOYEE NAME" },
  { key: "bankAccount", label: "BANK ACCOUNT NUMBER" },
  { key: "amount", label: "AMOUNT", type: "number" },
];

/* GET /api/bank-copy/export.xlsx — same builder, so it cannot drift. */
router.get("/export.xlsx", async (req, res) => {
  try {
    const XLSX = require("xlsx");
    const data = await buildBankCopyReport(req.query || {});

    const heading = [
      ...data.heading.map((line) => [line]),
      [data.monthLine],
      [data.schemeLine],
      [],
    ];
    const header = XLSX_COLUMNS.map((c) => c.label);
    const body = data.rows.map((row) =>
      XLSX_COLUMNS.map((column) => {
        const value = row[column.key];
        if (column.type === "number") return Number(value || 0);
        return value == null ? "" : String(value);
      })
    );

    /* TOTAL sits under EMPLOYEE NAME; Sr. No., CODE and BANK A/c stay blank. */
    const totalsRow = [];
    if (data.rows.length > 0) {
      XLSX_COLUMNS.forEach((column) => {
        if (column.key === "name") totalsRow.push("TOTAL");
        else if (column.type === "number") totalsRow.push(Number(data.total));
        else totalsRow.push("");
      });
    }

    const sheet = XLSX.utils.aoa_to_sheet([
      ...heading,
      header,
      ...body,
      ...(totalsRow.length ? [totalsRow] : []),
    ]);
    sheet["!cols"] = [
      { wch: 8 },
      { wch: 14 },
      { wch: 52 },
      { wch: 20 },
      { wch: 14 },
    ];

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      sheet,
      data.paymentType === PAYMENT_DA_DIFFERENCE ? "DA Difference" : "Bank Copy"
    );
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const prefix =
      data.paymentType === PAYMENT_DA_DIFFERENCE
        ? "DA_Difference_Bank_Copy"
        : "Bank_Copy";
    const fileName = `${prefix}_${data.monthLabel.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("GET /api/bank-copy/export.xlsx error:", error);
    res.status(status).json({ message: error.message || "Bank Copy export failed." });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testBankCopy.js). */
module.exports.buildBankCopyRows = buildBankCopyRows;
module.exports.compareInstituteGroups = compareInstituteGroups;
module.exports.filterBankCopyRows = filterBankCopyRows;
module.exports.buildBankCopyReport = buildBankCopyReport;
module.exports.XLSX_COLUMNS = XLSX_COLUMNS;
module.exports.HEADING = HEADING;
module.exports.DA_HEADING = DA_HEADING;
module.exports.parsePaymentType = parsePaymentType;
module.exports.buildDaBankCopyRows = buildDaBankCopyRows;
module.exports.filterDaBankCopyRows = filterDaBankCopyRows;
module.exports.PAYMENT_REGULAR = PAYMENT_REGULAR;
module.exports.PAYMENT_DA_DIFFERENCE = PAYMENT_DA_DIFFERENCE;
module.exports.SCHEME_LINE = SCHEME_LINE;
