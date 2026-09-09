/**
 * Shared Salary Entry ↔ Variation Report field catalog and report builder.
 * Keep aligned with Salary Entry employee grid / SalaryEmployeeDetails.
 */
const { sql } = require("../db");
const { calculateChequeAmount } = require("./salaryBasicCalc");

function moneyRound(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/** Salary Entry component fields used by Variation Report (Prev/Curr/Var). */
const VARIATION_COMPONENT_FIELDS = [
  { key: "basicPay", label: "Basic Pay", group: "EARNING" },
  { key: "fixBasic", label: "FIX Basic", group: "EARNING" },
  { key: "totalBasicPay", label: "Total Basic Pay", group: "EARNING" },
  { key: "da", label: "DA", group: "EARNING" },
  { key: "hra", label: "HRA", group: "EARNING" },
  { key: "ma", label: "MA", group: "EARNING" },
  { key: "ta", label: "TA", group: "EARNING" },
  { key: "cla", label: "CLA", group: "EARNING" },
  { key: "specialAllowance", label: "Special Allowance", group: "EARNING" },
  { key: "washingAllowance", label: "Washing Allowance", group: "EARNING" },
  { key: "otherEarnings", label: "Other Earnings", group: "EARNING" },
  { key: "nppa", label: "NPPA", group: "EARNING" },
  { key: "grossSalary", label: "Gross Amount", group: "TOTAL" },
  { key: "gpfSubscription", label: "GPF Amount", group: "DEDUCTION" },
  { key: "gpfAdvance", label: "GPF Advance", group: "DEDUCTION" },
  { key: "nps", label: "NPS", group: "DEDUCTION" },
  { key: "incomeTax", label: "IT Tax", group: "DEDUCTION" },
  { key: "professionalTax", label: "P.Tax", group: "DEDUCTION" },
  { key: "otherDeduction", label: "Other Deduction", group: "DEDUCTION" },
  { key: "totalDeduction", label: "Total Deduction", group: "TOTAL" },
  { key: "netSalary", label: "Net Salary", group: "TOTAL" },
  { key: "chequeAmount", label: "Cheque Amount", group: "TOTAL" },
];

function emptyAmounts() {
  const row = {};
  for (const field of VARIATION_COMPONENT_FIELDS) {
    row[field.key] = 0;
  }
  return row;
}

function mapSedAmounts(row) {
  const basicPay = moneyRound(row.BasicPay);
  const fixBasic = moneyRound(row.GradePay);
  const totalBasicPay =
    moneyRound(row.TotalBasic) || moneyRound(basicPay + fixBasic);
  const grossSalary = moneyRound(row.GrossSalary);
  const totalDeduction = moneyRound(row.TotalDeduction);
  const netSalary = moneyRound(row.NetSalary);
  const incomeTax = moneyRound(row.IncomeTax);
  const professionalTax = moneyRound(row.ProfessionalTax);
  const chequeAmount = calculateChequeAmount({
    netSalary,
    incomeTax,
    professionalTax,
  });
  return {
    employeeId: Number(row.EmployeeId),
    employeeCode:
      row.EmployeeCode != null && String(row.EmployeeCode).trim() !== ""
        ? String(row.EmployeeCode)
        : String(row.EmployeeId || ""),
    employeeName: row.EmployeeName || "",
    designation: row.Designation || "",
    employeeType: row.EmployeeType || "",
    pension: row.PensionType || "",
    basicPay,
    fixBasic,
    gradePay: fixBasic,
    totalBasicPay,
    totalBasic: totalBasicPay,
    da: moneyRound(row.DA),
    hra: moneyRound(row.HRA),
    ma: moneyRound(row.MA),
    ta: moneyRound(row.TA),
    cla: moneyRound(row.CLA),
    specialAllowance: moneyRound(row.SpecialAllowance),
    washingAllowance: moneyRound(row.WashingAllowance),
    otherEarnings: moneyRound(row.OtherEarnings),
    nppa: moneyRound(row.NPPA),
    grossSalary,
    grossAmount: grossSalary,
    gpfSubscription: moneyRound(row.GPFSubscription),
    gpfAdvance: moneyRound(row.GPFAdvance),
    nps: moneyRound(row.NPS),
    incomeTax,
    professionalTax,
    professionTax: professionalTax,
    otherDeduction: moneyRound(row.OtherDeduction),
    totalDeduction,
    netSalary,
    chequeAmount,
  };
}

async function getBillByCode(billCode) {
  const result = await sql.query`
    SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${billCode}
  `;
  return result.recordset[0] || null;
}

async function getInstitute(instituteCode) {
  const result = await sql.query`
    SELECT TOP 1 InstituteId, InstituteCode, InstituteName
    FROM dbo.Institutes
    WHERE InstituteCode = ${String(instituteCode || "").trim()}
  `;
  return result.recordset[0] || null;
}

/**
 * Previous salary-month bill (by SalaryYear + SalaryMonthNumber), not Bill Month.
 * Prefer Regular Salary bills when current is regular; keep DA Diff among DA Diff.
 */
async function findPreviousSalaryMonthBill(currentBill) {
  const isDiff =
    String(currentBill.BillCategory || "").toUpperCase() === "DIFFERENCE" ||
    String(currentBill.BillType || "").toUpperCase() === "DA DIFFERENCE";

  const result = isDiff
    ? await sql.query`
        SELECT TOP 1 b.BillCode, b.BillCodeId, b.BillMonth, b.SalaryMonth,
               b.SalaryMonthNumber, b.SalaryYear, b.BillCategory, b.BillType
        FROM dbo.SalaryBillCodes b
        WHERE b.BillCodeId <> ${Number(currentBill.BillCodeId)}
          AND (
            UPPER(ISNULL(b.BillCategory, N'')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          )
          AND (
            (ISNULL(b.SalaryYear, N'') < ISNULL(${currentBill.SalaryYear}, N''))
            OR (
              ISNULL(b.SalaryYear, N'') = ISNULL(${currentBill.SalaryYear}, N'')
              AND ISNULL(TRY_CONVERT(INT, b.SalaryMonthNumber), 0)
                < ISNULL(TRY_CONVERT(INT, ${currentBill.SalaryMonthNumber}), 0)
            )
            OR (
              ISNULL(b.SalaryYear, N'') = ISNULL(${currentBill.SalaryYear}, N'')
              AND ISNULL(TRY_CONVERT(INT, b.SalaryMonthNumber), 0)
                = ISNULL(TRY_CONVERT(INT, ${currentBill.SalaryMonthNumber}), 0)
              AND b.BillCodeId < ${Number(currentBill.BillCodeId)}
            )
          )
        ORDER BY
          ISNULL(b.SalaryYear, N'') DESC,
          ISNULL(TRY_CONVERT(INT, b.SalaryMonthNumber), 0) DESC,
          b.BillCodeId DESC
      `
    : await sql.query`
        SELECT TOP 1 b.BillCode, b.BillCodeId, b.BillMonth, b.SalaryMonth,
               b.SalaryMonthNumber, b.SalaryYear, b.BillCategory, b.BillType
        FROM dbo.SalaryBillCodes b
        WHERE b.BillCodeId <> ${Number(currentBill.BillCodeId)}
          AND UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
          AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
          AND (
            (ISNULL(b.SalaryYear, N'') < ISNULL(${currentBill.SalaryYear}, N''))
            OR (
              ISNULL(b.SalaryYear, N'') = ISNULL(${currentBill.SalaryYear}, N'')
              AND ISNULL(TRY_CONVERT(INT, b.SalaryMonthNumber), 0)
                < ISNULL(TRY_CONVERT(INT, ${currentBill.SalaryMonthNumber}), 0)
            )
            OR (
              ISNULL(b.SalaryYear, N'') = ISNULL(${currentBill.SalaryYear}, N'')
              AND ISNULL(TRY_CONVERT(INT, b.SalaryMonthNumber), 0)
                = ISNULL(TRY_CONVERT(INT, ${currentBill.SalaryMonthNumber}), 0)
              AND b.BillCodeId < ${Number(currentBill.BillCodeId)}
            )
          )
        ORDER BY
          ISNULL(b.SalaryYear, N'') DESC,
          ISNULL(TRY_CONVERT(INT, b.SalaryMonthNumber), 0) DESC,
          b.BillCodeId DESC
      `;
  return result.recordset[0] || null;
}

async function loadInstituteSalaryRows(billCodeId, instituteCode) {
  const result = await sql.query`
    SELECT
      d.*,
      e.EmployeeCode
    FROM dbo.SalaryEmployeeDetails d
    LEFT JOIN dbo.EmployeeMaster e ON e.EmployeeId = d.EmployeeId
    WHERE d.SalaryBillCodeId = ${Number(billCodeId)}
      AND d.InstituteCode = ${String(instituteCode || "").trim()}
    ORDER BY ISNULL(d.DisplayOrder, 9999), d.EmployeeId
  `;
  return (result.recordset || []).map(mapSedAmounts);
}

function buildComparisonRows(currentRows, previousMap) {
  const byId = new Map();

  for (const curr of currentRows) {
    const id = Number(curr.employeeId);
    const prev = previousMap.get(id) || {
      ...emptyAmounts(),
      employeeId: id,
      employeeCode: curr.employeeCode,
      employeeName: curr.employeeName,
      designation: curr.designation,
      employeeType: curr.employeeType,
      pension: curr.pension,
    };
    byId.set(id, { prev, curr, status: previousMap.has(id) ? "MATCHED" : "NEW" });
  }

  for (const [id, prev] of previousMap.entries()) {
    if (byId.has(id)) continue;
    byId.set(id, {
      prev,
      curr: {
        ...emptyAmounts(),
        employeeId: id,
        employeeCode: prev.employeeCode,
        employeeName: prev.employeeName,
        designation: prev.designation,
        employeeType: prev.employeeType,
        pension: prev.pension,
      },
      status: "REMOVED",
    });
  }

  const rows = [];
  let srNo = 1;
  const sorted = Array.from(byId.values()).sort(
    (a, b) => Number(a.curr.employeeId || a.prev.employeeId) - Number(b.curr.employeeId || b.prev.employeeId)
  );

  for (const item of sorted) {
    const employeeId = Number(item.curr.employeeId || item.prev.employeeId);
    const components = {};
    for (const field of VARIATION_COMPONENT_FIELDS) {
      const previous = moneyRound(item.prev[field.key]);
      const current = moneyRound(item.curr[field.key]);
      const variation = moneyRound(current - previous);
      components[field.key] = { previous, current, variation };
    }
    rows.push({
      srNo: srNo++,
      employeeId,
      employeeCode: item.curr.employeeCode || item.prev.employeeCode || String(employeeId),
      employeeName: item.curr.employeeName || item.prev.employeeName || "",
      designation: item.curr.designation || item.prev.designation || "",
      employeeType: item.curr.employeeType || item.prev.employeeType || "",
      pension: item.curr.pension || item.prev.pension || "",
      status: item.status,
      components,
      previous: item.prev,
      current: item.curr,
    });
  }
  return rows;
}

function buildFieldTotals(comparisonRows) {
  const totals = {};
  for (const field of VARIATION_COMPONENT_FIELDS) {
    totals[field.key] = { previous: 0, current: 0, variation: 0 };
  }
  for (const row of comparisonRows) {
    for (const field of VARIATION_COMPONENT_FIELDS) {
      const c = row.components[field.key];
      totals[field.key].previous = moneyRound(totals[field.key].previous + c.previous);
      totals[field.key].current = moneyRound(totals[field.key].current + c.current);
      totals[field.key].variation = moneyRound(totals[field.key].variation + c.variation);
    }
  }
  return totals;
}

/**
 * @param {object} options
 * @param {string} options.billCode
 * @param {string} options.instituteCode
 * @param {string} [options.previousBillCode]
 * @param {'previousSalaryMonth'|'auto'} [options.compareMode]
 */
async function buildSalaryVariationReport({
  billCode,
  instituteCode,
  previousBillCode = "",
  compareMode = "auto",
} = {}) {
  const code = String(billCode || "").trim();
  const instCode = String(instituteCode || "").trim();
  if (!code) {
    const err = new Error("Bill Code is required.");
    err.status = 400;
    throw err;
  }
  if (!instCode) {
    const err = new Error("Institute Code is required.");
    err.status = 400;
    throw err;
  }

  const bill = await getBillByCode(code);
  if (!bill) {
    const err = new Error("Bill Code not found.");
    err.status = 404;
    throw err;
  }
  const institute = await getInstitute(instCode);
  if (!institute) {
    const err = new Error("Institute not found.");
    err.status = 404;
    throw err;
  }

  const currentRows = await loadInstituteSalaryRows(
    Number(bill.BillCodeId),
    institute.InstituteCode
  );

  let previousMap = new Map();
  let previousSource = "NONE";
  let previousLabel = null;
  let resolvedPreviousBillCode = String(previousBillCode || "").trim();
  let previousBill = null;

  const forcePreviousMonth =
    String(compareMode || "").toLowerCase() === "previoussalarymonth" ||
    String(compareMode || "").toLowerCase() === "previous-month";

  if (!forcePreviousMonth && !resolvedPreviousBillCode) {
    const historyRes = await sql.query`
      SELECT * FROM (
        SELECT h.*, ROW_NUMBER() OVER (
          PARTITION BY h.EmployeeId
          ORDER BY h.SnapshotDate DESC, h.HistoryId DESC
        ) AS RowNo
        FROM dbo.SalaryEmployeeDetailHistory h
        WHERE h.SalaryBillCodeId = ${Number(bill.BillCodeId)}
          AND h.InstituteCode = ${institute.InstituteCode}
          AND UPPER(h.SnapshotType) IN (N'SUBMITTED', N'RESUBMITTED')
      ) latest
      WHERE latest.RowNo = 1
    `;
    if (historyRes.recordset.length) {
      previousSource = "HISTORY";
      previousLabel = "Previous submitted snapshot";
      for (const row of historyRes.recordset) {
        previousMap.set(Number(row.EmployeeId), mapSedAmounts(row));
      }
    }
  }

  if (previousSource === "NONE") {
    if (!resolvedPreviousBillCode || forcePreviousMonth) {
      previousBill = await findPreviousSalaryMonthBill(bill);
      resolvedPreviousBillCode = previousBill?.BillCode || "";
    } else {
      previousBill = await getBillByCode(resolvedPreviousBillCode);
    }

    if (
      previousBill &&
      String(previousBill.BillCode).toUpperCase() !== String(bill.BillCode).toUpperCase()
    ) {
      const prevRows = await loadInstituteSalaryRows(
        Number(previousBill.BillCodeId),
        institute.InstituteCode
      );
      previousSource = "PREVIOUS_BILL";
      previousLabel = previousBill.BillCode;
      resolvedPreviousBillCode = previousBill.BillCode;
      for (const row of prevRows) {
        previousMap.set(Number(row.employeeId), row);
      }
    }
  }

  const comparisonRows = buildComparisonRows(currentRows, previousMap);
  const fieldTotals = buildFieldTotals(comparisonRows);

  /* Legacy long-format variations (non-zero changes + new entries). */
  const variations = [];
  for (const row of comparisonRows) {
    if (row.status === "NEW") {
      variations.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        component: "ALL",
        previousAmount: null,
        currentAmount: row.components.netSalary.current,
        variationAmount: row.components.netSalary.variation,
        status: "NEW_ENTRY",
        message: "New Entry",
      });
      continue;
    }
    if (row.status === "REMOVED") {
      variations.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        component: "ALL",
        previousAmount: row.components.netSalary.previous,
        currentAmount: 0,
        variationAmount: row.components.netSalary.variation,
        status: "REMOVED",
        message: "Removed",
      });
      continue;
    }
    for (const field of VARIATION_COMPONENT_FIELDS) {
      const c = row.components[field.key];
      if (c.variation === 0) continue;
      variations.push({
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        component: field.label,
        previousAmount: c.previous,
        currentAmount: c.current,
        variationAmount: c.variation,
        status: "CHANGED",
      });
    }
  }

  const previousSalaryLabel = previousBill
    ? `${previousBill.SalaryMonth || ""}${previousBill.SalaryYear ? `-${previousBill.SalaryYear}` : ""}`.replace(/^-|-$/g, "") || previousBill.BillCode
    : previousLabel;

  const currentSalaryLabel = `${bill.SalaryMonth || ""}${bill.SalaryYear ? `-${bill.SalaryYear}` : ""}`.replace(/^-|-$/g, "") || bill.BillCode;

  return {
    billCode: bill.BillCode,
    billCodeId: Number(bill.BillCodeId),
    billMonth: bill.BillMonth || "",
    salaryMonth: bill.SalaryMonth || "",
    salaryYear: bill.SalaryYear || "",
    salaryMonthNumber: bill.SalaryMonthNumber || null,
    currentSalaryMonth: currentSalaryLabel,
    previousSalaryMonth: previousSalaryLabel || "—",
    instituteCode: institute.InstituteCode,
    instituteName: institute.InstituteName || "",
    employeeCount: comparisonRows.filter((r) => r.status !== "REMOVED").length,
    previousSource,
    previousLabel,
    previousBillCode:
      previousSource === "PREVIOUS_BILL" ? resolvedPreviousBillCode : null,
    previousBillMonth: previousBill?.BillMonth || "",
    previousSalaryMonthRaw: previousBill?.SalaryMonth || "",
    previousSalaryYear: previousBill?.SalaryYear || "",
    fields: VARIATION_COMPONENT_FIELDS,
    employees: currentRows,
    comparisonRows,
    fieldTotals,
    variations,
    totals: {
      totalEmployees: comparisonRows.length,
      matchedEmployees: comparisonRows.filter((r) => r.status === "MATCHED").length,
      newEmployees: comparisonRows.filter((r) => r.status === "NEW").length,
      removedEmployees: comparisonRows.filter((r) => r.status === "REMOVED").length,
      totalPreviousAmount: fieldTotals.netSalary.previous,
      totalCurrentAmount: fieldTotals.netSalary.current,
      netVariation: fieldTotals.netSalary.variation,
      variationCount: variations.filter((v) => v.status === "CHANGED").length,
    },
  };
}

module.exports = {
  VARIATION_COMPONENT_FIELDS,
  moneyRound,
  mapSedAmounts,
  buildSalaryVariationReport,
  findPreviousSalaryMonthBill,
};
