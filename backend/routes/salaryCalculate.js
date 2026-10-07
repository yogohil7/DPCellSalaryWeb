const express = require("express");
const { sql } = require("../db");
const { withTransaction } = require("./salaryEmployeeDetails");
const { normalizeEmployeeType } = require("../utils/employeePayRules");
const {
  loadActivePayrollConfig,
  isHraForcedZero,
  isHraApplicable,
} = require("../utils/payrollConfig");
const { calculateSalaryAmounts, toNum, calculateNps, calculateChequeAmount } = require("../utils/salaryBasicCalc");
const { isFixEmployeeType, zeroFixEarningComponentLines } = require("../utils/fixEmployeeSalary");
const {
  getClaPayLevelGroup,
  resolveTransportAllowancePayLevelGroup,
} = require("../utils/transportAllowanceGroup");
const {
  isGpfNpsStoppedForRetirement,
  salaryYearMonthFromAsOfDate,
} = require("../utils/retirementRules");

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
  };
}

function makeRequest(transaction) {
  return transaction ? new sql.Request(transaction) : new sql.Request();
}

async function loadEmployee(employeeId) {
  const result = await sql.query`
    SELECT
      e.*,
      d.DesignationName,
      d.EmployeeClass,
      i.InstituteCode,
      i.InstituteName,
      i.CityClassId AS InstituteCityClassId,
      i.CityClass AS InstituteCityClass,
      ccEmp.CityClassName AS EmployeeCityClassName,
      ccInst.CityClassName AS InstituteCityClassName,
      s.SectionName,
      r.RevisionCode,
      r.RevisionName,
      m.Level AS MatrixLevel,
      m.CellNo AS MatrixCellNo,
      m.BasicPay AS MatrixBasicPay
    FROM dbo.EmployeeMaster e
    LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
    LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
    LEFT JOIN dbo.CityClasses ccEmp ON ccEmp.CityClassId = e.CityClassId
    LEFT JOIN dbo.CityClasses ccInst ON ccInst.CityClassId = ISNULL(
      i.CityClassId,
      (
        SELECT TOP 1 c2.CityClassId
        FROM dbo.CityClasses c2
        WHERE UPPER(LTRIM(RTRIM(c2.CityClassName))) =
              UPPER(LTRIM(RTRIM(i.CityClass)))
      )
    )
    LEFT JOIN dbo.Sections s ON s.SectionId = e.SectionId
    LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
    LEFT JOIN dbo.PayMatrixMaster m ON m.PayMatrixId = e.PayMatrixId
    WHERE e.EmployeeId = ${employeeId}
  `;
  return result.recordset[0] || null;
}

async function resolveBasicPay(employee) {
  const employeeType = normalizeEmployeeType(employee.EmployeeType);
  const employeeId = Number(employee.EmployeeId);
  if (!employeeType) {
    const err = new Error("Invalid Employee Type.");
    err.status = 400;
    throw err;
  }

  if (employeeType === "FIX") {
    return {
      employeeType,
      payMatrixId: null,
      payRevisionId: null,
      level: null,
      cellNo: null,
      basicPay: 0,
    };
  }

  const payRevisionId = Number(employee.PayRevisionId);
  const level = String(employee.PayLevel ?? employee.MatrixLevel ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const cellNo = Number(employee.PayMatrixCellNo ?? employee.MatrixCellNo);
  const payMatrixId = Number(employee.PayMatrixId);

  const matrixMissingMsg = `Pay Matrix not found for Employee ${employeeId}. Please verify Pay Revision, Pay Level and Pay Matrix Cell.`;

  if (
    !Number.isFinite(payRevisionId) ||
    !level ||
    !Number.isInteger(cellNo) ||
    cellNo < 1
  ) {
    const err = new Error(matrixMissingMsg);
    err.status = 400;
    throw err;
  }

  /* Resolve strictly by PayRevision + Level + CellNo (never use a mismatched PayMatrixId). */
  let matrix = await sql.query`
    SELECT TOP 1 PayMatrixId, BasicPay, Level, CellNo, PayRevisionId
    FROM dbo.PayMatrixMaster
    WHERE PayRevisionId = ${payRevisionId}
      AND Level = ${level}
      AND CellNo = ${cellNo}
      AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
    ORDER BY EffectiveDate DESC, PayMatrixId DESC
  `;

  if (!matrix.recordset[0]) {
    matrix = await sql.query`
      SELECT TOP 1 PayMatrixId, BasicPay, Level, CellNo, PayRevisionId
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${payRevisionId}
        AND Level = ${level}
        AND CellNo = ${cellNo}
      ORDER BY EffectiveDate DESC, PayMatrixId DESC
    `;
  }

  /* PayMatrixId fallback only when Level/Cell are incomplete — not when Cell was provided but unmatched. */
  if (
    !matrix.recordset[0] &&
    Number.isFinite(payMatrixId) &&
    payMatrixId > 0 &&
    (!level || !Number.isInteger(cellNo) || cellNo < 1)
  ) {
    matrix = await sql.query`
      SELECT TOP 1 PayMatrixId, BasicPay, Level, CellNo, PayRevisionId
      FROM dbo.PayMatrixMaster
      WHERE PayMatrixId = ${payMatrixId}
    `;
  }

  if (!matrix.recordset[0]) {
    const err = new Error(matrixMissingMsg);
    err.status = 400;
    throw err;
  }

  return {
    employeeType,
    payMatrixId: Number(matrix.recordset[0].PayMatrixId),
    payRevisionId,
    level: String(matrix.recordset[0].Level).trim(),
    cellNo: Number(matrix.recordset[0].CellNo),
    basicPay: toNum(matrix.recordset[0].BasicPay),
  };
}

async function calculateForEmployee(employeeId, asOfDate, basicPayOverride = null) {
  const employee = await loadEmployee(employeeId);
  if (!employee) {
    const err = new Error("Employee not found.");
    err.status = 404;
    throw err;
  }

  const pay = await resolveBasicPay(employee);
  const basicPay = basicPayOverride != null && Number.isFinite(Number(basicPayOverride))
    ? toNum(basicPayOverride)
    : pay.basicPay;
  const employeeType = pay.employeeType;
  const cityClassIdRaw =
    employee.CityClassId ||
    employee.InstituteCityClassId ||
    null;
  let cityClassName = String(
    employee.EmployeeCityClassName ||
      employee.InstituteCityClassName ||
      employee.CityClass ||
      employee.InstituteCityClass ||
      ""
  ).trim();

  /* Resolve CityClassId from name when institute/employee only store CityClass text. */
  let cityClassId = cityClassIdRaw != null ? Number(cityClassIdRaw) : null;
  if ((cityClassId == null || !Number.isFinite(cityClassId)) && cityClassName) {
    const ccLookup = await sql.query`
      SELECT TOP 1 CityClassId, CityClassName
      FROM dbo.CityClasses
      WHERE UPPER(LTRIM(RTRIM(CityClassName))) = ${cityClassName.toUpperCase()}
        AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    `;
    if (ccLookup.recordset[0]) {
      cityClassId = Number(ccLookup.recordset[0].CityClassId);
      cityClassName = String(
        ccLookup.recordset[0].CityClassName || cityClassName
      ).trim();
    }
  }
  if (!Number.isFinite(cityClassId)) {
    cityClassId = null;
  }
  const designationId = employee.DesignationId || null;
  const employeeClass = employee.EmployeeClass || null;
  const payRevisionId =
    employeeType === "FIX" ? null : pay.payRevisionId;
  const onDate = asOfDate || new Date().toISOString().slice(0, 10);
  const monthLabel = String(onDate).slice(0, 7);
  const warnings = [];

  /* Employee-wise applicability from Payroll Configuration (as-of salary month).
     Defaults when no config: MA/TA/HRA = YES. Saved config always overrides. */
  const payrollConfig = await loadActivePayrollConfig(employeeId, onDate);
  const maApplicable = Boolean(payrollConfig.medicalAllowanceApplicable);
  const taApplicable = Boolean(payrollConfig.transportAllowanceApplicable);
  /* HRA YES → calculate from HRAMaster; HRA NO → force HRA amount to 0. */
  const hraApplicable = isHraApplicable(payrollConfig);
  const hraForcedZero = isHraForcedZero(payrollConfig);
  const ptApplicable = Boolean(payrollConfig.professionalTaxApplicable);
  const nppaMode = String(payrollConfig.nppaApplicable || "NA").toUpperCase();
  const gpfNpsFlag = String(employee.GPFNPS || "")
    .trim()
    .toUpperCase();

  /*
     Retirement-based GPF/NPS deduction stop (2026-09-25): deduction is
     ZERO for the retirement month and the two calendar months before it,
     compared against the SALARY Month (onDate/monthLabel, always derived
     from the bill's Salary Month — see asOfFromBill() in salaryEntry.js —
     never the Bill Month). employee.DateOfRetirement comes straight from
     EmployeeMaster (loadEmployee() selects e.*); a NULL value never stops
     the deduction. Only zeroes the deduction that actually applies to this
     employee's pension type — never invents the other one.
  */
  const retirementSalaryYm = salaryYearMonthFromAsOfDate(onDate);
  const gpfNpsRetirementStop = retirementSalaryYm
    ? isGpfNpsStoppedForRetirement({
        dateOfRetirement: employee.DateOfRetirement,
        salaryYear: retirementSalaryYm.salaryYear,
        salaryMonth: retirementSalaryYm.salaryMonth,
      })
    : false;

  const daRes = await sql.query`
    SELECT DAId, DAPercentage, EffectiveFrom, EffectiveTo, PayRevisionId
    FROM dbo.DAMaster
    WHERE (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
      AND EffectiveFrom <= ${onDate}
      AND (EffectiveTo IS NULL OR EffectiveTo >= ${onDate})
      AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    ORDER BY CASE WHEN PayRevisionId = ${payRevisionId} THEN 0 ELSE 1 END, EffectiveFrom DESC
  `;
  if (daRes.recordset.length > 1) {
    const top = daRes.recordset[0];
    const same = daRes.recordset.filter(
      (r) =>
        Number(r.PayRevisionId || 0) === Number(top.PayRevisionId || 0) &&
        String(r.EffectiveFrom) === String(top.EffectiveFrom)
    );
    if (same.length > 1) {
      warnings.push(
        `Overlapping DA rules found for Salary Month ${monthLabel}. Using the highest-priority active rate.`
      );
    }
  }
  const daPct = toNum(daRes.recordset[0]?.DAPercentage);
  const daFound = Boolean(daRes.recordset[0]);
  const daMasterId = daRes.recordset[0]?.DAId
    ? Number(daRes.recordset[0].DAId)
    : null;
  if (employeeType === "REGULAR" && !daFound) {
    warnings.push(
      `DA rate not configured for Salary Month ${monthLabel}.`
    );
  }

  /*
    HRA:
    - Payroll HRA = YES  => calculate from HRAMaster (normal city-class rules)
    - Payroll HRA = NO   => HRA amount forced to 0
  */
  let hraPct = 0;
  let hraFound = false;
  let hraMasterId = null;
  if (hraForcedZero) {
    hraPct = 0;
    hraFound = true;
  } else {
    try {
      const hraRes = await sql.query`
        SELECT TOP 1 HRAId, HRAPercentage, CityClassId, CityClass
        FROM dbo.HRAMaster
        WHERE (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
          AND (
            CityClassId IS NULL
            OR CityClassId = ${cityClassId}
            OR (${cityClassName} <> N'' AND CityClass = ${cityClassName})
            OR CityClass = (SELECT CityClassName FROM dbo.CityClasses WHERE CityClassId = ${cityClassId})
          )
          AND ISNULL(EffectiveFrom, EffectiveDate) <= ${onDate}
          AND (EffectiveTo IS NULL OR EffectiveTo >= ${onDate})
          AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
          AND ISNULL(IsPreviousLocation, 0) = 0
        ORDER BY
          CASE WHEN CityClassId = ${cityClassId} THEN 0 ELSE 1 END,
          ISNULL(EffectiveFrom, EffectiveDate) DESC
      `;
      if (hraRes.recordset[0]) {
        hraPct = toNum(hraRes.recordset[0].HRAPercentage);
        hraFound = true;
        hraMasterId = Number(hraRes.recordset[0].HRAId);
      }
    } catch {
      const hraRes = await sql.query`
        SELECT TOP 1 HRAId, HRAPercentage
        FROM dbo.HRAMaster
        WHERE (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
          AND (
            CityClassId IS NULL
            OR CityClassId = ${cityClassId}
            OR (${cityClassName} <> N'' AND CityClass = ${cityClassName})
          )
          AND ISNULL(EffectiveFrom, EffectiveDate) <= ${onDate}
          AND (EffectiveTo IS NULL OR EffectiveTo >= ${onDate})
          AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
        ORDER BY CASE WHEN CityClassId = ${cityClassId} THEN 0 ELSE 1 END,
                 ISNULL(EffectiveFrom, EffectiveDate) DESC
      `;
      if (hraRes.recordset[0]) {
        hraPct = toNum(hraRes.recordset[0].HRAPercentage);
        hraFound = true;
        hraMasterId = Number(hraRes.recordset[0].HRAId);
      }
    }
    if (employeeType === "REGULAR" && !hraFound) {
      warnings.push(
        cityClassName || cityClassId
          ? `HRA rule not configured for City Class ${cityClassName || cityClassId}.`
          : `HRA rule not configured (employee/institute City Class missing).`
      );
    }
  }

  let medical = 0;
  let maFound = false;
  if (maApplicable) {
    const medRes = await sql.query`
      SELECT TOP 1 MedicalAllowanceId, Amount, EffectiveFrom, DesignationId
      FROM dbo.MedicalAllowanceMaster
      WHERE (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
        AND (DesignationId IS NULL OR DesignationId = ${designationId})
        AND EffectiveFrom <= ${onDate}
        AND (EffectiveTo IS NULL OR EffectiveTo >= ${onDate})
        AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
      ORDER BY
        CASE WHEN DesignationId = ${designationId} THEN 0 ELSE 1 END,
        EffectiveFrom DESC,
        MedicalAllowanceId DESC
    `;
    if (medRes.recordset[0]) {
      medical = toNum(medRes.recordset[0].Amount);
      maFound = true;
    } else {
      warnings.push("Medical Allowance rule not configured.");
    }
  }

  /* Total Basic Pay is computed early for TA PayLevelGroup threshold rule. */
  const fixBasicForTa = 0;
  const earlyTotalBasic = toNum(basicPay) + fixBasicForTa;
  const payLevelForTa = String(pay.level || employee.PayLevel || "").trim();
  const taGroupResolved = await resolveTransportAllowancePayLevelGroup({
    sql,
    basicPay: earlyTotalBasic,
    payLevel: payLevelForTa,
    payRevisionId,
  });
  const taPayLevelGroup = taGroupResolved.payLevelGroup;
  const taBasicUpgradeThreshold = taGroupResolved.basicUpgradeThreshold;

  let transport = 0;
  let taFound = false;
  let taMasterId = null;
  if (taApplicable) {
    try {
      const taRes = await sql.query`
        SELECT TOP 1
          TransportAllowanceId,
          TAAmount,
          PayLevelGroup,
          CityClass,
          CityClassId,
          EffectiveDate
        FROM dbo.TransportAllowanceMaster
        WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
          AND EffectiveDate <= ${onDate}
          AND PayLevelGroup = ${taPayLevelGroup}
          AND (
            (${cityClassName} <> N'' AND CityClass = ${cityClassName})
            OR (${cityClassId} IS NOT NULL AND CityClassId = ${cityClassId})
            OR (
              ${cityClassName} = N''
              AND ${cityClassId} IS NULL
              AND (
                CityClassId IS NULL
                OR 1 = 1
              )
            )
            OR CityClass = (
              SELECT CityClassName FROM dbo.CityClasses WHERE CityClassId = ${cityClassId}
            )
          )
          AND (
            EmployeeClass IS NULL
            OR LTRIM(RTRIM(ISNULL(EmployeeClass, N''))) = N''
            OR (${employeeClass} IS NOT NULL AND EmployeeClass = ${employeeClass})
          )
          AND (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
        ORDER BY
          CASE
            WHEN ${cityClassId} IS NOT NULL AND CityClassId = ${cityClassId} THEN 0
            WHEN ${cityClassName} <> N'' AND CityClass = ${cityClassName} THEN 0
            ELSE 1
          END,
          EffectiveDate DESC,
          TransportAllowanceId DESC
      `;
      if (taRes.recordset[0]) {
        transport = toNum(taRes.recordset[0].TAAmount);
        taMasterId = Number(taRes.recordset[0].TransportAllowanceId);
        taFound = true;
        if (!cityClassName && cityClassId == null) {
          warnings.push(
            `City Class not configured for employee/institute; TA used PayLevelGroup "${taPayLevelGroup}" without exact city match.`
          );
        }
        if (!(transport > 0)) {
          warnings.push(
            `Transport Allowance master row found for PayLevelGroup "${taPayLevelGroup}"` +
              (cityClassName ? ` / City Class ${cityClassName}` : "") +
              ` but TA amount is ${transport}.`
          );
        }
      } else {
        warnings.push(
          `Transport Allowance not configured for PayLevelGroup "${taPayLevelGroup}"` +
            (cityClassName ? ` / City Class ${cityClassName}` : "") +
            "."
        );
      }
    } catch (err) {
      console.warn("TA lookup skipped:", err.message);
      warnings.push("Transport Allowance lookup failed.");
    }
  }

  /* CLA from CLAMaster — exact PayLevelGroup + CityClass + EffectiveDate.
     Basic Pay TA-upgrade threshold does NOT affect CLA classification. */
  let claAmount = 0;
  let claMasterId = null;
  let claFound = false;
  const payLevelText = String(pay.level || employee.PayLevel || "").trim();
  const claPayLevelGroup = getClaPayLevelGroup(payLevelText);
  try {
    const claRes = await sql.query`
      SELECT TOP 1 CLAId, CLAAmount, PayLevelGroup, CityClass, CityClassId, EffectiveDate
      FROM dbo.CLAMaster
      WHERE EffectiveDate <= ${onDate}
        AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
        AND (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
        AND PayLevelGroup = ${claPayLevelGroup}
        AND (
          (${cityClassName} <> N'' AND CityClass = ${cityClassName})
          OR (${cityClassId} IS NOT NULL AND CityClassId = ${cityClassId})
          OR (
            ${cityClassName} = N''
            AND ${cityClassId} IS NULL
          )
          OR CityClass = (
            SELECT CityClassName FROM dbo.CityClasses WHERE CityClassId = ${cityClassId}
          )
        )
        AND (
          EmployeeClass IS NULL
          OR LTRIM(RTRIM(ISNULL(EmployeeClass, N''))) = N''
          OR (${employeeClass} IS NOT NULL AND EmployeeClass = ${employeeClass})
        )
      ORDER BY
        CASE
          WHEN ${cityClassId} IS NOT NULL AND CityClassId = ${cityClassId} THEN 0
          WHEN ${cityClassName} <> N'' AND CityClass = ${cityClassName} THEN 0
          ELSE 1
        END,
        /* When city is unknown, prefer City Class X (deterministic, matches HQ X rates). */
        CASE WHEN CityClass = N'X' THEN 0 WHEN CityClass = N'Y' THEN 1 ELSE 2 END,
        EffectiveDate DESC,
        CLAId DESC
    `;
    if (claRes.recordset[0]) {
      claAmount = toNum(claRes.recordset[0].CLAAmount);
      claMasterId = Number(claRes.recordset[0].CLAId);
      claFound = true;
      if (!cityClassName && cityClassId == null) {
        warnings.push(
          `City Class not configured; CLA used PayLevelGroup "${claPayLevelGroup}" (preferred City Class X when ambiguous).`
        );
      }
    }
  } catch (err) {
    console.warn("CLA lookup skipped:", err.message);
  }
  if (employeeType === "REGULAR" && !claFound) {
    warnings.push(
      `CLA rule not configured for PayLevelGroup "${claPayLevelGroup}"` +
        (cityClassName ? ` / City Class ${cityClassName}` : "") +
        "."
    );
  }

  const components = await sql.query`
    SELECT * FROM dbo.SalaryComponentMaster WHERE IsActive = 1
    ORDER BY ISNULL(DisplayOrder, 9999), ComponentCode
  `;

  const rules = await sql.query`
    SELECT *
    FROM dbo.SalaryComponentRule
    WHERE IsActive = 1
      AND EffectiveFrom <= ${onDate}
      AND (EffectiveTo IS NULL OR EffectiveTo >= ${onDate})
      AND (PayRevisionId IS NULL OR PayRevisionId = ${payRevisionId})
      AND (CityClassId IS NULL OR CityClassId = ${cityClassId})
      AND (DesignationId IS NULL OR DesignationId = ${designationId})
      AND (EmployeeClass IS NULL OR EmployeeClass = ${employeeClass})
      AND (EmployeeId IS NULL OR EmployeeId = ${Number(employee.EmployeeId)})
  `;

  const pickRule = (componentId) => {
    const matches = rules.recordset.filter(
      (r) => Number(r.SalaryComponentId) === Number(componentId)
    );
    matches.sort((a, b) => {
      const score = (r) =>
        (r.EmployeeId != null ? 16 : 0) +
        (r.DesignationId != null ? 8 : 0) +
        (r.CityClassId != null ? 4 : 0) +
        (r.EmployeeClass ? 2 : 0) +
        (r.PayRevisionId != null ? 1 : 0);
      return score(b) - score(a);
    });
    return matches[0] || null;
  };

  /* Total Basic Pay = Basic + FIX Basic (FIX Basic defaults to 0).
     DA / HRA are always derived from Total Basic Pay × master %. */
  const fixBasic = 0;
  const derived = calculateSalaryAmounts({
    basic: basicPay,
    fixBasic,
    daPercentage: daPct,
    hraPercentage: hraPct,
    payrollHra: hraForcedZero,
  });
  const totalBasicPay = derived.totalBasicPay;
  const daAmount = derived.da;
  const hraAmount = derived.hra;
  const basicDa = totalBasicPay + daAmount;

  const lines = components.recordset.map((c) => {
    const code = String(c.ComponentCode || "").toUpperCase();
    const rule = pickRule(c.SalaryComponentId);
    let rate = null;
    let calculationBase = null;
    let amount = 0;

    if (code === "BASIC") {
      amount = basicPay;
      calculationBase = basicPay;
    } else if (code === "DA") {
      rate = daPct;
      calculationBase = totalBasicPay;
      amount = daAmount;
    } else if (code === "HRA") {
      rate = hraForcedZero ? 0 : hraPct;
      calculationBase = totalBasicPay;
      amount = hraAmount;
    } else if (code === "MEDICAL") {
      amount = maApplicable ? medical || toNum(rule?.FixedAmount) : 0;
    } else if (code === "TRANSPORT") {
      amount = taApplicable ? transport || toNum(rule?.FixedAmount) : 0;
    } else if (code === "NPPA") {
      amount = nppaMode === "YES" ? toNum(rule?.FixedAmount) : 0;
    } else if (code === "PF" || code === "GPF") {
      /* Only when employee is marked GPF */
      if (gpfNpsFlag !== "GPF") {
        amount = 0;
      } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC_DA") {
        rate = toNum(rule?.Percentage);
        calculationBase = basicDa;
        amount = Number(((basicDa * rate) / 100).toFixed(2));
      } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC") {
        rate = toNum(rule?.Percentage);
        calculationBase = totalBasicPay;
        amount = Number(((totalBasicPay * rate) / 100).toFixed(2));
      } else {
        amount = toNum(rule?.FixedAmount);
      }
    } else if (code === "NPS") {
      if (gpfNpsFlag !== "NPS") {
        amount = 0;
      } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC_DA") {
        rate = toNum(rule?.Percentage);
        calculationBase = basicDa;
        amount = Number(((basicDa * rate) / 100).toFixed(2));
      } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC") {
        rate = toNum(rule?.Percentage);
        calculationBase = totalBasicPay;
        amount = Number(((totalBasicPay * rate) / 100).toFixed(2));
      } else {
        amount = toNum(rule?.FixedAmount);
      }
    } else if (code === "PROFESSIONAL_TAX") {
      if (!ptApplicable) {
        amount = 0;
      } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC") {
        rate = toNum(rule?.Percentage);
        calculationBase = totalBasicPay;
        amount = Number(((totalBasicPay * rate) / 100).toFixed(2));
      } else {
        amount = toNum(rule?.FixedAmount);
      }
    } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC") {
      rate = toNum(rule?.Percentage);
      calculationBase = totalBasicPay;
      amount = Number(((totalBasicPay * rate) / 100).toFixed(2));
    } else if (String(c.CalculationType).toUpperCase() === "PERCENTAGE_OF_BASIC_DA") {
      rate = toNum(rule?.Percentage);
      calculationBase = basicDa;
      amount = Number(((basicDa * rate) / 100).toFixed(2));
    } else if (String(c.CalculationType).toUpperCase() === "FIXED") {
      amount = toNum(rule?.FixedAmount);
    } else {
      amount = toNum(rule?.FixedAmount);
    }

    return {
      salaryComponentId: Number(c.SalaryComponentId),
      componentCode: code,
      componentName: c.ComponentName,
      componentType: c.ComponentType,
      calculationType: c.CalculationType,
      ruleSource: c.RuleSource,
      isEarning: Boolean(c.IsEarning),
      isDeduction: Boolean(c.IsDeduction),
      rate,
      calculationBase,
      amount,
    };
  });

  /* FIX pay is Fix Basic only. Regular earning components (including DA/HRA
     calculated above from a zero basic) must not be stored or returned. */
  zeroFixEarningComponentLines(lines, employeeType);
  const fixPayOnly = employeeType === "FIX";

  const amountBy = (code) =>
    toNum(lines.find((l) => l.componentCode === code)?.amount);

  const gradePay = fixBasic;
  const totalBasic = totalBasicPay;
  const specialAllowance = fixPayOnly
    ? 0
    : amountBy("SPECIAL") + amountBy("OTHER_EARNING");
  const washingAllowance = fixPayOnly
    ? 0
    : (amountBy("WASHING") || amountBy("WASHING_ALLOWANCE"));
  const nppaAmount = fixPayOnly ? 0 : amountBy("NPPA");
  /* Prefer central Total-Basic-derived DA/HRA; fall back to component lines.
     Parentheses keep a FIX zero from falling through `||` to a component amount. */
  const da = fixPayOnly ? 0 : (daAmount || amountBy("DA"));
  const hra = fixPayOnly
    ? 0
    : hraForcedZero
      ? 0
      : hraAmount || amountBy("HRA");
  /* Prefer Medical / Transport master amounts loaded above. */
  const ma = fixPayOnly ? 0 : (medical || amountBy("MEDICAL"));
  const ta = fixPayOnly ? 0 : (transport || amountBy("TRANSPORT"));
  /* Prefer master CLA; component code CLA if present */
  const cla = fixPayOnly ? 0 : (claAmount || amountBy("CLA"));
  const grossSalary =
    totalBasic +
    da +
    hra +
    ma +
    ta +
    cla +
    specialAllowance +
    washingAllowance +
    nppaAmount;

  let gpfSubscription = amountBy("PF") || amountBy("GPF");
  /* ADV removed from Salary Entry — always 0. */
  const gpfAdvance = 0;
  let nps = 0;
  if (gpfNpsFlag === "NPS") {
    /* Authoritative NPS: CEILING((Total Basic Pay + DA) × 10%, 1) */
    nps = calculateNps(totalBasic, da);
    gpfSubscription = 0;
  } else if (gpfNpsFlag === "GPF") {
    nps = 0;
    if (gpfSubscription === 0 && !gpfNpsRetirementStop) {
      warnings.push(
        "GPF/PF deduction rule not configured in SalaryComponentRule for this employee."
      );
    }
  }

  /* Retirement stop applies AFTER the normal GPF/NPS calculation above, and
     only to whichever deduction actually exists for this employee's
     pension type. GPF Advance, Income Tax, Professional Tax and Other
     Deduction are untouched (requirement: stop is specific to GPF/NPS
     subscription only). */
  if (gpfNpsRetirementStop) {
    if (gpfNpsFlag === "GPF") gpfSubscription = 0;
    if (gpfNpsFlag === "NPS") nps = 0;
  }

  const incomeTax = amountBy("INCOME_TAX");
  const professionalTax = ptApplicable ? amountBy("PROFESSIONAL_TAX") : 0;
  const otherDeduction = amountBy("OTHER_DEDUCTION");
  const totalDeduction =
    gpfSubscription + gpfAdvance + nps + incomeTax + professionalTax + otherDeduction;
  const netSalary = grossSalary - totalDeduction;
  const chequeAmount = calculateChequeAmount({
    netSalary,
    incomeTax,
    professionalTax,
  });

  return {
    employee: {
      employeeId: Number(employee.EmployeeId),
      employeeCode: employee.EmployeeCode,
      employeeName: employee.EmployeeName,
      designation: employee.DesignationName || "",
      employeeType,
      sectionId: employee.SectionId != null ? Number(employee.SectionId) : null,
      sectionName: employee.SectionName || "",
      instituteCode: employee.InstituteCode || "",
      instituteId: employee.InstituteId ? Number(employee.InstituteId) : null,
      gpfNps: gpfNpsFlag || "",
      cityClassId,
      cityClassName,
    },
    payRevision: {
      payRevisionId,
      revisionCode: employeeType === "FIX" ? "" : employee.RevisionCode || "",
      revisionName: employeeType === "FIX" ? "" : employee.RevisionName || "",
    },
    level: employeeType === "FIX" ? null : pay.level,
    cellNo: employeeType === "FIX" ? null : pay.cellNo,
    payMatrixId: employeeType === "FIX" ? null : pay.payMatrixId,
    basicPay,
    daRate: fixPayOnly ? 0 : daPct,
    hraRate: fixPayOnly ? 0 : hraPct,
    daMasterId,
    hraMasterId,
    claMasterId,
    asOfDate: onDate,
    warnings,
    mastersFound: {
      da: daFound,
      hra: hraFound,
      medical: !maApplicable || maFound,
      transport: !taApplicable || taFound,
      cla: claFound,
    },
    taPayLevelGroup,
    taBasicUpgradeThreshold,
    taMasterId,
    claPayLevelGroup,
    payrollConfig: {
      id: payrollConfig.id != null ? Number(payrollConfig.id) : null,
      medicalAllowanceApplicable: maApplicable,
      transportAllowanceApplicable: taApplicable,
      hraPreviousLocationApplicable: hraApplicable,
      houseRentAllowanceYes: hraApplicable,
      hraForcedZero,
      professionalTaxApplicable: ptApplicable,
      nppaApplicable: nppaMode,
      isDefault: Boolean(payrollConfig.isDefault),
    },
    components: lines,
    earnings: {
      basicPay,
      fixBasic: gradePay,
      gradePay,
      totalBasic,
      totalBasicPay: totalBasic,
      da,
      hra,
      ma,
      ta,
      cla,
      specialAllowance,
      washingAllowance,
      nppa: nppaAmount,
      otherEarnings: fixPayOnly ? 0 : amountBy("OTHER_EARNING"),
      grossSalary,
    },
    deductions: {
      gpfSubscription,
      gpfAdvance,
      nps,
      incomeTax,
      professionalTax,
      otherDeduction,
      totalDeduction,
    },
    /* Diagnostic/testable flag only — the deductions above are already the
       authoritative zeroed values when this is true. */
    gpfNpsRetirementStop,
    netSalary,
    chequeAmount,
  };
}

/** Map calculation result to Salary Entry grid row shape. */
function mapCalcToGridRow(calc, extras = {}) {
  const manual = extras.manual || {};
  const hraForcedZero = Boolean(
    manual.hraForcedZero ?? calc.payrollConfig?.hraForcedZero
  );
  let washingAllowance = toNum(
    manual.washingAllowance ?? calc.earnings.washingAllowance
  );
  let specialAllowance = toNum(
    manual.specialAllowance ?? calc.earnings.specialAllowance
  );
  const gpfNpsFlag = String(calc.employee.gpfNps || "")
    .trim()
    .toUpperCase();
  const pension =
    gpfNpsFlag === "GPF" || gpfNpsFlag === "NPS" ? gpfNpsFlag : "";

  let gpfSubscription = toNum(
    manual.gpfSubscription ?? calc.deductions.gpfSubscription
  );
  /* ADV removed from Salary Entry */
  const gpfAdvance = 0;

  const incomeTax = toNum(manual.incomeTax ?? calc.deductions.incomeTax);
  const professionalTax = toNum(
    manual.professionalTax ??
      manual.professionTax ??
      calc.deductions.professionalTax
  );
  const otherDeduction = toNum(
    manual.otherDeduction ?? calc.deductions.otherDeduction
  );

  const fixPayOnly = isFixEmployeeType(calc.employee.employeeType);
  let basicPay = toNum(manual.basicPay ?? calc.basicPay);
  if (fixPayOnly) {
    basicPay = 0;
  }
  const fixBasic = toNum(
    manual.fixBasic ??
      manual.gradePay ??
      calc.earnings.gradePay ??
      calc.earnings.fixBasic ??
      0
  );
  /* A posted DA/HRA rate must not rebuild regular allowances for FIX pay. */
  const daRate = fixPayOnly ? 0 : toNum(manual.daRate ?? calc.daRate);
  const hraRate = fixPayOnly ? 0 : toNum(manual.hraRate ?? calc.hraRate);

  const derived = calculateSalaryAmounts({
    basic: basicPay,
    fixBasic,
    daPercentage: daRate,
    hraPercentage: hraRate,
    payrollHra: hraForcedZero,
  });

  /* Manual DA/HRA only when explicitly provided; otherwise derive from Total Basic.
     FIX employees never receive those allowances, even if a draft still has them. */
  const da = fixPayOnly
    ? 0
    : manual.da != null && manual.da !== ""
      ? toNum(manual.da)
      : derived.da;
  const hra = fixPayOnly
    ? 0
    : hraForcedZero
      ? 0
      : manual.hra != null && manual.hra !== ""
        ? toNum(manual.hra)
        : derived.hra;
  const ma = fixPayOnly ? 0 : toNum(manual.ma ?? calc.earnings.ma);
  const ta = fixPayOnly ? 0 : toNum(manual.ta ?? calc.earnings.ta);
  const cla = fixPayOnly ? 0 : toNum(manual.cla ?? calc.earnings.cla);
  const nppa = fixPayOnly ? 0 : toNum(manual.nppa ?? calc.earnings.nppa);
  const otherEarnings = fixPayOnly
    ? 0
    : toNum(manual.otherEarnings ?? calc.earnings.otherEarnings);
  if (fixPayOnly) {
    washingAllowance = 0;
    specialAllowance = 0;
  }
  const npsAdvance = 0;
  const gradePay = fixBasic;
  const totalBasic = derived.totalBasicPay;

  let nps = 0;
  if (pension === "GPF") {
    nps = 0;
  } else if (pension === "NPS") {
    gpfSubscription = 0;
    /* Authoritative NPS unless client marked a manual NPS override without basic-driven recalc. */
    if (
      manual.npsManual === true &&
      manual.nps != null &&
      manual.nps !== "" &&
      !manual.recalcFromBasic &&
      !manual.basicDriven
    ) {
      nps = toNum(manual.nps);
    } else {
      nps = calculateNps(totalBasic, da);
    }
  }

  /*
     Retirement-based GPF/NPS deduction stop (2026-09-25): this must win
     over BOTH the default derivation above and any manual override —
     the whole point of the rule is that the operator cannot re-enable the
     deduction during the final 3 months. calc.gpfNpsRetirementStop was
     already computed against EmployeeMaster.DateOfRetirement + the Salary
     Month by calculateForEmployee(); never recomputed here so there is one
     source of truth. GPF Advance / Income Tax / Professional Tax / Other
     Deduction are untouched.
  */
  if (calc.gpfNpsRetirementStop) {
    if (pension === "GPF") gpfSubscription = 0;
    if (pension === "NPS") nps = 0;
  }

  const grossSalary =
    totalBasic +
    da +
    hra +
    ma +
    ta +
    cla +
    specialAllowance +
    washingAllowance +
    nppa +
    otherEarnings;
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
    employeeId: calc.employee.employeeId,
    employeeCode: calc.employee.employeeCode,
    employeeName: calc.employee.employeeName,
    designation: calc.employee.designation,
    employeeType: calc.employee.employeeType,
    gpfNps: pension,
    pension,
    sectionId: calc.employee.sectionId,
    sectionName: calc.employee.sectionName,
    instituteId: calc.employee.instituteId,
    instituteCode: calc.employee.instituteCode,
    cityClass: calc.employee.cityClassName || "",
    payRevisionId: calc.payRevision.payRevisionId,
    payRevisionName: calc.payRevision.revisionName,
    revisionCode: calc.payRevision.revisionCode,
    payLevel: calc.level,
    cellNo: calc.cellNo,
    payMatrixCellNo: calc.cellNo,
    payMatrixId: calc.payMatrixId,
    daMasterId: calc.daMasterId || null,
    hraMasterId: calc.hraMasterId || null,
    taPayLevelGroup: calc.taPayLevelGroup || null,
    taBasicUpgradeThreshold:
      calc.taBasicUpgradeThreshold != null
        ? Number(calc.taBasicUpgradeThreshold)
        : null,
    taMasterId: calc.taMasterId || null,
    claPayLevelGroup: calc.claPayLevelGroup || null,
    payrollConfigId: calc.payrollConfig?.id || null,
    hraForcedZero,
    asOfDate: calc.asOfDate,
    fromSnapshot: false,
    basicPay,
    fixBasic,
    gradePay,
    totalBasic,
    totalBasicPay: totalBasic,
    da,
    daRate,
    hra,
    hraRate,
    ma,
    ta,
    cla,
    nppa,
    specialAllowance,
    washingAllowance,
    otherEarnings,
    grossAmount: grossSalary,
    grossSalary,
    gpfSubscription,
    gpfAdv: gpfAdvance,
    gpfAdvance,
    nps,
    npsAdvance: 0,
    /* Surfaced so the Salary Entry grid can keep the GPF/NPS cell
       non-editable for this row without recomputing the rule client-side
       from scratch (frontend/src/utils/retirementRules.js mirrors it for
       the same purpose when the operator edits Basic Pay etc. live). */
    gpfNpsRetirementStop: Boolean(calc.gpfNpsRetirementStop),
    npsManual: Boolean(manual.npsManual) && !manual.recalcFromBasic && !manual.basicDriven,
    incomeTax,
    professionTax: professionalTax,
    professionalTax,
    otherDeduction,
    totalDeduction,
    netSalary,
    chequeAmount,
    warnings: Array.isArray(calc.warnings) ? calc.warnings : [],
    displayOrder: extras.displayOrder || 1,
    salaryEmployeeDetailId: extras.salaryEmployeeDetailId ?? null,
    id: extras.salaryEmployeeDetailId ?? null,
  };
}

router.post("/calculate", async (req, res) => {
  try {
    const employeeId = Number(req.body?.employeeId);
    const asOfDate = req.body?.asOfDate || null;
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return res.status(400).json({ message: "EmployeeId is required." });
    }
    const data = await calculateForEmployee(employeeId, asOfDate);
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("POST /api/salary/calculate error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to calculate salary.",
      error: error.message,
    });
  }
});

router.post("/save-calculated", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const employeeId = Number(req.body?.employeeId);
    const salaryBillCodeId = Number(req.body?.salaryBillCodeId);
    const asOfDate = req.body?.asOfDate || null;
    const displayOrder = Number(req.body?.displayOrder) || 1;

    if (!Number.isFinite(employeeId) || !Number.isFinite(salaryBillCodeId)) {
      return res.status(400).json({
        message: "EmployeeId and SalaryBillCodeId are required.",
      });
    }

    const bill = await sql.query`
      SELECT TOP 1 BillCodeId, BillCode, Status
      FROM dbo.SalaryBillCodes
      WHERE BillCodeId = ${salaryBillCodeId}
    `;
    if (!bill.recordset[0]) {
      return res.status(404).json({ message: "Salary bill not found." });
    }
    if (String(bill.recordset[0].Status).toUpperCase() === "LOCKED") {
      return res.status(409).json({
        message: `Bill Code ${bill.recordset[0].BillCode} is locked and cannot be modified.`,
      });
    }

    const calc = await calculateForEmployee(employeeId, asOfDate);

    const saved = await withTransaction(async (transaction) => {
      const existingReq = makeRequest(transaction);
      const existing = await existingReq.query`
        SELECT TOP 1 Id, GPFAdvance
        FROM dbo.SalaryEmployeeDetails
        WHERE SalaryBillCodeId = ${salaryBillCodeId}
          AND EmployeeId = ${employeeId}
      `;

      let detailId = existing.recordset[0]?.Id
        ? Number(existing.recordset[0].Id)
        : null;
      /* Preserve an already-entered GPFAdvance on UPDATE — the calculate
         path always produces 0 for this field (Salary Entry no longer
         collects it via calculation) and must not wipe a stored value. */
      const preservedGpfAdvance =
        existing.recordset[0]?.GPFAdvance != null &&
        Number.isFinite(Number(existing.recordset[0].GPFAdvance))
          ? Number(existing.recordset[0].GPFAdvance)
          : calc.deductions.gpfAdvance;

      if (detailId) {
        const upd = makeRequest(transaction);
        await upd.query`
          UPDATE dbo.SalaryEmployeeDetails
          SET
            EmployeeName = ${calc.employee.employeeName},
            Designation = ${calc.employee.designation},
            EmployeeType = ${calc.employee.employeeType},
            DisplayOrder = ${displayOrder},
            BasicPay = ${calc.earnings.basicPay},
            GradePay = ${calc.earnings.gradePay},
            TotalBasic = ${calc.earnings.totalBasic},
            DA = ${calc.earnings.da},
            HRA = ${calc.earnings.hra},
            MA = ${calc.earnings.ma},
            TA = ${calc.earnings.ta},
            SpecialAllowance = ${calc.earnings.specialAllowance},
            WashingAllowance = ${calc.earnings.washingAllowance},
            GrossSalary = ${calc.earnings.grossSalary},
            GPFSubscription = ${calc.deductions.gpfSubscription},
            GPFAdvance = ${preservedGpfAdvance},
            NPS = ${calc.deductions.nps},
            IncomeTax = ${calc.deductions.incomeTax},
            ProfessionalTax = ${calc.deductions.professionalTax},
            OtherDeduction = ${calc.deductions.otherDeduction},
            TotalDeduction = ${calc.deductions.totalDeduction},
            NetSalary = ${calc.netSalary},
            ChequeAmount = ${calc.chequeAmount},
            InstituteCode = ${calc.employee.instituteCode || null},
            UpdatedDate = SYSUTCDATETIME()
          WHERE Id = ${detailId}
        `;
      } else {
        const ins = makeRequest(transaction);
        const inserted = await ins.query`
          INSERT INTO dbo.SalaryEmployeeDetails
            (
              SalaryBillCodeId, EmployeeId, EmployeeName, Designation, EmployeeType, DisplayOrder,
              BasicPay, GradePay, TotalBasic, DA, HRA, MA, TA, SpecialAllowance, WashingAllowance, GrossSalary,
              GPFSubscription, GPFAdvance, NPS, IncomeTax, ProfessionalTax, OtherDeduction, TotalDeduction, NetSalary,
              ChequeAmount, InstituteCode
            )
          OUTPUT INSERTED.Id
          VALUES
            (
              ${salaryBillCodeId},
              ${employeeId},
              ${calc.employee.employeeName},
              ${calc.employee.designation},
              ${calc.employee.employeeType},
              ${displayOrder},
              ${calc.earnings.basicPay},
              ${calc.earnings.gradePay},
              ${calc.earnings.totalBasic},
              ${calc.earnings.da},
              ${calc.earnings.hra},
              ${calc.earnings.ma},
              ${calc.earnings.ta},
              ${calc.earnings.specialAllowance},
              ${calc.earnings.washingAllowance},
              ${calc.earnings.grossSalary},
              ${calc.deductions.gpfSubscription},
              ${calc.deductions.gpfAdvance},
              ${calc.deductions.nps},
              ${calc.deductions.incomeTax},
              ${calc.deductions.professionalTax},
              ${calc.deductions.otherDeduction},
              ${calc.deductions.totalDeduction},
              ${calc.netSalary},
              ${calc.chequeAmount},
              ${calc.employee.instituteCode || null}
            )
        `;
        detailId = Number(inserted.recordset[0].Id);
      }

      const delComp = makeRequest(transaction);
      await delComp.query`
        DELETE FROM dbo.SalaryEmployeeComponentDetails
        WHERE SalaryEmployeeDetailId = ${detailId}
      `;

      for (const line of calc.components) {
        const insComp = makeRequest(transaction);
        await insComp.query`
          INSERT INTO dbo.SalaryEmployeeComponentDetails
            (SalaryEmployeeDetailId, SalaryComponentId, Amount, CalculationBase, Rate, Remarks, CreatedBy)
          VALUES
            (
              ${detailId},
              ${line.salaryComponentId},
              ${line.amount},
              ${line.calculationBase},
              ${line.rate},
              ${line.ruleSource || null},
              ${actor.fullName}
            )
        `;
      }

      try {
        const audit = makeRequest(transaction);
        await audit.query`
          INSERT INTO dbo.AuditLogs
            (ModuleName, ActionName, EntityKey, Details, UserName, FullName, TableName, RecordId, NewValues)
          VALUES
            (
              N'SalaryEntry',
              N'SAVE_CALCULATED',
              ${String(detailId)},
              N'Salary calculated and saved',
              ${actor.userName},
              ${actor.fullName},
              N'SalaryEmployeeDetails',
              ${String(detailId)},
              ${JSON.stringify({
                employeeId,
                salaryBillCodeId,
                basicPay: calc.basicPay,
                grossSalary: calc.earnings.grossSalary,
                netSalary: calc.netSalary,
              })}
            )
        `;
      } catch (_) {
        /* audit optional */
      }

      return { detailId, calc };
    });

    res.json({
      message: "Salary calculated and saved successfully.",
      data: {
        salaryEmployeeDetailId: saved.detailId,
        ...saved.calc,
      },
    });
  } catch (error) {
    console.error("POST /api/salary/save-calculated error:", error);
    res.status(500).json({
      message: error.message || "Unable to save calculated salary.",
      error: error.message,
    });
  }
});

module.exports = router;
module.exports.calculateForEmployee = calculateForEmployee;
module.exports.mapCalcToGridRow = mapCalcToGridRow;
module.exports.resolveBasicPay = resolveBasicPay;
module.exports.toNum = toNum;
module.exports.loadEmployee = loadEmployee;
