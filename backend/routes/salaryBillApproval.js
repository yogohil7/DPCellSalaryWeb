const express = require("express");
const { sql } = require("../db");
const { withTransaction } = require("./salaryEmployeeDetails");
const {
  getInstituteWorkflow,
  upsertInstituteWorkflow,
} = require("../utils/salaryBillInstituteWorkflow");
const { buildSalaryVariationReport } = require("../utils/salaryVariationReport");
const { calculateChequeAmount } = require("../utils/salaryBasicCalc");
const { requireRoles } = require("../middleware/auth");

const router = express.Router();

/*
  The router mount admits ACCOUNT_OFFICER and AUDITOR, because the Auditor's
  Returning Salary Bills queue (GET /returned) lives here.

  Every OTHER endpoint is an Account Officer function and carries this guard
  explicitly, so admitting the Auditor at the mount grants them exactly one
  read endpoint and nothing else.
*/
const accountOfficerOnly = requireRoles("ACCOUNT_OFFICER");

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
    roleName: body.roleName || body.actorRoleName || "",
  };
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Active user whose Roles.RoleName is exactly Auditor (role-based, not username). */
async function loadActiveAuditorById(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const result = await sql.query`
    SELECT TOP 1
      u.UserId,
      u.UserName,
      u.FullName,
      r.RoleId,
      r.RoleName
    FROM dbo.Users u
    INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
    WHERE u.UserId = ${id}
      AND ISNULL(u.IsActive, 0) = 1
      AND UPPER(LTRIM(RTRIM(r.RoleName))) = N'AUDITOR'
  `;
  const row = result.recordset[0];
  if (!row) return null;
  return {
    userId: Number(row.UserId),
    userName: row.UserName,
    fullName: row.FullName || row.UserName,
    roleId: Number(row.RoleId),
    roleName: row.RoleName,
  };
}

function mapDetailRow(row) {
  const basicPay = toNum(row.BasicPay);
  const gradePay = toNum(row.GradePay);
  const totalBasic = toNum(row.TotalBasic) || basicPay + gradePay;
  return {
    id: Number(row.Id),
    salaryEmployeeDetailId: Number(row.Id),
    employeeId: Number(row.EmployeeId),
    employeeName: row.EmployeeName || "",
    designation: row.Designation || "",
    employeeType: row.EmployeeType || "",
    pension: row.PensionType || "",
    displayOrder: Number(row.DisplayOrder) || 0,
    basicPay,
    gradePay,
    fixBasic: gradePay,
    totalBasic,
    totalBasicPay: totalBasic,
    da: toNum(row.DA),
    hra: toNum(row.HRA),
    ma: toNum(row.MA),
    ta: toNum(row.TA),
    cla: toNum(row.CLA),
    specialAllowance: toNum(row.SpecialAllowance),
    washingAllowance: toNum(row.WashingAllowance),
    otherEarnings: toNum(row.OtherEarnings),
    nppa: toNum(row.NPPA),
    grossSalary: toNum(row.GrossSalary),
    grossAmount: toNum(row.GrossSalary),
    gpfSubscription: toNum(row.GPFSubscription),
    /*
      Read the STORED GPF Advance. This was previously hard-coded to 0, so
      the Salary Bill Approval screen showed GPF Adv. as 0 for every
      employee regardless of what Salary Entry had saved. The row comes from
      `SELECT d.*` on dbo.SalaryEmployeeDetails, so the column was already
      being fetched — only the mapper discarded it. No query, calculation or
      total changes: the value is displayed as stored.
    */
    gpfAdvance: toNum(row.GPFAdvance),
    gpfAdv: toNum(row.GPFAdvance),
    nps: toNum(row.NPS),
    incomeTax: toNum(row.IncomeTax),
    professionalTax: toNum(row.ProfessionalTax),
    professionTax: toNum(row.ProfessionalTax),
    otherDeduction: toNum(row.OtherDeduction),
    totalDeduction: toNum(row.TotalDeduction),
    netSalary: toNum(row.NetSalary),
    chequeAmount: calculateChequeAmount({
      netSalary: toNum(row.NetSalary),
      incomeTax: toNum(row.IncomeTax),
      professionalTax: toNum(row.ProfessionalTax),
    }),
    instituteCode: row.InstituteCode || "",
    payLevel: row.PayLevel || "",
    cityClass: row.CityClass || "",
    asOfDate: row.AsOfDate || null,
    daRate: row.DAPercentage != null ? toNum(row.DAPercentage) : null,
    hraRate: row.HRAPercentage != null ? toNum(row.HRAPercentage) : null,
  };
}

function isDifferenceCategory(billCategory, billType) {
  const cat = String(billCategory || "").trim().toUpperCase();
  const typ = String(billType || "").trim().toUpperCase();
  return cat === "DIFFERENCE" || typ === "DA DIFFERENCE";
}

function mapInstituteBill(row) {
  const status = String(row.Status || "").toUpperCase();
  const billCategory = row.BillCategory || "";
  const billType = row.BillType || "";
  const isDaDifference = isDifferenceCategory(billCategory, billType);
  const fromMonth = row.FromSalaryMonth || row.DifferenceFromMonth || "";
  const fromYear = row.FromSalaryYear || row.DifferenceFromYear || "";
  const toMonth = row.ToSalaryMonth || row.DifferenceToMonth || "";
  const toYear = row.ToSalaryYear || row.DifferenceToYear || "";
  const differencePeriod =
    fromMonth && toMonth
      ? `${fromMonth} ${fromYear} to ${toMonth} ${toYear}`.trim()
      : "";
  return {
    id: `${row.BillCodeId}__${row.InstituteCode}`,
    workflowId: row.WorkflowId != null ? Number(row.WorkflowId) : null,
    billCodeId: Number(row.BillCodeId),
    billId: Number(row.BillCodeId),
    billCode: row.BillCode,
    instituteId: row.InstituteId != null ? Number(row.InstituteId) : null,
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || "",
    billMonth: row.BillMonth || "",
    salaryMonth: row.SalaryMonth || "",
    salaryYear: row.SalaryYear || "",
    billCategory,
    billType,
    isDaDifference,
    daDifferenceBillId:
      row.DADifferenceBillId != null ? Number(row.DADifferenceBillId) : null,
    paymentSalaryMonth: row.PaymentSalaryMonth || "",
    paymentSalaryYear: row.PaymentSalaryYear || "",
    fromSalaryMonth: fromMonth,
    fromSalaryYear: fromYear,
    toSalaryMonth: toMonth,
    toSalaryYear: toYear,
    differencePeriod,
    status,
    masterStatus: String(row.MasterStatus || row.BillCodeStatus || "").toUpperCase() || null,
    createdDate: row.CreatedDate || null,
    submittedDate: row.SubmittedDate || null,
    submittedBy: row.SubmittedBy || "",
    submittedByUserId:
      row.SubmittedByUserId != null ? Number(row.SubmittedByUserId) : null,
    verifiedDate: row.VerifiedDate || null,
    verifiedBy: row.VerifiedBy || "",
    approvedDate: row.ApprovedDate || null,
    approvedBy: row.ApprovedBy || "",
    returnedDate: row.ReturnedDate || null,
    returnedBy: row.ReturnedBy || "",
    returnedToAuditorId:
      row.ReturnedToAuditorId != null
        ? Number(row.ReturnedToAuditorId)
        : null,
    returnedRemarks: row.ReturnedRemarks || row.ReturnReason || "",
    returnReason: row.ReturnedRemarks || row.ReturnReason || "",
    assignedAuditorId:
      row.AssignedAuditorId != null
        ? Number(row.AssignedAuditorId)
        : row.SubmittedByUserId != null
          ? Number(row.SubmittedByUserId)
          : row.ReturnedToAuditorId != null
            ? Number(row.ReturnedToAuditorId)
            : null,
    assignedAuditor: row.AuditorName || "",
    auditorUserName: row.AuditorUserName || "",
    resubmittedDate: row.ResubmittedDate || null,
    resubmittedBy: row.ResubmittedBy || "",
    rejectedDate: row.RejectedDate || null,
    rejectedBy: row.RejectedBy || "",
    rejectReason: row.RejectReason || "",
    employeeCount: Number(row.EmployeeCount || 0),
    totalBasicPay: toNum(row.TotalBasicPay),
    totalEarnings: toNum(row.TotalEarnings),
    totalDeductions: toNum(row.TotalDeductions),
    netSalary: toNum(row.NetSalary),
    chequeAmount: toNum(row.ChequeAmount),
    grossAmount: toNum(row.TotalEarnings),
    totalDeduction: toNum(row.TotalDeductions),
  };
}

async function getBillByIdOrCode(idOrCode) {
  const raw = String(idOrCode || "").trim();
  if (!raw) return null;
  if (raw.includes("__")) {
    const billPart = raw.split("__")[0];
    return getBillByIdOrCode(billPart);
  }
  const asId = Number(raw);
  if (Number.isFinite(asId) && String(asId) === raw) {
    const byId = await sql.query`
      SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCodeId = ${asId}
    `;
    if (byId.recordset[0]) return byId.recordset[0];
  }
  const byCode = await sql.query`
    SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${raw}
  `;
  return byCode.recordset[0] || null;
}

async function loadEmployeeSnapshots(billCodeId, instituteCode) {
  const code = String(instituteCode || "").trim();
  if (!code) {
    return [];
  }
  const result = await sql.query`
    SELECT d.*
    FROM dbo.SalaryEmployeeDetails d
    WHERE d.SalaryBillCodeId = ${Number(billCodeId)}
      AND d.InstituteCode = ${code}
      AND (
        EXISTS (
          SELECT 1
          FROM dbo.EmployeeMaster e
          INNER JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
          WHERE e.EmployeeId = d.EmployeeId
            AND i.InstituteCode = ${code}
        )
        OR NOT EXISTS (
          SELECT 1 FROM dbo.EmployeeMaster e2 WHERE e2.EmployeeId = d.EmployeeId
        )
      )
    ORDER BY
      ISNULL(d.DisplayOrder, 9999),
      d.EmployeeId
  `;
  return result.recordset.map(mapDetailRow);
}

async function loadDaDifferenceHeader(billCodeId) {
  const result = await sql.query`
    SELECT TOP 1 *
    FROM dbo.DADifferenceBill
    WHERE SalaryBillCodeId = ${Number(billCodeId)}
  `;
  return result.recordset[0] || null;
}

function mapDaEmployeeRow(row, months = []) {
  const totalDiff = toNum(row.TotalDifferenceAmount);
  const totalNps = toNum(row.TotalNPSDeduction);
  const totalNet = toNum(row.TotalNetDifferenceAmount);
  return {
    id: Number(row.DADifferenceEmployeeDetailId),
    salaryEmployeeDetailId: null,
    daDifferenceEmployeeDetailId: Number(row.DADifferenceEmployeeDetailId),
    employeeId: Number(row.EmployeeId),
    employeeName: row.EmployeeName || "",
    employeeCode: row.EmployeeCode || "",
    designation: row.Designation || "",
    employeeType: row.EmployeeType || "",
    pension: "",
    displayOrder: Number(row.DisplayOrder) || 0,
    basicPay: 0,
    gradePay: 0,
    fixBasic: 0,
    totalBasic: 0,
    totalBasicPay: 0,
    da: 0,
    hra: 0,
    ma: 0,
    ta: 0,
    cla: 0,
    specialAllowance: 0,
    washingAllowance: 0,
    otherEarnings: 0,
    nppa: 0,
    grossSalary: totalDiff,
    grossAmount: totalDiff,
    /*
      DA Difference genuinely has no GPF: dbo.DADifferenceEmployeeDetails
      stores only TotalDifferenceAmount, TotalNPSDeduction and
      TotalNetDifferenceAmount. These zeros are structural, not a
      placeholder, and must NOT be "fixed" into a stored lookup.
    */
    gpfSubscription: 0,
    gpfAdvance: 0,
    gpfAdv: 0,
    nps: totalNps,
    incomeTax: 0,
    professionalTax: 0,
    professionTax: 0,
    otherDeduction: 0,
    totalDeduction: totalNps,
    netSalary: totalNet,
    chequeAmount: calculateChequeAmount({
      netSalary: totalNet,
      incomeTax: 0,
      professionalTax: 0,
    }),
    instituteCode: row.InstituteCode || "",
    payLevel: row.PayLevel || "",
    totalDifferenceAmount: totalDiff,
    totalNpsDeduction: totalNps,
    totalNetDifferenceAmount: totalNet,
    months,
  };
}

async function loadDaDifferenceSnapshots(billCodeId, instituteCode) {
  const code = String(instituteCode || "").trim();
  if (!code) return [];

  const header = await loadDaDifferenceHeader(billCodeId);
  if (!header) return [];

  const employeeRows = await sql.query`
    SELECT *
    FROM dbo.DADifferenceEmployeeDetails
    WHERE DADifferenceBillId = ${Number(header.DADifferenceBillId)}
      AND InstituteCode = ${code}
    ORDER BY ISNULL(DisplayOrder, 9999), EmployeeId
  `;

  const monthRows = await sql.query`
    SELECT *
    FROM dbo.DADifferenceMonthDetails
    WHERE DADifferenceBillId = ${Number(header.DADifferenceBillId)}
      AND InstituteCode = ${code}
    ORDER BY EmployeeId, SalaryYear, SalaryMonthNumber
  `;

  const byEmployee = new Map();
  for (const row of monthRows.recordset) {
    const key = Number(row.EmployeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push({
      salaryMonth: row.SalaryMonth,
      salaryMonthNumber: row.SalaryMonthNumber,
      salaryYear: row.SalaryYear,
      historicalBasic: toNum(row.HistoricalBasic),
      oldDA: toNum(row.OldDA),
      revisedDA: toNum(row.RevisedDA),
      differenceAmount: toNum(row.DifferenceAmount),
      npsDeduction: toNum(row.NPSDeduction),
      npsManual: Boolean(row.NPSManual),
      netDifferenceAmount: toNum(row.NetDifferenceAmount),
      snapshotMissing: Boolean(row.SnapshotMissing),
    });
  }

  return employeeRows.recordset.map((row) =>
    mapDaEmployeeRow(row, byEmployee.get(Number(row.EmployeeId)) || [])
  );
}

async function loadApprovalEmployees(bill, instituteCode) {
  if (isDifferenceCategory(bill.BillCategory, bill.BillType)) {
    return loadDaDifferenceSnapshots(Number(bill.BillCodeId), instituteCode);
  }
  return loadEmployeeSnapshots(Number(bill.BillCodeId), instituteCode);
}

async function loadHistory(billCodeId, instituteCode) {
  const result = await sql.query`
    SELECT *
    FROM dbo.SalaryBillApprovalHistory
    WHERE SalaryBillCodeId = ${Number(billCodeId)}
      AND (
        InstituteCode = ${String(instituteCode || "").trim()}
        OR InstituteCode IS NULL
      )
    ORDER BY ActionDate ASC, HistoryId ASC
  `;
  return result.recordset.map((row) => ({
    historyId: Number(row.HistoryId),
    action: row.Action,
    fromStatus: row.FromStatus,
    toStatus: row.ToStatus,
    actionBy: row.ActionBy,
    actionDate: row.ActionDate,
    assignedToUserId:
      row.AssignedToUserId != null ? Number(row.AssignedToUserId) : null,
    remarks: row.Remarks || "",
  }));
}

function computeTotals(employees) {
  return employees.reduce(
    (acc, row) => {
      acc.totalBasicPay += toNum(row.totalBasicPay);
      acc.grossAmount += toNum(row.grossSalary);
      acc.totalDeduction += toNum(row.totalDeduction);
      acc.netSalary += toNum(row.netSalary);
      acc.chequeAmount += toNum(row.chequeAmount);
      return acc;
    },
    {
      totalBasicPay: 0,
      grossAmount: 0,
      totalDeduction: 0,
      netSalary: 0,
      chequeAmount: 0,
    }
  );
}

/* GET /api/salary-bill-approval/variation-report
   AO-accessible previous-salary-month vs current-month comparison. */
router.get("/variation-report", accountOfficerOnly, async (req, res) => {
  try {
    const data = await buildSalaryVariationReport({
      billCode: req.query.billCode,
      instituteCode: req.query.instituteCode,
      previousBillCode: req.query.previousBillCode,
      compareMode: req.query.compareMode || "previousSalaryMonth",
    });
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/salary-bill-approval/variation-report error:", error);
    const status = error.status || 500;
    res.status(status).json({
      message: error.message || "Unable to load variation report.",
      error: error.message,
    });
  }
});

/* GET /api/salary-bill-approval/auditors
   Return-To-Auditor dropdown: active users whose role is Auditor only. */
router.get("/auditors", accountOfficerOnly, async (_req, res) => {
  try {
    const result = await sql.query`
      SELECT
        u.UserId,
        u.UserName,
        u.FullName,
        r.RoleId,
        r.RoleName
      FROM dbo.Users u
      INNER JOIN dbo.Roles r ON r.RoleId = u.RoleId
      WHERE ISNULL(u.IsActive, 0) = 1
        AND UPPER(LTRIM(RTRIM(r.RoleName))) = N'AUDITOR'
      ORDER BY
        u.FullName,
        u.UserName
    `;
    res.json({
      message: "OK",
      data: result.recordset.map((row) => ({
        userId: Number(row.UserId),
        userName: row.UserName,
        fullName: row.FullName || row.UserName,
        roleId: Number(row.RoleId),
        roleName: row.RoleName,
      })),
    });
  } catch (error) {
    console.error("GET auditors error:", error);
    res.status(500).json({
      message: "Unable to load auditors.",
      error: error.message,
    });
  }
});

/* GET /api/salary-bill-approval/returned?auditorUserId= */
router.get("/returned", async (req, res) => {
  try {
    /*
      Identity comes from the authenticated token, never from the query
      string. Query params are only a fallback for callers that predate
      authentication, and they can no longer widen access: an AUDITOR is
      always restricted to the bills returned to them personally.
    */
    const authRole = String(req.user?.roleKey || req.user?.roleName || "")
      .toUpperCase()
      .replace(/[_\s]+/g, " ")
      .trim();

    const isAuditor = authRole.includes("AUDITOR");
    const isAdmin =
      !isAuditor &&
      (authRole.includes("ADMIN") ||
        authRole.includes("ACCOUNT OFFICER") ||
        authRole.includes("SUPER"));

    /* An auditor may only ever see their own queue. */
    const auditorUserId = isAuditor
      ? Number(req.user?.userId)
      : Number(req.query.auditorUserId);

    if (isAuditor && !(Number.isFinite(auditorUserId) && auditorUserId > 0)) {
      return res.status(401).json({
        success: false,
        message: "Unable to identify the signed-in auditor.",
      });
    }

    const auditorFilter =
      Number.isFinite(auditorUserId) && auditorUserId > 0 && !isAdmin
        ? `AND w.ReturnedToAuditorId = ${Number(auditorUserId)}`
        : "";

    /* One production-safe line: enough to explain an empty queue without
       logging bill contents on every request. */
    console.log(
      `[returned-bills] userId=${req.user?.userId ?? "-"} ` +
        `role=${authRole || "-"} scope=${
          isAdmin ? "all" : `auditor:${auditorUserId || "-"}`
        }`
    );

    const result = await new sql.Request().query(`
      SELECT
        w.*,
        b.BillCode,
        b.BillMonth,
        b.SalaryMonth,
        b.SalaryYear,
        b.BillCategory,
        b.BillType,
        b.Status AS MasterStatus,
        b.CreatedDate,
        i.InstituteName,
        au.FullName AS AuditorName,
        au.UserName AS AuditorUserName,
        db.DADifferenceBillId,
        db.PaymentSalaryMonth,
        db.PaymentSalaryYear,
        db.FromSalaryMonth,
        db.FromSalaryYear,
        db.ToSalaryMonth,
        db.ToSalaryYear,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.EmployeeCount, 0)
          ELSE ISNULL(sed.EmployeeCount, 0)
        END AS EmployeeCount,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.TotalBasicPay, 0)
          ELSE ISNULL(sed.TotalBasicPay, 0)
        END AS TotalBasicPay,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.TotalEarnings, 0)
          ELSE ISNULL(sed.TotalEarnings, 0)
        END AS TotalEarnings,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.TotalDeductions, 0)
          ELSE ISNULL(sed.TotalDeductions, 0)
        END AS TotalDeductions,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.NetSalary, 0)
          ELSE ISNULL(sed.NetSalary, 0)
        END AS NetSalary,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.ChequeAmount, 0)
          ELSE ISNULL(sed.ChequeAmount, 0)
        END AS ChequeAmount
      FROM dbo.SalaryBillInstituteWorkflow w
      INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
      LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
      LEFT JOIN dbo.Users au ON au.UserId = w.ReturnedToAuditorId
      LEFT JOIN dbo.DADifferenceBill db ON db.SalaryBillCodeId = w.SalaryBillCodeId
      OUTER APPLY (
        SELECT
          COUNT(*) AS EmployeeCount,
          ISNULL(SUM(d.TotalBasic), 0) AS TotalBasicPay,
          ISNULL(SUM(d.GrossSalary), 0) AS TotalEarnings,
          ISNULL(SUM(d.TotalDeduction), 0) AS TotalDeductions,
          ISNULL(SUM(d.NetSalary), 0) AS NetSalary,
          ISNULL(SUM(
            ISNULL(d.NetSalary, 0) +
            ISNULL(d.IncomeTax, 0) +
            ISNULL(d.ProfessionalTax, 0)
          ), 0) AS ChequeAmount
        FROM dbo.SalaryEmployeeDetails d
        WHERE d.SalaryBillCodeId = w.SalaryBillCodeId
          AND d.InstituteCode = w.InstituteCode
      ) sed
      OUTER APPLY (
        SELECT
          COUNT(*) AS EmployeeCount,
          ISNULL(SUM(e.TotalDifferenceAmount), 0) AS TotalBasicPay,
          ISNULL(SUM(e.TotalDifferenceAmount), 0) AS TotalEarnings,
          ISNULL(SUM(e.TotalNPSDeduction), 0) AS TotalDeductions,
          ISNULL(SUM(e.TotalNetDifferenceAmount), 0) AS NetSalary,
          ISNULL(SUM(e.TotalNetDifferenceAmount), 0) AS ChequeAmount
        FROM dbo.DADifferenceEmployeeDetails e
        WHERE e.DADifferenceBillId = db.DADifferenceBillId
          AND e.InstituteCode = w.InstituteCode
      ) dad
      WHERE (
              UPPER(w.Status) = N'RETURNED'
              /*
                Recovery for bills already mid-correction: a Save Draft used
                to overwrite RETURNED with DRAFT, stranding the bill outside
                both queues. A DRAFT row that still carries
                ReturnedToAuditorId was returned to that auditor and is
                still theirs to correct, so it belongs in this list.
                SUBMITTED / RESUBMITTED are deliberately excluded — those are
                back with the Account Officer.
              */
              OR (
                UPPER(w.Status) = N'DRAFT'
                AND w.ReturnedToAuditorId IS NOT NULL
              )
              /*
                Phase 9 — REJECTED is correctable (Option B).
                A rejected bill is assigned back to the submitting auditor via
                ReturnedToAuditorId so it appears in their correction queue.
                RESUBMITTED is excluded — it is back with the Account Officer.
              */
              OR (
                UPPER(w.Status) = N'REJECTED'
                AND w.ReturnedToAuditorId IS NOT NULL
              )
            )
        ${auditorFilter}
      ORDER BY COALESCE(w.RejectedDate, w.ReturnedDate) DESC
    `);

    console.log(
      `[returned-bills] count=${result.recordset.length}` +
        (result.recordset.length === 0
          ? " (no RETURNED, REJECTED, or DRAFT+ReturnedToAuditorId rows for this scope)"
          : "")
    );

    res.json({
      message: "OK",
      data: result.recordset.map((row) =>
        mapInstituteBill({
          ...row,
          BillCodeId: row.SalaryBillCodeId,
        })
      ),
    });
  } catch (error) {
    console.error("GET returned bills error:", error);
    res.status(500).json({
      message: "Unable to load returned bills.",
      error: error.message,
    });
  }
});

/* GET /api/salary-bill-approval — institute-scoped pending list */
router.get("/", accountOfficerOnly, async (req, res) => {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[salary-bill-approval] DB ${process.env.DB_SERVER}/${process.env.DB_DATABASE}`
      );
    }

    const statusFilterRaw = String(req.query.status || "PENDING")
      .trim()
      .toUpperCase();
    const allowed = new Set([
      "PENDING",
      "ALL",
      "APPROVED",
      "RETURNED",
      "REJECTED",
      "SUBMITTED",
      "RESUBMITTED",
      "VERIFIED",
    ]);
    const statusFilter = allowed.has(statusFilterRaw)
      ? statusFilterRaw
      : "PENDING";

    /*
      Totals come from SalaryEmployeeDetails for Regular Salary bills, and from
      DADifferenceEmployeeDetails for DA Difference bills. An INNER JOIN on SED
      alone excluded every submitted DA Difference bill (SedCount = 0).

      PENDING opening-month rule (reuse Salary Bill Code Master "OPEN"):
      - Always include SUBMITTED / RESUBMITTED / VERIFIED (active AO queue).
      - Include APPROVED only when the bill still needs Lock and is either a
        DA Difference bill or matches the current OPEN Salary month/year.
      - Never list LOCKED / historical APPROVED salary months as pending.
    */
    const result = await new sql.Request().query(`
      SELECT
        w.WorkflowId,
        w.SalaryBillCodeId AS BillCodeId,
        w.InstituteId,
        w.InstituteCode,
        w.Status,
        b.Status AS MasterStatus,
        w.SubmittedDate,
        w.SubmittedBy,
        w.SubmittedByUserId,
        w.ReturnedDate,
        w.ReturnedBy,
        w.ReturnedToAuditorId,
        w.ReturnedRemarks,
        w.ResubmittedDate,
        w.ResubmittedBy,
        w.VerifiedDate,
        w.VerifiedBy,
        w.ApprovedDate,
        w.ApprovedBy,
        w.RejectedDate,
        w.RejectedBy,
        w.RejectReason,
        w.AssignedAuditorId,
        w.CreatedDate,
        b.BillCode,
        b.BillMonth,
        b.SalaryMonth,
        b.SalaryYear,
        b.BillCategory,
        b.BillType,
        i.InstituteName,
        au.FullName AS AuditorName,
        au.UserName AS AuditorUserName,
        db.DADifferenceBillId,
        db.PaymentSalaryMonth,
        db.PaymentSalaryYear,
        db.FromSalaryMonth,
        db.FromSalaryYear,
        db.ToSalaryMonth,
        db.ToSalaryYear,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.EmployeeCount, 0)
          ELSE ISNULL(sed.EmployeeCount, 0)
        END AS EmployeeCount,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.TotalBasicPay, 0)
          ELSE ISNULL(sed.TotalBasicPay, 0)
        END AS TotalBasicPay,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.TotalEarnings, 0)
          ELSE ISNULL(sed.TotalEarnings, 0)
        END AS TotalEarnings,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.TotalDeductions, 0)
          ELSE ISNULL(sed.TotalDeductions, 0)
        END AS TotalDeductions,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.NetSalary, 0)
          ELSE ISNULL(sed.NetSalary, 0)
        END AS NetSalary,
        CASE
          WHEN UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
            OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
          THEN ISNULL(dad.ChequeAmount, 0)
          ELSE ISNULL(sed.ChequeAmount, 0)
        END AS ChequeAmount
      FROM dbo.SalaryBillInstituteWorkflow w
      INNER JOIN dbo.SalaryBillCodes b ON b.BillCodeId = w.SalaryBillCodeId
      LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
      LEFT JOIN dbo.Users au
        ON au.UserId = COALESCE(
          w.AssignedAuditorId,
          w.SubmittedByUserId,
          w.ReturnedToAuditorId
        )
      LEFT JOIN dbo.DADifferenceBill db ON db.SalaryBillCodeId = w.SalaryBillCodeId
      OUTER APPLY (
        SELECT
          COUNT(*) AS EmployeeCount,
          ISNULL(SUM(d.TotalBasic), 0) AS TotalBasicPay,
          ISNULL(SUM(d.GrossSalary), 0) AS TotalEarnings,
          ISNULL(SUM(d.TotalDeduction), 0) AS TotalDeductions,
          ISNULL(SUM(d.NetSalary), 0) AS NetSalary,
          ISNULL(SUM(
            ISNULL(d.NetSalary, 0) +
            ISNULL(d.IncomeTax, 0) +
            ISNULL(d.ProfessionalTax, 0)
          ), 0) AS ChequeAmount
        FROM dbo.SalaryEmployeeDetails d
        WHERE d.SalaryBillCodeId = w.SalaryBillCodeId
          AND d.InstituteCode = w.InstituteCode
      ) sed
      OUTER APPLY (
        SELECT
          COUNT(*) AS EmployeeCount,
          ISNULL(SUM(e.TotalDifferenceAmount), 0) AS TotalBasicPay,
          ISNULL(SUM(e.TotalDifferenceAmount), 0) AS TotalEarnings,
          ISNULL(SUM(e.TotalNPSDeduction), 0) AS TotalDeductions,
          ISNULL(SUM(e.TotalNetDifferenceAmount), 0) AS NetSalary,
          ISNULL(SUM(e.TotalNetDifferenceAmount), 0) AS ChequeAmount
        FROM dbo.DADifferenceEmployeeDetails e
        WHERE e.DADifferenceBillId = db.DADifferenceBillId
          AND e.InstituteCode = w.InstituteCode
      ) dad
      WHERE (
        ('${statusFilter}' = 'PENDING' AND (
          UPPER(w.Status) IN (N'SUBMITTED', N'RESUBMITTED', N'VERIFIED')
          OR (
            UPPER(w.Status) = N'APPROVED'
            AND UPPER(ISNULL(b.Status, N'')) <> N'LOCKED'
            AND (
              UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
              OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
              OR EXISTS (
                SELECT 1
                FROM dbo.SalaryBillCodes openBill
                WHERE UPPER(openBill.Status) = N'OPEN'
                  AND UPPER(ISNULL(openBill.BillCategory, N'Salary')) = N'SALARY'
                  AND openBill.SalaryYear = b.SalaryYear
                  AND RIGHT(N'0' + LTRIM(RTRIM(ISNULL(openBill.SalaryMonthNumber, N''))), 2)
                    = RIGHT(N'0' + LTRIM(RTRIM(ISNULL(b.SalaryMonthNumber, N''))), 2)
              )
            )
          )
        ))
        OR ('${statusFilter}' = 'ALL' AND UPPER(w.Status) IN (N'SUBMITTED', N'RESUBMITTED', N'VERIFIED', N'APPROVED', N'RETURNED', N'REJECTED', N'LOCKED'))
        OR ('${statusFilter}' = 'APPROVED' AND UPPER(w.Status) = N'APPROVED')
        OR ('${statusFilter}' IN ('RETURNED', 'REJECTED') AND UPPER(w.Status) IN (N'RETURNED', N'REJECTED'))
        OR ('${statusFilter}' IN ('SUBMITTED', 'RESUBMITTED', 'VERIFIED') AND UPPER(w.Status) = '${statusFilter}')
      )
      AND (
        (
          UPPER(ISNULL(b.BillCategory, N'Salary')) = N'DIFFERENCE'
          OR UPPER(ISNULL(b.BillType, N'')) = N'DA DIFFERENCE'
        )
        AND ISNULL(dad.EmployeeCount, 0) > 0
        OR (
          UPPER(ISNULL(b.BillCategory, N'Salary')) <> N'DIFFERENCE'
          AND UPPER(ISNULL(b.BillType, N'')) <> N'DA DIFFERENCE'
          AND ISNULL(sed.EmployeeCount, 0) > 0
        )
      )
      ORDER BY
        ISNULL(w.ResubmittedDate, ISNULL(w.SubmittedDate, w.UpdatedDate)) DESC,
        w.SalaryBillCodeId DESC,
        w.InstituteCode
    `);

    res.json({
      message: "OK",
      data: result.recordset.map(mapInstituteBill),
    });
  } catch (error) {
    console.error("GET /api/salary-bill-approval error:", error);
    res.status(500).json({
      message: "Unable to load salary bills for approval.",
      error: error.message,
    });
  }
});

/* GET /api/salary-bill-approval/:idOrCode?instituteCode= */
router.get("/:idOrCode", accountOfficerOnly, async (req, res) => {
  try {
    const instituteCode = String(
      req.query.instituteCode ||
        (String(req.params.idOrCode).includes("__")
          ? String(req.params.idOrCode).split("__")[1]
          : "")
    ).trim();

    if (!instituteCode) {
      return res.status(400).json({
        message: "Institute code is required for salary bill approval detail.",
      });
    }

    const bill = await getBillByIdOrCode(req.params.idOrCode);
    if (!bill) {
      return res.status(404).json({ message: "Salary bill not found." });
    }

    const workflow = await getInstituteWorkflow(
      Number(bill.BillCodeId),
      instituteCode
    );
    if (!workflow) {
      return res.status(404).json({
        message: `No salary workflow found for bill ${bill.BillCode} / institute ${instituteCode}.`,
      });
    }

    const instituteRes = await sql.query`
      SELECT TOP 1 InstituteId, InstituteCode, InstituteName
      FROM dbo.Institutes
      WHERE InstituteCode = ${instituteCode}
    `;
    const institute = instituteRes.recordset[0] || {
      InstituteCode: instituteCode,
      InstituteName: instituteCode,
    };

    const daHeader = isDifferenceCategory(bill.BillCategory, bill.BillType)
      ? await loadDaDifferenceHeader(Number(bill.BillCodeId))
      : null;
    const employees = await loadApprovalEmployees(bill, instituteCode);
    const totals = computeTotals(employees);
    const history = await loadHistory(Number(bill.BillCodeId), instituteCode);

    let auditorName = "";
    let auditorUserName = "";
    const auditorId = workflow.ReturnedToAuditorId || workflow.AssignedAuditorId;
    if (auditorId) {
      const au = await sql.query`
        SELECT TOP 1 UserId, UserName, FullName
        FROM dbo.Users WHERE UserId = ${Number(auditorId)}
      `;
      if (au.recordset[0]) {
        auditorName = au.recordset[0].FullName || au.recordset[0].UserName;
        auditorUserName = au.recordset[0].UserName;
      }
    }

    const billPayload = mapInstituteBill({
      ...workflow,
      BillCodeId: bill.BillCodeId,
      BillCode: bill.BillCode,
      BillMonth: bill.BillMonth,
      SalaryMonth: bill.SalaryMonth,
      SalaryYear: bill.SalaryYear,
      BillCategory: bill.BillCategory,
      BillType: bill.BillType,
      MasterStatus: bill.Status,
      CreatedDate: bill.CreatedDate,
      InstituteName: institute.InstituteName,
      AuditorName: auditorName,
      AuditorUserName: auditorUserName,
      EmployeeCount: employees.length,
      TotalBasicPay: totals.totalBasicPay,
      TotalEarnings: totals.grossAmount,
      TotalDeductions: totals.totalDeduction,
      NetSalary: totals.netSalary,
      ChequeAmount: totals.chequeAmount,
      DADifferenceBillId: daHeader?.DADifferenceBillId,
      PaymentSalaryMonth: daHeader?.PaymentSalaryMonth,
      PaymentSalaryYear: daHeader?.PaymentSalaryYear,
      FromSalaryMonth: daHeader?.FromSalaryMonth,
      FromSalaryYear: daHeader?.FromSalaryYear,
      ToSalaryMonth: daHeader?.ToSalaryMonth,
      ToSalaryYear: daHeader?.ToSalaryYear,
    });

    res.json({
      message: "OK",
      data: {
        ...billPayload,
        bill: billPayload,
        employees,
        salaryLines: employees,
        monthDetails: employees.flatMap((row) =>
          (row.months || []).map((month) => ({
            ...month,
            employeeId: row.employeeId,
            employeeName: row.employeeName,
          }))
        ),
        totals: {
          grossAmount: totals.grossAmount,
          totalDeduction: totals.totalDeduction,
          netSalary: totals.netSalary,
          chequeAmount: totals.chequeAmount,
          totalBasicPay: totals.totalBasicPay,
          totalDifferenceAmount: totals.grossAmount,
          totalNpsDeduction: totals.totalDeduction,
          totalNetDifferenceAmount: totals.netSalary,
        },
        history,
      },
    });
  } catch (error) {
    console.error("GET approval detail error:", error);
    res.status(500).json({
      message: "Unable to load salary bill details.",
      error: error.message,
    });
  }
});

async function mutateInstituteStatus(req, res, nextStatus, extrasBuilder) {
  const actor = actorFromBody(req.body);
  const instituteCode = String(
    req.body?.instituteCode || req.query.instituteCode || ""
  ).trim();
  if (!instituteCode) {
    return res.status(400).json({ message: "Institute code is required." });
  }

  const bill = await getBillByIdOrCode(req.params.idOrCode);
  if (!bill) {
    return res.status(404).json({ message: "Salary bill not found." });
  }

  const masterStatus = String(bill.Status || "").toUpperCase();
  if (masterStatus === "LOCKED") {
    return res.status(403).json({
      message: `Salary Bill Code ${bill.BillCode} is LOCKED. Institute salary bills cannot be modified.`,
    });
  }

  const workflow = await getInstituteWorkflow(
    Number(bill.BillCodeId),
    instituteCode
  );
  if (!workflow) {
    return res.status(404).json({
      message: `No workflow for ${bill.BillCode} / ${instituteCode}.`,
    });
  }

  const current = String(workflow.Status || "").toUpperCase();
  const extras = extrasBuilder
    ? await Promise.resolve(extrasBuilder(req, workflow, current))
    : {};
  if (extras && extras.error) {
    return res.status(extras.error.status || 400).json({
      message: extras.error.message,
    });
  }

  const instituteRes = await sql.query`
    SELECT TOP 1 * FROM dbo.Institutes WHERE InstituteCode = ${instituteCode}
  `;
  const institute = instituteRes.recordset[0] || {
    InstituteCode: instituteCode,
    InstituteId: null,
  };

  await withTransaction(async (transaction) => {
    await upsertInstituteWorkflow(transaction, {
      bill,
      institute,
      nextStatus,
      actor,
      extras: extras || {},
    });

    /*
     * Do NOT update dbo.SalaryBillCodes here.
     * Master month status (OPEN / COMPLETED / LOCKED) is controlled only by
     * Salary Bill Code Master Complete/Lock Month. Institute Approve / Verify /
     * Return / Reject update SalaryBillInstituteWorkflow only.
     */
  });

  const refreshed = await getInstituteWorkflow(
    Number(bill.BillCodeId),
    instituteCode
  );
  const daHeader = isDifferenceCategory(bill.BillCategory, bill.BillType)
    ? await loadDaDifferenceHeader(Number(bill.BillCodeId))
    : null;
  const employees = await loadApprovalEmployees(bill, instituteCode);
  const totals = computeTotals(employees);

  res.json({
    message: `Salary bill ${String(nextStatus).toLowerCase()} successfully.`,
    data: {
      ...mapInstituteBill({
        ...refreshed,
        BillCodeId: bill.BillCodeId,
        BillCode: bill.BillCode,
        BillMonth: bill.BillMonth,
        SalaryMonth: bill.SalaryMonth,
        SalaryYear: bill.SalaryYear,
        BillCategory: bill.BillCategory,
        BillType: bill.BillType,
        MasterStatus: bill.Status,
        InstituteName: institute.InstituteName,
        EmployeeCount: employees.length,
        TotalBasicPay: totals.totalBasicPay,
        TotalEarnings: totals.grossAmount,
        TotalDeductions: totals.totalDeduction,
        NetSalary: totals.netSalary,
        ChequeAmount: totals.chequeAmount,
        DADifferenceBillId: daHeader?.DADifferenceBillId,
        PaymentSalaryMonth: daHeader?.PaymentSalaryMonth,
        PaymentSalaryYear: daHeader?.PaymentSalaryYear,
        FromSalaryMonth: daHeader?.FromSalaryMonth,
        FromSalaryYear: daHeader?.FromSalaryYear,
        ToSalaryMonth: daHeader?.ToSalaryMonth,
        ToSalaryYear: daHeader?.ToSalaryYear,
      }),
      salaryLines: employees,
      employees,
      totals,
    },
  });
}

router.post("/:idOrCode/verify", accountOfficerOnly, async (req, res) => {
  try {
    await mutateInstituteStatus(req, res, "VERIFIED", (_request, workflow) => {
      const current = String(workflow?.Status || "").toUpperCase();
      if (!["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(current)) {
        return {
          error: {
            status: 409,
            message: `Bill status ${current || "UNKNOWN"} cannot be verified.`,
          },
        };
      }
      return {};
    });
  } catch (error) {
    console.error("POST verify error:", error);
    res.status(500).json({
      message: error.message || "Unable to verify salary bill.",
      error: error.message,
    });
  }
});

/* POST /api/salary-bill-approval/:idOrCode/lock — locks one institute only.
   Does NOT change Salary Bill Code Master month status (OPEN/COMPLETED/LOCKED). */
router.post("/:idOrCode/lock", accountOfficerOnly, async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const instituteCode = String(req.body?.instituteCode || "").trim();
    const bill = await getBillByIdOrCode(req.params.idOrCode);
    if (!bill || !instituteCode) return res.status(400).json({ message: "Bill and Institute Code are required." });
    await withTransaction(async (transaction) => {
      const workflow = await getInstituteWorkflow(Number(bill.BillCodeId), instituteCode, transaction);
      if (!workflow) { const e = new Error("No workflow exists for this institute."); e.status = 404; throw e; }
      if (String(workflow.Status).toUpperCase() === "LOCKED") { const e = new Error("This institute salary bill is already locked."); e.status = 409; throw e; }
      if (String(workflow.Status).toUpperCase() !== "APPROVED") { const e = new Error("Only an approved institute salary bill can be locked."); e.status = 409; throw e; }
      const instituteRes = await new sql.Request(transaction).query`SELECT TOP 1 * FROM dbo.Institutes WHERE InstituteCode = ${instituteCode}`;
      const institute = instituteRes.recordset[0] || { InstituteCode: instituteCode, InstituteId: workflow.InstituteId };
      await upsertInstituteWorkflow(transaction, { bill, institute, nextStatus: "LOCKED", actor });
    });
    res.json({
      instituteLocked: true,
      monthLocked: false,
      message: "Institute salary bill locked successfully. Salary Bill Code Master month status is unchanged.",
    });
  } catch (error) { res.status(error.status || 500).json({ message: error.message || "Unable to lock institute salary bill." }); }
});

router.post("/:idOrCode/approve", accountOfficerOnly, async (req, res) => {
  try {
    await mutateInstituteStatus(req, res, "APPROVED", (_request, workflow) => {
      const current = String(workflow?.Status || "").toUpperCase();
      if (!["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(current)) {
        return {
          error: {
            status: 409,
            message: `Bill status ${current || "UNKNOWN"} cannot be approved.`,
          },
        };
      }
      return {};
    });
  } catch (error) {
    console.error("POST approve error:", error);
    res.status(500).json({
      message: error.message || "Unable to approve salary bill.",
      error: error.message,
    });
  }
});

router.post("/:idOrCode/return", accountOfficerOnly, async (req, res) => {
  try {
    await mutateInstituteStatus(req, res, "RETURNED", async (request, workflow) => {
      const current = String(workflow?.Status || "").toUpperCase();
      if (!["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(current)) {
        return {
          error: {
            status: 409,
            message: `Bill status ${current || "UNKNOWN"} cannot be returned.`,
          },
        };
      }
      const auditorId = Number(
        request.body?.returnedToAuditorId || request.body?.auditorUserId
      );
      const remarks = String(
        request.body?.returnedRemarks ||
          request.body?.returnReason ||
          request.body?.remarks ||
          ""
      ).trim();
      if (!Number.isFinite(auditorId) || auditorId <= 0) {
        return {
          error: { status: 400, message: "Please select an auditor." },
        };
      }
      if (!remarks) {
        return {
          error: { status: 400, message: "Return remarks are required." },
        };
      }
      const auditor = await loadActiveAuditorById(auditorId);
      if (!auditor) {
        return {
          error: {
            status: 400,
            message:
              "Return target must be an active user with the Auditor role.",
          },
        };
      }
      return {
        returnedToAuditorId: auditor.userId,
        returnedRemarks: remarks,
      };
    });
  } catch (error) {
    console.error("POST return error:", error);
    res.status(500).json({
      message: error.message || "Unable to return salary bill.",
      error: error.message,
    });
  }
});

router.post("/:idOrCode/reject", accountOfficerOnly, async (req, res) => {
  try {
    await mutateInstituteStatus(req, res, "REJECTED", (request, workflow) => {
      const current = String(workflow?.Status || "").toUpperCase();
      if (!["SUBMITTED", "RESUBMITTED", "VERIFIED"].includes(current)) {
        return {
          error: {
            status: 409,
            message: `Bill status ${current || "UNKNOWN"} cannot be rejected.`,
          },
        };
      }
      const reason = String(
        request.body?.rejectReason || request.body?.reason || ""
      ).trim();
      if (!reason) {
        return {
          error: { status: 400, message: "Reject reason is required." },
        };
      }
      /*
       * Phase 9 — REJECTED is correctable (Option B).
       * Assign the rejected bill back to the auditor who submitted it so it
       * appears in their correction queue (GET /returned).
       * Priority: explicit body param → existing workflow ReturnedToAuditorId
       * → original SubmittedByUserId (the submitting auditor).
       * upsertInstituteWorkflow stores this into ReturnedToAuditorId so no
       * schema change is required.
       */
      const rejectedToAuditorId =
        request.body?.rejectedToAuditorId != null
          ? Number(request.body.rejectedToAuditorId)
          : workflow?.ReturnedToAuditorId != null
            ? Number(workflow.ReturnedToAuditorId)
            : workflow?.AssignedAuditorId != null
              ? Number(workflow.AssignedAuditorId)
              : workflow?.SubmittedByUserId != null
                ? Number(workflow.SubmittedByUserId)
                : null;

      return { rejectReason: reason, rejectedToAuditorId };
    });
  } catch (error) {
    console.error("POST reject error:", error);
    res.status(500).json({
      message: error.message || "Unable to reject salary bill.",
      error: error.message,
    });
  }
});

module.exports = router;

/* Exported for offline tests (scripts/testManualTransportAllowance.js). */
module.exports.mapDetailRow = mapDetailRow;
