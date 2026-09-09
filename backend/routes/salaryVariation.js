const express = require("express");
const { sql } = require("../db");
const { normalizeEmployeeType } = require("../utils/employeePayRules");

const router = express.Router();

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function variation(current, previous) {
  return toNum(current) - toNum(previous);
}

function moneyRound(n) {
  return Number(toNum(n).toFixed(2));
}

function resolveBasic({
  employeeType,
  hasSide,
  sedBasic,
  historyBasic,
  matrixBasic,
  preferHistorical,
}) {
  if (normalizeEmployeeType(employeeType) === "FIX") {
    return 0;
  }
  if (!hasSide) return 0;

  if (preferHistorical === "previous") {
    if (historyBasic != null) return moneyRound(historyBasic);
    if (matrixBasic != null) return moneyRound(matrixBasic);
    return moneyRound(sedBasic);
  }

  if (preferHistorical === "current") {
    if (matrixBasic != null) return moneyRound(matrixBasic);
    if (historyBasic != null) return moneyRound(historyBasic);
    return moneyRound(sedBasic);
  }

  return moneyRound(sedBasic);
}

function buildReasons(row) {
  const reasons = [];
  if (row.status === "NEW") reasons.push("New employee");
  if (row.status === "REMOVED") reasons.push("Employee removed");
  if (row.status === "CONTINUED") {
    if (row.employeeTypePrevious && row.employeeTypeCurrent) {
      const prevT = normalizeEmployeeType(row.employeeTypePrevious);
      const currT = normalizeEmployeeType(row.employeeTypeCurrent);
      if (prevT && currT && prevT !== currT) {
        reasons.push("Employee Type changed");
      }
    }
    if (row.basic.variation > 0) reasons.push("Basic Pay increased");
    if (row.basic.variation < 0) reasons.push("Basic Pay decreased");
    if (row.da.variation !== 0) reasons.push("DA changed");
    if (row.hra.variation !== 0) reasons.push("HRA changed");
    if (row.ma.variation !== 0) reasons.push("MA changed");
    if (row.ta.variation !== 0) reasons.push("TA changed");
    if (row.totalDeduction.variation !== 0) reasons.push("Deduction changed");
    if (
      row.payHistory &&
      (row.payHistory.previousLevel !== row.payHistory.currentLevel ||
        row.payHistory.previousCellNo !== row.payHistory.currentCellNo ||
        row.payHistory.previousPayRevisionId !==
          row.payHistory.currentPayRevisionId)
    ) {
      reasons.push("Pay Level/Cell changed");
    }
  }
  return reasons;
}

function componentPair(previous, current) {
  const prev = moneyRound(previous);
  const curr = moneyRound(current);
  return {
    previous: prev,
    current: curr,
    variation: moneyRound(variation(curr, prev)),
  };
}

function mapDetailRow(raw, otherEarningsMap) {
  const employeeId = Number(raw.EmployeeId);
  const hasPrevious = Number(raw.HasPrevious) === 1;
  const hasCurrent = Number(raw.HasCurrent) === 1;
  let status = "CONTINUED";
  if (hasCurrent && !hasPrevious) status = "NEW";
  else if (hasPrevious && !hasCurrent) status = "REMOVED";

  const employeeType =
    raw.EmployeeType ||
    (hasCurrent ? raw.CurrEmployeeType : raw.PrevEmployeeType) ||
    "";
  const employeeTypePrevious = hasPrevious
    ? raw.EmployeeType || employeeType
    : "";
  const employeeTypeCurrent = hasCurrent
    ? raw.EmployeeType || employeeType
    : "";

  const typeForPrev = hasPrevious ? employeeTypePrevious || employeeType : employeeType;
  const typeForCurr = hasCurrent ? employeeTypeCurrent || employeeType : employeeType;

  const prevBasic = resolveBasic({
    employeeType: typeForPrev,
    hasSide: hasPrevious,
    sedBasic: raw.PrevBasicPaySed,
    historyBasic: raw.PrevHistoryBasicPay,
    matrixBasic: raw.PrevMatrixBasicPay,
    preferHistorical: "previous",
  });
  const currBasic = resolveBasic({
    employeeType: typeForCurr,
    hasSide: hasCurrent,
    sedBasic: raw.CurrBasicPaySed,
    historyBasic: raw.CurrHistoryBasicPay,
    matrixBasic: raw.CurrMatrixBasicPay,
    preferHistorical: "current",
  });

  const rebuildGross = (hasSide, basic, storedGross) => {
    if (!hasSide) return 0;
    const sedBasic = hasSide === "prev" ? toNum(raw.PrevBasicPaySed) : toNum(raw.CurrBasicPaySed);
    if (normalizeEmployeeType(hasSide === "prev" ? typeForPrev : typeForCurr) === "FIX") {
      return moneyRound(toNum(storedGross) - sedBasic);
    }
    if (moneyRound(basic) !== moneyRound(sedBasic)) {
      return moneyRound(toNum(storedGross) - sedBasic + toNum(basic));
    }
    return moneyRound(storedGross);
  };

  const prevGross = rebuildGross(
    hasPrevious ? "prev" : null,
    prevBasic,
    raw.PrevGrossSalary
  );
  const currGross = rebuildGross(
    hasCurrent ? "curr" : null,
    currBasic,
    raw.CurrGrossSalary
  );

  const prevGrade = hasPrevious ? moneyRound(raw.PrevGradePay) : 0;
  const currGrade = hasCurrent ? moneyRound(raw.CurrGradePay) : 0;
  const prevTotalBasic = moneyRound(prevBasic + prevGrade);
  const currTotalBasic = moneyRound(currBasic + currGrade);

  const otherPrev = toNum(otherEarningsMap.get(`${employeeId}|PREV`));
  const otherCurr = toNum(otherEarningsMap.get(`${employeeId}|CURR`));

  const prevDed = hasPrevious ? moneyRound(raw.PrevTotalDeduction) : 0;
  const currDed = hasCurrent ? moneyRound(raw.CurrTotalDeduction) : 0;
  const prevNet = hasPrevious ? moneyRound(prevGross - prevDed) : 0;
  const currNet = hasCurrent ? moneyRound(currGross - currDed) : 0;

  const row = {
    employeeId,
    employeeCode: raw.EmployeeCode || "",
    employeeName: raw.EmployeeName || "",
    employeeType: employeeTypeCurrent || employeeTypePrevious || employeeType,
    employeeTypePrevious,
    employeeTypeCurrent,
    designation: raw.Designation || "",
    section: raw.SectionName || "",
    sectionId: raw.SectionId != null ? Number(raw.SectionId) : null,
    designationId: raw.DesignationId != null ? Number(raw.DesignationId) : null,
    status,
    hasPrevious,
    hasCurrent,
    basic: componentPair(prevBasic, currBasic),
    gradePay: componentPair(prevGrade, currGrade),
    totalBasic: componentPair(prevTotalBasic, currTotalBasic),
    da: componentPair(
      hasPrevious ? raw.PrevDA : 0,
      hasCurrent ? raw.CurrDA : 0
    ),
    hra: componentPair(
      hasPrevious ? raw.PrevHRA : 0,
      hasCurrent ? raw.CurrHRA : 0
    ),
    ma: componentPair(
      hasPrevious ? raw.PrevMA : 0,
      hasCurrent ? raw.CurrMA : 0
    ),
    ta: componentPair(
      hasPrevious ? raw.PrevTA : 0,
      hasCurrent ? raw.CurrTA : 0
    ),
    specialAllowance: componentPair(
      hasPrevious ? raw.PrevSpecialAllowance : 0,
      hasCurrent ? raw.CurrSpecialAllowance : 0
    ),
    washingAllowance: componentPair(
      hasPrevious ? raw.PrevWashingAllowance : 0,
      hasCurrent ? raw.CurrWashingAllowance : 0
    ),
    otherEarnings: componentPair(otherPrev, otherCurr),
    gross: componentPair(prevGross, currGross),
    gpfSubscription: componentPair(
      hasPrevious ? raw.PrevGPFSubscription : 0,
      hasCurrent ? raw.CurrGPFSubscription : 0
    ),
    gpfAdvance: componentPair(
      hasPrevious ? raw.PrevGPFAdvance : 0,
      hasCurrent ? raw.CurrGPFAdvance : 0
    ),
    nps: componentPair(
      hasPrevious ? raw.PrevNPS : 0,
      hasCurrent ? raw.CurrNPS : 0
    ),
    incomeTax: componentPair(
      hasPrevious ? raw.PrevIncomeTax : 0,
      hasCurrent ? raw.CurrIncomeTax : 0
    ),
    professionalTax: componentPair(
      hasPrevious ? raw.PrevProfessionalTax : 0,
      hasCurrent ? raw.CurrProfessionalTax : 0
    ),
    otherDeduction: componentPair(
      hasPrevious ? raw.PrevOtherDeduction : 0,
      hasCurrent ? raw.CurrOtherDeduction : 0
    ),
    totalDeduction: componentPair(prevDed, currDed),
    netSalary: componentPair(prevNet, currNet),
    payHistory: {
      previousLevel:
        raw.PrevHistoryLevel == null
          ? null
          : String(raw.PrevHistoryLevel).trim(),
      previousCellNo:
        raw.PrevHistoryCellNo != null ? Number(raw.PrevHistoryCellNo) : null,
      previousPayRevisionId:
        raw.PrevHistoryPayRevisionId != null
          ? Number(raw.PrevHistoryPayRevisionId)
          : null,
      currentLevel:
        raw.CurrHistoryLevel == null
          ? null
          : String(raw.CurrHistoryLevel).trim(),
      currentCellNo:
        raw.CurrHistoryCellNo != null ? Number(raw.CurrHistoryCellNo) : null,
      currentPayRevisionId:
        raw.CurrHistoryPayRevisionId != null
          ? Number(raw.CurrHistoryPayRevisionId)
          : null,
    },
    previousSalaryEmployeeDetailId: raw.PreviousSalaryEmployeeDetailId
      ? Number(raw.PreviousSalaryEmployeeDetailId)
      : null,
    currentSalaryEmployeeDetailId: raw.CurrentSalaryEmployeeDetailId
      ? Number(raw.CurrentSalaryEmployeeDetailId)
      : null,
  };

  row.reasons = buildReasons(row);
  row.hasChange =
    row.status !== "CONTINUED" ||
    row.basic.variation !== 0 ||
    row.gradePay.variation !== 0 ||
    row.totalBasic.variation !== 0 ||
    row.da.variation !== 0 ||
    row.hra.variation !== 0 ||
    row.ma.variation !== 0 ||
    row.ta.variation !== 0 ||
    row.specialAllowance.variation !== 0 ||
    row.washingAllowance.variation !== 0 ||
    row.otherEarnings.variation !== 0 ||
    row.gross.variation !== 0 ||
    row.totalDeduction.variation !== 0 ||
    row.netSalary.variation !== 0;

  row.previous = {
    basicPay: row.basic.previous,
    gradePay: row.gradePay.previous,
    totalBasic: row.totalBasic.previous,
    da: row.da.previous,
    hra: row.hra.previous,
    ma: row.ma.previous,
    ta: row.ta.previous,
    specialAllowance: row.specialAllowance.previous,
    washingAllowance: row.washingAllowance.previous,
    otherEarnings: row.otherEarnings.previous,
    grossSalary: row.gross.previous,
    gpfSubscription: row.gpfSubscription.previous,
    gpfAdvance: row.gpfAdvance.previous,
    nps: row.nps.previous,
    incomeTax: row.incomeTax.previous,
    professionalTax: row.professionalTax.previous,
    otherDeduction: row.otherDeduction.previous,
    totalDeduction: row.totalDeduction.previous,
    netSalary: row.netSalary.previous,
  };
  row.current = {
    basicPay: row.basic.current,
    gradePay: row.gradePay.current,
    totalBasic: row.totalBasic.current,
    da: row.da.current,
    hra: row.hra.current,
    ma: row.ma.current,
    ta: row.ta.current,
    specialAllowance: row.specialAllowance.current,
    washingAllowance: row.washingAllowance.current,
    otherEarnings: row.otherEarnings.current,
    grossSalary: row.gross.current,
    gpfSubscription: row.gpfSubscription.current,
    gpfAdvance: row.gpfAdvance.current,
    nps: row.nps.current,
    incomeTax: row.incomeTax.current,
    professionalTax: row.professionalTax.current,
    otherDeduction: row.otherDeduction.current,
    totalDeduction: row.totalDeduction.current,
    netSalary: row.netSalary.current,
  };
  row.variation = {
    basicPay: row.basic.variation,
    gradePay: row.gradePay.variation,
    totalBasic: row.totalBasic.variation,
    da: row.da.variation,
    hra: row.hra.variation,
    ma: row.ma.variation,
    ta: row.ta.variation,
    specialAllowance: row.specialAllowance.variation,
    washingAllowance: row.washingAllowance.variation,
    otherEarnings: row.otherEarnings.variation,
    grossSalary: row.gross.variation,
    gpfSubscription: row.gpfSubscription.variation,
    gpfAdvance: row.gpfAdvance.variation,
    nps: row.nps.variation,
    incomeTax: row.incomeTax.variation,
    professionalTax: row.professionalTax.variation,
    otherDeduction: row.otherDeduction.variation,
    totalDeduction: row.totalDeduction.variation,
    netSalary: row.netSalary.variation,
  };

  row.components = [
    { code: "BASIC", label: "BASIC", ...row.basic },
    { code: "GRADE_PAY", label: "GRADE PAY", ...row.gradePay },
    { code: "TOTAL_BASIC", label: "TOTAL BASIC", ...row.totalBasic },
    { code: "DA", label: "DA", ...row.da },
    { code: "HRA", label: "HRA", ...row.hra },
    { code: "MA", label: "MA", ...row.ma },
    { code: "TA", label: "TA", ...row.ta },
    {
      code: "SPECIAL",
      label: "SPECIAL ALLOWANCE",
      ...row.specialAllowance,
    },
    {
      code: "WASHING",
      label: "WASHING ALLOWANCE",
      ...row.washingAllowance,
    },
    {
      code: "OTHER_EARNING",
      label: "OTHER EARNINGS",
      ...row.otherEarnings,
    },
    { code: "GROSS", label: "GROSS", ...row.gross },
    { code: "GPF", label: "GPF", ...row.gpfSubscription },
    { code: "GPF_ADV", label: "GPF ADVANCE", ...row.gpfAdvance },
    { code: "NPS", label: "NPS", ...row.nps },
    { code: "INCOME_TAX", label: "INCOME TAX", ...row.incomeTax },
    {
      code: "PROFESSIONAL_TAX",
      label: "PROFESSIONAL TAX",
      ...row.professionalTax,
    },
    {
      code: "OTHER_DEDUCTION",
      label: "OTHER DEDUCTION",
      ...row.otherDeduction,
    },
    {
      code: "TOTAL_DEDUCTION",
      label: "TOTAL DEDUCTION",
      ...row.totalDeduction,
    },
    { code: "NET", label: "NET SALARY", ...row.netSalary },
  ];

  return row;
}

function summarize(employees) {
  const sum = (picker) =>
    moneyRound(employees.reduce((acc, row) => acc + toNum(picker(row)), 0));

  const previousCount = employees.filter((e) => e.hasPrevious).length;
  const currentCount = employees.filter((e) => e.hasCurrent).length;
  const newCount = employees.filter((e) => e.status === "NEW").length;
  const removedCount = employees.filter((e) => e.status === "REMOVED").length;
  const continuedCount = employees.filter((e) => e.status === "CONTINUED").length;

  const prevGross = sum((e) => e.gross.previous);
  const currGross = sum((e) => e.gross.current);
  const prevDed = sum((e) => e.totalDeduction.previous);
  const currDed = sum((e) => e.totalDeduction.current);
  const prevNet = sum((e) => e.netSalary.previous);
  const currNet = sum((e) => e.netSalary.current);

  const componentKeys = [
    ["basic", "BASIC"],
    ["gradePay", "GRADE PAY"],
    ["totalBasic", "TOTAL BASIC"],
    ["da", "DA"],
    ["hra", "HRA"],
    ["ma", "MA"],
    ["ta", "TA"],
    ["specialAllowance", "SPECIAL ALLOWANCE"],
    ["washingAllowance", "WASHING ALLOWANCE"],
    ["otherEarnings", "OTHER EARNINGS"],
    ["gross", "GROSS"],
    ["gpfSubscription", "GPF"],
    ["gpfAdvance", "GPF ADVANCE"],
    ["nps", "NPS"],
    ["incomeTax", "INCOME TAX"],
    ["professionalTax", "PROFESSIONAL TAX"],
    ["otherDeduction", "OTHER DEDUCTION"],
    ["totalDeduction", "TOTAL DEDUCTION"],
    ["netSalary", "NET SALARY"],
  ];

  const componentSummary = componentKeys.map(([key, label]) => {
    const previous = sum((e) => e[key].previous);
    const current = sum((e) => e[key].current);
    return {
      component: label,
      previous,
      current,
      variation: moneyRound(current - previous),
    };
  });

  return {
    totalEmployeesPrevious: previousCount,
    totalEmployeesCurrent: currentCount,
    newEmployees: newCount,
    removedEmployees: removedCount,
    continuedEmployees: continuedCount,
    previousGross: prevGross,
    currentGross: currGross,
    grossVariation: moneyRound(currGross - prevGross),
    previousDeduction: prevDed,
    currentDeduction: currDed,
    deductionVariation: moneyRound(currDed - prevDed),
    previousNetSalary: prevNet,
    currentNetSalary: currNet,
    netSalaryVariation: moneyRound(currNet - prevNet),
    componentSummary,
  };
}

async function runVariationReport({
  previousBillCode,
  currentBillCode,
  instituteId,
  instituteCode,
}) {
  const request = new sql.Request();
  request.input("PreviousBillCode", sql.NVarChar(50), String(previousBillCode).trim());
  request.input("CurrentBillCode", sql.NVarChar(50), String(currentBillCode).trim());
  request.input(
    "InstituteId",
    sql.Int,
    instituteId != null && instituteId !== "" ? Number(instituteId) : null
  );
  request.input(
    "InstituteCode",
    sql.NVarChar(50),
    instituteCode ? String(instituteCode).trim() : null
  );
  request.multiple = true;

  const result = await request.execute("dbo.usp_Salary_VariationReport");
  const meta = result.recordsets?.[0]?.[0] || {};
  const rows = result.recordsets?.[1] || [];
  const otherRows = result.recordsets?.[2] || [];

  const otherMap = new Map();
  for (const o of otherRows) {
    const key = `${Number(o.EmployeeId)}|${String(o.BillSide || "").toUpperCase()}`;
    otherMap.set(key, toNum(o.Amount));
  }

  const employees = rows.map((raw) => mapDetailRow(raw, otherMap));
  const summary = summarize(employees);

  return {
    meta: {
      previousBillCode: meta.PreviousBillCode,
      previousBillCodeId: meta.PreviousBillCodeId
        ? Number(meta.PreviousBillCodeId)
        : null,
      previousSalaryMonth: meta.PreviousSalaryMonth,
      previousSalaryYear: meta.PreviousSalaryYear,
      previousStatus: meta.PreviousStatus,
      previousAsOfDate: meta.PreviousAsOfDate,
      currentBillCode: meta.CurrentBillCode,
      currentBillCodeId: meta.CurrentBillCodeId
        ? Number(meta.CurrentBillCodeId)
        : null,
      currentSalaryMonth: meta.CurrentSalaryMonth,
      currentSalaryYear: meta.CurrentSalaryYear,
      currentStatus: meta.CurrentStatus,
      currentAsOfDate: meta.CurrentAsOfDate,
      instituteId: meta.InstituteId ? Number(meta.InstituteId) : null,
      instituteCode: meta.InstituteCode,
      instituteName: meta.InstituteName,
      reportDate: new Date().toISOString(),
      readOnly: true,
    },
    summary,
    data: employees,
  };
}

function validateQuery(query) {
  const previousBillCode = String(query.previousBillCode || "").trim();
  const currentBillCode = String(query.currentBillCode || "").trim();
  const instituteId = query.instituteId;
  const instituteCode = String(query.instituteCode || "").trim();

  if (!previousBillCode) {
    return { status: 400, message: "Previous Salary Bill is required." };
  }
  if (!currentBillCode) {
    return { status: 400, message: "Current Salary Bill is required." };
  }
  if (previousBillCode.toUpperCase() === currentBillCode.toUpperCase()) {
    return {
      status: 400,
      message: "Previous Bill and Current Bill cannot be the same.",
    };
  }
  if (!instituteId && !instituteCode) {
    return { status: 400, message: "Institute is required." };
  }
  return null;
}

/* GET /api/salary-variation?previousBillCode=&currentBillCode=&instituteId=&instituteCode= */
router.get("/", async (req, res) => {
  try {
    const invalid = validateQuery(req.query);
    if (invalid) {
      return res.status(invalid.status).json({ message: invalid.message });
    }

    const report = await runVariationReport({
      previousBillCode: req.query.previousBillCode,
      currentBillCode: req.query.currentBillCode,
      instituteId: req.query.instituteId,
      instituteCode: req.query.instituteCode,
    });

    res.json({
      message: "OK",
      ...report,
    });
  } catch (error) {
    console.error("GET /api/salary-variation error:", error);
    const msg = error.message || "Unable to load salary variation report.";
    const status =
      /required|not found|cannot be the same/i.test(msg) ? 400 : 500;
    res.status(status).json({
      message: msg,
      error: msg,
    });
  }
});

module.exports = router;
module.exports.runVariationReport = runVariationReport;
