const express = require("express");
const { sql } = require("../db");
const { normalizeEmployeeType } = require("../utils/employeePayRules");
const { amountInWordsIndian } = require("../utils/amountInWords");

const router = express.Router();

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function moneyRound(n) {
  return Number(toNum(n).toFixed(2));
}

async function getBillByCode(billCode) {
  const code = String(billCode || "").trim();
  if (!code) return null;
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

async function writeViewAudit({ billCode, instituteId, instituteCode, userName, fullName }) {
  try {
    await sql.query`
      INSERT INTO dbo.AuditLogs
        (ModuleName, ActionName, EntityKey, Details, UserName, FullName, TableName, RecordId, NewValues)
      VALUES
        (
          N'FinalSalaryBill',
          N'VIEW',
          ${billCode},
          N'Final salary bill viewed/printed/exported (read-only)',
          ${userName || "SYSTEM"},
          ${fullName || userName || "SYSTEM"},
          N'SalaryBillCodes',
          ${billCode},
          ${JSON.stringify({
            billCode,
            instituteId,
            instituteCode,
            readOnly: true,
          })}
        )
    `;
  } catch (_) {
    /* optional */
  }
}

function mapEmployeeRow(row, otherEarnings) {
  const employeeType = row.EmployeeType || "";
  const typeNorm = normalizeEmployeeType(employeeType);
  const sedBasic = moneyRound(row.BasicPay);
  const basicPay = typeNorm === "FIX" ? 0 : sedBasic;

  return {
    salaryEmployeeDetailId: Number(row.Id),
    billCodeId: row.BillCodeId != null ? Number(row.BillCodeId) : null,
    billCode: row.RowBillCode || "",
    billMonth: row.RowBillMonth || "",
    employeeId: Number(row.EmployeeId),
    employeeCode: row.EmployeeCode || "",
    employeeName: row.EmployeeName || "",
    designation: row.Designation || "",
    employeeType,
    section: row.SectionName || "",
    displayOrder: Number(row.DisplayOrder) || 0,
    basicPay,
    gradePay: moneyRound(row.GradePay),
    da: moneyRound(row.DA),
    hra: moneyRound(row.HRA),
    ma: moneyRound(row.MA),
    ta: moneyRound(row.TA),
    specialAllowance: moneyRound(row.SpecialAllowance),
    washingAllowance: moneyRound(row.WashingAllowance),
    otherEarnings: moneyRound(otherEarnings),
    grossSalary: moneyRound(row.GrossSalary),
    gpfSubscription: moneyRound(row.GPFSubscription),
    gpfAdvance: moneyRound(row.GPFAdvance),
    nps: moneyRound(row.NPS),
    incomeTax: moneyRound(row.IncomeTax),
    professionalTax: moneyRound(row.ProfessionalTax),
    otherDeduction: moneyRound(row.OtherDeduction),
    totalDeduction: moneyRound(row.TotalDeduction),
    netSalary: moneyRound(row.NetSalary),
  };
}

function computeTotals(employees) {
  const sum = (key) =>
    moneyRound(employees.reduce((acc, row) => acc + toNum(row[key]), 0));

  const regularCount = employees.filter(
    (e) => normalizeEmployeeType(e.employeeType) === "REGULAR"
  ).length;
  const fixedCount = employees.filter(
    (e) => normalizeEmployeeType(e.employeeType) === "FIX"
  ).length;

  const totals = {
    basicPay: sum("basicPay"),
    da: sum("da"),
    hra: sum("hra"),
    ma: sum("ma"),
    ta: sum("ta"),
    specialAllowance: sum("specialAllowance"),
    washingAllowance: sum("washingAllowance"),
    otherEarnings: sum("otherEarnings"),
    grossSalary: sum("grossSalary"),
    gpfSubscription: sum("gpfSubscription"),
    gpfAdvance: sum("gpfAdvance"),
    nps: sum("nps"),
    incomeTax: sum("incomeTax"),
    professionalTax: sum("professionalTax"),
    otherDeduction: sum("otherDeduction"),
    totalDeduction: sum("totalDeduction"),
    netSalary: sum("netSalary"),
  };

  return {
    totals,
    counts: {
      totalEmployees: employees.length,
      regularEmployees: regularCount,
      fixedEmployees: fixedCount,
    },
    summary: {
      totalEmployees: employees.length,
      totalGrossSalary: totals.grossSalary,
      totalDeduction: totals.totalDeduction,
      totalNetSalary: totals.netSalary,
      amountInWords: amountInWordsIndian(totals.netSalary),
    },
  };
}

async function loadFinalBill({ billCode, instituteId, instituteCode }) {
  const bill = await getBillByCode(billCode);
  if (!bill) {
    const err = new Error("Bill Code was not found.");
    err.status = 404;
    throw err;
  }

  const institute = await getInstitute(instituteId, instituteCode);
  if (!institute) {
    const err = new Error("Institute was not found.");
    err.status = 404;
    throw err;
  }

  const status = String(bill.Status || "").toUpperCase();
  const isOpen = status === "OPEN";
  const canOfficialFinal = status === "COMPLETED" || status === "LOCKED";

  /*
    Salary Month is the controlling period: once a salary month is locked,
    its complete history is shown whatever Bill Month each payment record
    carries. Every non-archived Salary-category (non-Difference) bill code
    of the selected bill's (SalaryYear, SalaryMonthNumber) contributes its
    rows — the main bill AND its Bill-Month variants (e.g. JUN-2026 plus
    JUN-2026-BM-MAY and JUN-2026-BM-APR). Rows are never merged or
    overwritten merely because Bill Month differs; each keeps its own
    BillCode/BillMonth for traceability.
  */
  const sedResult = await sql.query`
    SELECT
      sed.*,
      e.EmployeeCode,
      s.SectionName,
      b.BillCode AS RowBillCode,
      b.BillMonth AS RowBillMonth
    FROM dbo.SalaryEmployeeDetails sed
    INNER JOIN dbo.SalaryBillCodes b
      ON b.BillCodeId = sed.SalaryBillCodeId
    LEFT JOIN dbo.EmployeeMaster e ON e.EmployeeId = sed.EmployeeId
    LEFT JOIN dbo.Sections s ON s.SectionId = e.SectionId
    WHERE LTRIM(RTRIM(b.SalaryYear)) = ${String(bill.SalaryYear || "").trim()}
      AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${Number(bill.SalaryMonthNumber)}
      AND UPPER(ISNULL(b.BillCategory, N'Salary')) = N'SALARY'
      AND UPPER(ISNULL(b.BillType, N'')) NOT LIKE N'%DIFFERENCE%'
      AND ISNULL(b.IsArchived, 0) = 0
      AND (
        sed.InstituteCode = ${institute.InstituteCode}
        OR (
          (sed.InstituteCode IS NULL OR sed.InstituteCode = N'')
          AND e.InstituteId = ${institute.InstituteId}
        )
      )
    ORDER BY
      b.BillCodeId,
      ISNULL(sed.DisplayOrder, 999999),
      sed.EmployeeName,
      sed.EmployeeId
  `;

  const detailIds = sedResult.recordset.map((r) => Number(r.Id)).filter(Boolean);
  const otherMap = new Map();

  if (detailIds.length) {
    /* Bulk load OTHER_EARNING from normalized components — no per-employee
       queries. Same salary-month scope as the detail rows above. */
    const otherRes = await sql.query`
      SELECT
        secd.SalaryEmployeeDetailId,
        SUM(ISNULL(secd.Amount, 0)) AS Amount
      FROM dbo.SalaryEmployeeComponentDetails secd
      INNER JOIN dbo.SalaryComponentMaster sc
        ON sc.SalaryComponentId = secd.SalaryComponentId
      INNER JOIN dbo.SalaryEmployeeDetails sed
        ON sed.Id = secd.SalaryEmployeeDetailId
      INNER JOIN dbo.SalaryBillCodes b
        ON b.BillCodeId = sed.SalaryBillCodeId
      WHERE LTRIM(RTRIM(b.SalaryYear)) = ${String(bill.SalaryYear || "").trim()}
        AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${Number(bill.SalaryMonthNumber)}
        AND UPPER(ISNULL(b.BillCategory, N'Salary')) = N'SALARY'
        AND UPPER(ISNULL(b.BillType, N'')) NOT LIKE N'%DIFFERENCE%'
        AND ISNULL(b.IsArchived, 0) = 0
        AND UPPER(sc.ComponentCode) IN (N'OTHER_EARNING', N'OTHER_EARNINGS')
        AND (
          sed.InstituteCode = ${institute.InstituteCode}
          OR sed.InstituteCode IS NULL
          OR sed.InstituteCode = N''
        )
      GROUP BY secd.SalaryEmployeeDetailId
    `;
    for (const row of otherRes.recordset) {
      otherMap.set(Number(row.SalaryEmployeeDetailId), toNum(row.Amount));
    }
  }

  const employees = sedResult.recordset.map((row) =>
    mapEmployeeRow(row, otherMap.get(Number(row.Id)) || 0)
  );

  const { totals, counts, summary } = computeTotals(employees);

  const salaryMonthLabel =
    bill.BillCode ||
    (bill.SalaryMonth && bill.SalaryYear
      ? `${String(bill.SalaryMonth).split("-")[0].toUpperCase()}-${bill.SalaryYear}`
      : bill.SalaryMonth) ||
    "";

  return {
    readOnly: true,
    officialFinal: canOfficialFinal,
    warning: isOpen
      ? "Salary bill is still OPEN. Complete the bill before generating the final bill."
      : null,
    message: isOpen
      ? "Bill is OPEN. Final bill is not available until the bill is completed."
      : employees.length
        ? "OK"
        : "No salary data found for the selected Bill Code and Institute.",
    bill: {
      billCodeId: Number(bill.BillCodeId),
      billCode: bill.BillCode,
      salaryMonth: bill.SalaryMonth,
      salaryMonthLabel,
      salaryYear: bill.SalaryYear,
      status: bill.Status,
      billCategory: bill.BillCategory,
      billType: bill.BillType,
      description: bill.Description || "",
      completedDate: bill.CompletedDate,
      lockedDate: bill.LockedDate,
    },
    institute: {
      instituteId: Number(institute.InstituteId),
      instituteCode: institute.InstituteCode,
      instituteName: institute.InstituteName,
      instituteDistrict: institute.InstituteDistrict || "",
      cityClass: institute.CityClass || "",
    },
    generatedDate: new Date().toISOString(),
    employees,
    totals,
    counts,
    summary,
    hasData: employees.length > 0,
  };
}

/*
 * GET /api/salary-bill/institutes?salaryYear=&salaryMonthNumber=
 * Distinct institutes holding salary rows in a salary month (read-only).
 * Used by the Final Salary Bill screen to offer only the institutes
 * applicable to the selected locked salary month. Must stay above
 * GET /:billCode so the literal segment is not treated as a bill code.
 */
router.get("/institutes", async (req, res) => {
  try {
    const salaryYear = String(req.query.salaryYear || "").trim();
    const salaryMonthNumber = Number(req.query.salaryMonthNumber);
    if (!salaryYear || !Number.isFinite(salaryMonthNumber)) {
      return res.status(400).json({ message: "Salary Year and Salary Month are required." });
    }
    const result = await sql.query`
      SELECT DISTINCT
        i.InstituteId,
        i.InstituteCode,
        i.InstituteName
      FROM dbo.SalaryEmployeeDetails sed
      INNER JOIN dbo.SalaryBillCodes b
        ON b.BillCodeId = sed.SalaryBillCodeId
      INNER JOIN dbo.Institutes i
        ON i.InstituteCode = sed.InstituteCode
      WHERE LTRIM(RTRIM(b.SalaryYear)) = ${salaryYear}
        AND TRY_CAST(b.SalaryMonthNumber AS INT) = ${salaryMonthNumber}
        AND UPPER(ISNULL(b.BillCategory, N'Salary')) = N'SALARY'
        AND UPPER(ISNULL(b.BillType, N'')) NOT LIKE N'%DIFFERENCE%'
        AND ISNULL(b.IsArchived, 0) = 0
      ORDER BY i.InstituteCode
    `;
    res.json({
      message: "OK",
      data: result.recordset.map((row) => ({
        instituteId: Number(row.InstituteId),
        instituteCode: row.InstituteCode || "",
        instituteName: row.InstituteName || "",
      })),
    });
  } catch (error) {
    console.error("GET /api/salary-bill/institutes error:", error);
    res.status(500).json({ message: "Unable to load institutes for the salary month." });
  }
});

/* GET /api/salary-bill/:billCode?instituteId=&instituteCode= */
router.get("/:billCode", async (req, res) => {
  try {
    const billCode = String(req.params.billCode || "").trim();
    const instituteId = req.query.instituteId;
    const instituteCode = req.query.instituteCode;

    if (!billCode) {
      return res.status(400).json({ message: "Salary Bill Code is required." });
    }
    if (!instituteId && !instituteCode) {
      return res.status(400).json({ message: "Institute is required." });
    }

    const data = await loadFinalBill({
      billCode,
      instituteId,
      instituteCode,
    });

    const userName = req.query.userName || req.headers["x-user-name"] || "SYSTEM";
    const fullName = req.query.fullName || req.headers["x-full-name"] || userName;

    /* Audit view only — never mutates salary/bill tables. */
    await writeViewAudit({
      billCode: data.bill.billCode,
      instituteId: data.institute.instituteId,
      instituteCode: data.institute.instituteCode,
      userName,
      fullName,
    });

    if (!data.hasData && data.officialFinal) {
      return res.status(200).json({
        message: data.message,
        ...data,
      });
    }

    res.json({
      message: data.message,
      ...data,
    });
  } catch (error) {
    console.error("GET /api/salary-bill/:billCode error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to load final salary bill.",
      error: error.message,
    });
  }
});

module.exports = router;
module.exports.loadFinalBill = loadFinalBill;
module.exports.amountInWordsIndian = amountInWordsIndian;
