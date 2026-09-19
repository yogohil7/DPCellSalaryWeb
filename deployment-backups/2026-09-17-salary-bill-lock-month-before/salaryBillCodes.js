const express = require("express");
const { sql } = require("../db");
const {
  lockedEmployeeMessage,
  getEmployeesByBillCodeId,
  replaceEmployeesForBill,
  copyEmployeesBetweenBills,
  calcTotals,
  mapEmployeeRow,
  withTransaction,
} = require("./salaryEmployeeDetails");
const { isAdminRole } = require("../middleware/auth");

const router = express.Router();

const VALID_STATUSES = ["OPEN", "COMPLETED", "LOCKED"];

/*
 * Canonical "main salary bill" rule, shared with the Final Salary Bill
 * screen (frontend/src/pages/FinalSalaryBill.jsx keeps the same rule inline
 * because the bundles cannot share code — keep both copies identical).
 *
 * Main bill = Salary category, Regular (non-Difference) type, BillCode
 * without the Bill-Month variant suffix that resolveSalaryEntryBill.js
 * creates ("-BM-XXX"). BM variants, DA Difference bills and archived bills
 * are never main bills.
 */
function isMainSalaryBill(bill) {
  const code = String(bill?.billCode ?? bill?.BillCode ?? "");
  const category = String(bill?.billCategory ?? bill?.BillCategory ?? "")
    .trim()
    .toUpperCase();
  const type = String(bill?.billType ?? bill?.BillType ?? "")
    .trim()
    .toUpperCase();
  if (!code || /-BM-[A-Z]{3}$/i.test(code)) return false;
  if (category !== "SALARY") return false;
  if (type.includes("DIFFERENCE")) return false;
  if (bill?.isArchived ?? bill?.IsArchived) return false;
  return true;
}

/* A main salary bill whose salary month is closed (COMPLETED or LOCKED). */
function isClosedMainSalaryBill(bill) {
  if (!isMainSalaryBill(bill)) return false;
  const status = String(bill?.status ?? bill?.Status ?? "").trim().toUpperCase();
  return status === "COMPLETED" || status === "LOCKED";
}

const PENDING_BILL_STATUSES = [
  "DRAFT",
  "SAVED",
  "SUBMITTED",
  "RESUBMITTED",
  "RETURNED",
  "VERIFIED",
];

const MONTHS = [
  { number: "01", name: "January", short: "JAN" },
  { number: "02", name: "February", short: "FEB" },
  { number: "03", name: "March", short: "MAR" },
  { number: "04", name: "April", short: "APR" },
  { number: "05", name: "May", short: "MAY" },
  { number: "06", name: "June", short: "JUN" },
  { number: "07", name: "July", short: "JUL" },
  { number: "08", name: "August", short: "AUG" },
  { number: "09", name: "September", short: "SEP" },
  { number: "10", name: "October", short: "OCT" },
  { number: "11", name: "November", short: "NOV" },
  { number: "12", name: "December", short: "DEC" },
];

function normalizeBillPayload(body = {}) {
  const year = String(body.salaryYear || "").trim();
  const month = MONTHS.find((item) => item.number === String(body.salaryMonthNumber || ""));
  const category = String(body.billCategory || "").trim();
  const billType = String(body.billType || "").trim();

  if (!month || !/^\d{4}$/.test(year) || !category || !billType) {
    return { error: "A valid Salary Month, four-digit Salary Year, Category and Type are required." };
  }

  const suffixByType = {
    "Higher Gradepay Diff. Difference": "HGP-DIFF",
    "DA Difference": "DA-DIFF",
    "HRA Difference": "HRA-DIFF",
    "CLA Difference": "CLA-DIFF",
    "Medical Allowance Difference": "MEDICAL-DIFF",
    "Transport Allowance Difference": "TA-DIFF",
  };
  if (category === "Salary" && billType !== "Regular Salary") {
    return { error: "Salary Bill Category requires the Regular Salary Bill Type." };
  }
  if (category === "Difference" && !suffixByType[billType]) {
    return { error: "Select a valid Difference Bill Type." };
  }
  if (category !== "Salary" && category !== "Difference") {
    return { error: "Select a valid Bill Category." };
  }
  const expectedBillCode =
    category === "Salary"
      ? `${month.short}-${year}`
      : suffixByType[billType]
        ? `${month.short}-${year}-${suffixByType[billType]}`
        : null;

  if (!expectedBillCode || String(body.billCode || "").trim() !== expectedBillCode) {
    return { error: `Bill Code must be ${expectedBillCode || "generated from the selected category and type"}.` };
  }

  return {
    billCode: expectedBillCode,
    salaryMonth: month.name,
    salaryMonthNumber: month.number,
    salaryYear: year,
    billCategory: category,
    billType,
  };
}

function actorFromBody(body = {}) {
  return {
    userName: body.userName || body.actorUserName || "SYSTEM",
    fullName: body.fullName || body.actorFullName || body.userName || "SYSTEM",
  };
}

function mapRow(row) {
  return {
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
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    completedDate: row.CompletedDate,
    completedBy: row.CompletedBy,
    lockedDate: row.LockedDate,
    lockedBy: row.LockedBy,
    copiedFromBillCode: row.CopiedFromBillCode,
    updatedDate: row.UpdatedDate,
    updatedBy: row.UpdatedBy,
    monthName: monthLabelFromCode(row.SalaryMonth || row.BillMonth),
    isArchived: Boolean(row.IsArchived),
  };
}

/* BillMonth may differ from SalaryMonth for OLD salary (arrears) bills.
   When billMonth is omitted, mirror SalaryMonth for compatibility. */
function resolveBillMonth(salaryMonth, billMonth) {
  const bill = billMonth != null ? String(billMonth).trim() : "";
  if (bill) return bill;
  return salaryMonth || null;
}

function monthLabelFromCode(code) {
  if (!code) return "";
  const prefix = String(code).split("-")[0]?.toUpperCase();
  const map = {
    JAN: "January",
    FEB: "February",
    MAR: "March",
    APR: "April",
    MAY: "May",
    JUN: "June",
    JUL: "July",
    AUG: "August",
    SEP: "September",
    OCT: "October",
    NOV: "November",
    DEC: "December",
  };
  return map[prefix] || prefix || "";
}

async function writeAudit({
  actionName,
  entityKey,
  sourceKey = null,
  newKey = null,
  details = null,
  userName,
  fullName,
}) {
  await sql.query`
    INSERT INTO dbo.AuditLogs
      (ModuleName, ActionName, EntityKey, SourceKey, NewKey, Details, UserName, FullName)
    VALUES
      (
        N'SalaryBillCode',
        ${actionName},
        ${entityKey},
        ${sourceKey},
        ${newKey},
        ${details},
        ${userName},
        ${fullName}
      )
  `;
}

async function getByCode(billCode) {
  const result = await sql.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillCodes
    WHERE BillCode = ${billCode}
  `;
  return result.recordset[0] || null;
}

async function getById(id) {
  const result = await sql.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillCodes
    WHERE BillCodeId = ${id}
  `;
  return result.recordset[0] || null;
}

async function getBySalaryPeriod(salaryMonth, salaryYear, billCategory, billType, billMonth = null) {
  if (billMonth) {
    const result = await sql.query`
      SELECT TOP 1 *
      FROM dbo.SalaryBillCodes
      WHERE SalaryMonth = ${salaryMonth}
        AND SalaryYear = ${salaryYear}
        AND BillCategory = ${billCategory}
        AND BillType = ${billType}
        AND BillMonth = ${billMonth}
    `;
    return result.recordset[0] || null;
  }
  const result = await sql.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillCodes
    WHERE SalaryMonth = ${salaryMonth}
      AND SalaryYear = ${salaryYear}
      AND BillCategory = ${billCategory}
      AND BillType = ${billType}
      AND (
        BillMonth = ${salaryMonth}
        OR BillMonth IS NULL
        OR LTRIM(RTRIM(BillMonth)) = N''
      )
  `;
  return result.recordset[0] || null;
}

async function countPendingSalaryBills(billCode) {
  const exists = await sql.query`
    SELECT CASE WHEN OBJECT_ID(N'dbo.SalaryBills', N'U') IS NULL THEN 0 ELSE 1 END AS HasTable
  `;

  if (!exists.recordset[0]?.HasTable) {
    return 0;
  }

  const result = await sql.query`
    SELECT COUNT(1) AS PendingCount
    FROM dbo.SalaryBills
    WHERE BillCode = ${billCode}
      AND UPPER(Status) IN (
        N'DRAFT', N'SAVED', N'SUBMITTED', N'RESUBMITTED', N'RETURNED', N'VERIFIED'
      )
  `;

  return Number(result.recordset[0]?.PendingCount || 0);
}

function lockedMessage(billCode) {
  return `Bill Code ${billCode} is locked and cannot be modified.`;
}

/* GET /api/salary-bill-codes */
router.get("/", async (req, res) => {
  try {
    /* ?status=OPEN lets callers (e.g. Salary Entry) filter in SQL, not in the UI. */
    const statusFilter = String(req.query?.status || "").trim().toUpperCase();
    const categoryFilter = String(req.query?.category || "").trim().toUpperCase();
    const includeArchived =
      String(req.query?.includeArchived || "").trim() === "1" ||
      String(req.query?.includeArchived || "").toLowerCase() === "true";

    let result;
    if (includeArchived) {
      if (statusFilter && categoryFilter) {
        result = await sql.query`
          SELECT * FROM dbo.SalaryBillCodes
          WHERE UPPER(LTRIM(RTRIM(Status))) = ${statusFilter}
            AND UPPER(LTRIM(RTRIM(BillCategory))) = ${categoryFilter}
          ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
        `;
      } else if (statusFilter) {
        result = await sql.query`
          SELECT * FROM dbo.SalaryBillCodes
          WHERE UPPER(LTRIM(RTRIM(Status))) = ${statusFilter}
          ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
        `;
      } else if (categoryFilter) {
        result = await sql.query`
          SELECT * FROM dbo.SalaryBillCodes
          WHERE UPPER(LTRIM(RTRIM(BillCategory))) = ${categoryFilter}
          ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
        `;
      } else {
        result = await sql.query`
          SELECT * FROM dbo.SalaryBillCodes
          ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
        `;
      }
    } else if (statusFilter && categoryFilter) {
      result = await sql.query`
        SELECT * FROM dbo.SalaryBillCodes
        WHERE UPPER(LTRIM(RTRIM(Status))) = ${statusFilter}
          AND UPPER(LTRIM(RTRIM(BillCategory))) = ${categoryFilter}
          AND ISNULL(IsArchived, 0) = 0
        ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
      `;
    } else if (statusFilter) {
      result = await sql.query`
        SELECT * FROM dbo.SalaryBillCodes
        WHERE UPPER(LTRIM(RTRIM(Status))) = ${statusFilter}
          AND ISNULL(IsArchived, 0) = 0
        ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
      `;
    } else if (categoryFilter) {
      result = await sql.query`
        SELECT * FROM dbo.SalaryBillCodes
        WHERE UPPER(LTRIM(RTRIM(BillCategory))) = ${categoryFilter}
          AND ISNULL(IsArchived, 0) = 0
        ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
      `;
    } else {
      result = await sql.query`
        SELECT * FROM dbo.SalaryBillCodes
        WHERE ISNULL(IsArchived, 0) = 0
        ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
      `;
    }

    res.json({
      message: "OK",
      data: result.recordset.map(mapRow),
    });
  } catch (error) {
    console.error("GET /api/salary-bill-codes error:", error);
    const missingCol = /invalid column name.*isarchived/i.test(
      String(error.message || "")
    );
    if (missingCol) {
      /* Pre-migration fallback */
      const statusFilter = String(req.query?.status || "").trim().toUpperCase();
      const fallback = statusFilter
        ? await sql.query`
            SELECT * FROM dbo.SalaryBillCodes
            WHERE UPPER(LTRIM(RTRIM(Status))) = ${statusFilter}
            ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
          `
        : await sql.query`
            SELECT * FROM dbo.SalaryBillCodes
            ORDER BY SalaryYear DESC, SalaryMonth DESC, BillCodeId DESC
          `;
      return res.json({ message: "OK", data: fallback.recordset.map(mapRow) });
    }
    const missingTable = String(error.message || "")
      .toLowerCase()
      .includes("invalid object name");
    res.status(500).json({
      message: missingTable
        ? "SalaryBillCodes table is missing. Run: node scripts/applySalaryBillCodeMigrations.js"
        : "Unable to load salary bill codes.",
      error: error.message,
    });
  }
});

/*
 * Salary Entry employee data may only be modified while the bill is OPEN.
 * RETURNED / REJECTED are tolerated for the correct-and-resubmit flow.
 * Everything else is rejected so the API cannot be driven by hand.
 */
const ENTRY_MODIFIABLE_STATUSES = new Set(["OPEN", "RETURNED", "REJECTED"]);

function assertCanModifyEmployees(billRow) {
  if (!billRow) {
    return { status: 404, message: "Bill Code not found." };
  }
  const status = String(billRow.Status || "").trim().toUpperCase();
  if (status === "LOCKED") {
    return {
      status: 403,
      message: lockedEmployeeMessage(billRow.BillCode),
    };
  }
  if (!ENTRY_MODIFIABLE_STATUSES.has(status)) {
    return {
      status: 409,
      message: `Bill Code ${billRow.BillCode} is ${status || "UNKNOWN"}. Only OPEN bill codes can be modified from Salary Entry.`,
    };
  }
  return null;
}

/* GET /api/salary-bill-codes/:billCode/employees */
router.get("/:billCode/employees", async (req, res) => {
  try {
    const bill = await getByCode(req.params.billCode);
    if (!bill) {
      return res.status(404).json({ message: "Bill Code not found." });
    }

    const employees = await getEmployeesByBillCodeId(bill.BillCodeId);
    res.json({
      message: "OK",
      billCode: bill.BillCode,
      status: bill.Status,
      data: employees,
    });
  } catch (error) {
    console.error("GET employees error:", error);
    res.status(500).json({
      message: "Unable to load employee salary data.",
      error: error.message,
    });
  }
});

/* POST /api/salary-bill-codes/:billCode/employees  — save/replace all employees (Save Draft) */
router.post("/:billCode/employees", async (req, res) => {
  try {
    const bill = await getByCode(req.params.billCode);
    const blocked = assertCanModifyEmployees(bill);
    if (blocked) {
      return res.status(blocked.status).json({ message: blocked.message });
    }

    const employees = Array.isArray(req.body?.employees)
      ? req.body.employees
      : Array.isArray(req.body)
        ? req.body
        : [];
    const instituteCode = req.body?.instituteCode || null;

    if (!employees.length) {
      return res.status(400).json({
        message: "At least one employee is required to save.",
      });
    }

    await withTransaction(async (transaction) => {
      await replaceEmployeesForBill(
        transaction,
        bill.BillCodeId,
        employees,
        instituteCode
      );
    });

    const saved = await getEmployeesByBillCodeId(bill.BillCodeId);
    res.json({
      message: "Employee salary data saved successfully.",
      data: saved,
    });
  } catch (error) {
    console.error("POST employees error:", error);
    res.status(500).json({
      message: "Unable to save employee salary data.",
      error: error.message,
    });
  }
});

/* PUT /api/salary-bill-codes/:billCode/employees/:employeeId */
router.put("/:billCode/employees/:employeeId", async (req, res) => {
  try {
    const bill = await getByCode(req.params.billCode);
    const blocked = assertCanModifyEmployees(bill);
    if (blocked) {
      return res.status(blocked.status).json({ message: blocked.message });
    }

    const employeeId = Number(req.params.employeeId);
    const totals = calcTotals(req.body || {});
    const designation = req.body?.designation || "";
    const employeeType = req.body?.employeeType || "";
    const employeeName = req.body?.employeeName || `Employee ${employeeId}`;
    const displayOrder = Number(req.body?.displayOrder) || 1;

    const updated = await sql.query`
      UPDATE dbo.SalaryEmployeeDetails
      SET
        EmployeeName = ${employeeName},
        Designation = ${designation},
        EmployeeType = ${employeeType},
        DisplayOrder = ${displayOrder},
        BasicPay = ${totals.basicPay},
        GradePay = ${totals.gradePay},
        TotalBasic = ${totals.totalBasic},
        DA = ${totals.da},
        HRA = ${totals.hra},
        MA = ${totals.ma},
        TA = ${totals.ta},
        SpecialAllowance = ${totals.specialAllowance},
        WashingAllowance = ${totals.washingAllowance},
        GrossSalary = ${totals.grossSalary},
        GPFSubscription = ${totals.gpfSubscription},
        GPFAdvance = ${totals.gpfAdvance},
        NPS = ${totals.nps},
        IncomeTax = ${totals.incomeTax},
        ProfessionalTax = ${totals.professionalTax},
        OtherDeduction = ${totals.otherDeduction},
        TotalDeduction = ${totals.totalDeduction},
        NetSalary = ${totals.netSalary},
        UpdatedDate = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE SalaryBillCodeId = ${bill.BillCodeId}
        AND EmployeeId = ${employeeId}
    `;

    if (!updated.recordset[0]) {
      return res.status(404).json({ message: "Employee not found for this Bill Code." });
    }

    res.json({
      message: "Employee updated successfully.",
      data: mapEmployeeRow(updated.recordset[0]),
    });
  } catch (error) {
    console.error("PUT employee error:", error);
    res.status(500).json({
      message: "Unable to update employee.",
      error: error.message,
    });
  }
});

/* PUT /api/salary-bill-codes/:billCode/employee-order */
router.put("/:billCode/employee-order", async (req, res) => {
  try {
    const bill = await getByCode(req.params.billCode);
    const blocked = assertCanModifyEmployees(bill);
    if (blocked) {
      return res.status(blocked.status).json({ message: blocked.message });
    }

    const orderList = Array.isArray(req.body?.order)
      ? req.body.order
      : Array.isArray(req.body?.employees)
        ? req.body.employees
        : [];

    if (!orderList.length) {
      return res.status(400).json({ message: "Employee order list is required." });
    }

    await withTransaction(async (transaction) => {
      for (let i = 0; i < orderList.length; i += 1) {
        const item = orderList[i];
        const employeeId = Number(item.employeeId ?? item);
        const displayOrder = Number(item.displayOrder != null ? item.displayOrder : i + 1);
        const request = new sql.Request(transaction);
        await request.query`
          UPDATE dbo.SalaryEmployeeDetails
          SET
            DisplayOrder = ${displayOrder},
            UpdatedDate = SYSUTCDATETIME()
          WHERE SalaryBillCodeId = ${bill.BillCodeId}
            AND EmployeeId = ${employeeId}
        `;
      }
    });

    const employees = await getEmployeesByBillCodeId(bill.BillCodeId);
    res.json({
      message: "Employee order saved successfully.",
      data: employees,
    });
  } catch (error) {
    console.error("PUT employee-order error:", error);
    res.status(500).json({
      message: "Unable to save employee order.",
      error: error.message,
    });
  }
});

/* POST /api/salary-bill-codes/:billCode/copy-employees */
router.post("/:billCode/copy-employees", async (req, res) => {
  try {
    const source = await getByCode(req.params.billCode);
    if (!source) {
      return res.status(404).json({ message: "Source Bill Code not found." });
    }

    const targetCode = req.body?.targetBillCode;
    if (!targetCode) {
      return res.status(400).json({ message: "targetBillCode is required." });
    }

    const target = await getByCode(targetCode);
    const blocked = assertCanModifyEmployees(target);
    if (blocked) {
      return res.status(blocked.status).json({ message: blocked.message });
    }

    await withTransaction(async (transaction) => {
      const deleteRequest = new sql.Request(transaction);
      await deleteRequest.query`
        DELETE FROM dbo.SalaryEmployeeDetails
        WHERE SalaryBillCodeId = ${target.BillCodeId}
      `;
      await copyEmployeesBetweenBills(transaction, source.BillCodeId, target.BillCodeId);
    });

    const employees = await getEmployeesByBillCodeId(target.BillCodeId);
    res.json({
      message: `Employees copied from ${source.BillCode} to ${target.BillCode}.`,
      data: employees,
    });
  } catch (error) {
    console.error("POST copy-employees error:", error);
    res.status(500).json({
      message: "Unable to copy employees.",
      error: error.message,
    });
  }
});

/* GET /api/salary-bill-codes/:billCode */
router.get("/:billCode", async (req, res) => {
  try {
    const row = await getByCode(req.params.billCode);
    if (!row) {
      return res.status(404).json({ message: "Bill Code not found." });
    }
    res.json({ message: "OK", data: mapRow(row) });
  } catch (error) {
    console.error("Get salary bill code error:", error);
    res.status(500).json({ message: "Unable to load bill code." });
  }
});

/* POST /api/salary-bill-codes */
router.post("/", async (req, res) => {
  try {
    const normalized = normalizeBillPayload(req.body);
    const { description } = req.body || {};

    const actor = actorFromBody(req.body);

    if (normalized.error) {
      return res.status(400).json({ message: normalized.error });
    }
    const { billCode, salaryMonth, salaryMonthNumber, salaryYear, billCategory, billType } = normalized;
    const resolvedBillMonth = resolveBillMonth(salaryMonth, req.body?.billMonth);

    const existing = await getByCode(billCode);
    if (existing) {
      return res.status(409).json({
        message: `Bill Code ${billCode} already exists.`,
      });
    }

    const samePeriod = await getBySalaryPeriod(
      salaryMonth, salaryYear, billCategory, billType, resolvedBillMonth
    );
    if (samePeriod) {
      return res.status(409).json({
        message: `A ${billCategory} / ${billType} Bill Code already exists for Bill Month ${resolvedBillMonth} / Salary Month ${salaryMonth} ${salaryYear}.`,
      });
    }

    const insert = await sql.query`
      INSERT INTO dbo.SalaryBillCodes
        (
          BillCode, BillMonth, SalaryMonth, SalaryMonthNumber, SalaryYear,
          BillCategory, BillType, Description, Status, CreatedBy
        )
      OUTPUT INSERTED.*
      VALUES
        (
          ${billCode},
          ${resolvedBillMonth},
          ${salaryMonth},
          ${salaryMonthNumber || null},
          ${salaryYear},
          ${billCategory},
          ${billType},
          ${description || ""},
          N'OPEN',
          ${actor.fullName}
        )
    `;

    const created = insert.recordset[0];

    await writeAudit({
      actionName: "Bill Code Created",
      entityKey: billCode,
      newKey: billCode,
      details: `Created with status OPEN`,
      userName: actor.userName,
      fullName: actor.fullName,
    });

    res.status(201).json({
      message: "Salary Bill Code saved successfully.",
      data: mapRow(created),
    });
  } catch (error) {
    console.error("Create salary bill code error:", error);
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({
        message: `Bill Code ${req.body?.billCode || ""} already exists.`,
      });
    }
    res.status(500).json({ message: "Unable to create bill code." });
  }
});

/* PUT /api/salary-bill-codes/:id */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await getById(id);

    if (!current) {
      return res.status(404).json({ message: "Bill Code not found." });
    }

    if (current.Status === "LOCKED") {
      return res.status(403).json({
        message: lockedMessage(current.BillCode),
      });
    }

    if (current.Status === "COMPLETED") {
      return res.status(403).json({
        message: `Bill Code ${current.BillCode} is completed. Use Complete & Lock or Copy to New Month.`,
      });
    }

    const {
      billCode,
      salaryMonth,
      salaryMonthNumber,
      salaryYear,
      billCategory,
      billType,
      description,
    } = req.body || {};

    const actor = actorFromBody(req.body);
    const resolvedBillMonth = resolveBillMonth(salaryMonth, req.body?.billMonth);

    if (!billCode || !salaryMonth || !salaryYear || !billCategory || !billType) {
      return res.status(400).json({
        message: "Bill Code, Salary Month, Salary Year, Category and Type are required.",
      });
    }

    if (billCode !== current.BillCode) {
      const duplicate = await getByCode(billCode);
      if (duplicate) {
        return res.status(409).json({
          message: `Bill Code ${billCode} already exists.`,
        });
      }
    }

    const updated = await sql.query`
      UPDATE dbo.SalaryBillCodes
      SET
        BillCode = ${billCode},
        BillMonth = ${resolvedBillMonth},
        SalaryMonth = ${salaryMonth},
        SalaryMonthNumber = ${salaryMonthNumber || null},
        SalaryYear = ${salaryYear},
        BillCategory = ${billCategory},
        BillType = ${billType},
        Description = ${description || ""},
        UpdatedDate = SYSUTCDATETIME(),
        UpdatedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE BillCodeId = ${id}
        AND Status = N'OPEN'
    `;

    if (!updated.recordset[0]) {
      return res.status(403).json({
        message: lockedMessage(current.BillCode),
      });
    }

    await writeAudit({
      actionName: "Bill Code Updated",
      entityKey: billCode,
      details: "OPEN bill code updated",
      userName: actor.userName,
      fullName: actor.fullName,
    });

    res.json({
      message: "Salary Bill Code updated successfully.",
      data: mapRow(updated.recordset[0]),
    });
  } catch (error) {
    console.error("Update salary bill code error:", error);
    res.status(500).json({ message: "Unable to update bill code." });
  }
});

/* DELETE /api/salary-bill-codes/:id — disabled for UI; keep API blocked for safety */
router.delete("/:id", async (_req, res) => {
  return res.status(403).json({
    message:
      "Deleting Salary Bill Codes from the Master is not allowed. Use Complete & Lock Month instead.",
  });
});

/* POST /api/salary-bill-codes/:id/complete */
router.post("/:id/complete", async (req, res) => {
  try {
    if (!isAdminRole(req.user?.roleName)) {
      return res.status(403).json({
        message:
          "Only System Administrator can complete / lock salary months in Salary Bill Code Master.",
      });
    }
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const current = await getById(id);

    if (!current) {
      return res.status(404).json({ message: "Bill Code not found." });
    }

    if (current.Status === "LOCKED") {
      return res.status(403).json({ message: lockedMessage(current.BillCode) });
    }

    if (current.Status !== "OPEN") {
      return res.status(400).json({
        message: `Bill Code ${current.BillCode} is already ${current.Status}.`,
      });
    }

    /*
     * Phase 9 — Month Closure Completeness Gate (Option A).
     * Every institute that has a workflow row for this bill code must be
     * APPROVED or LOCKED before the master bill can be marked COMPLETED.
     * Only institutes with existing SalaryBillInstituteWorkflow rows count
     * as applicable; inactive/unconfigured institutes are not relevant.
     * If there are zero workflow rows, closure is blocked to prevent an
     * empty month from being silently closed.
     */
    const workflowCheck = await sql.query`
      SELECT
        w.InstituteCode,
        ISNULL(i.InstituteName, w.InstituteCode) AS InstituteName,
        w.Status
      FROM dbo.SalaryBillInstituteWorkflow w
      LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
      WHERE w.SalaryBillCodeId = ${id}
    `;
    const allWorkflowRows = workflowCheck.recordset;

    if (allWorkflowRows.length === 0) {
      return res.status(400).json({
        message:
          `Bill Code ${current.BillCode} cannot be completed: ` +
          `no institute workflow entries exist. ` +
          `At least one institute must have submitted and been approved before closing the month.`,
        incompleteCount: 0,
        incompleteInstitutes: [],
      });
    }

    const COMPLETE_STATUSES = new Set(["APPROVED", "LOCKED"]);
    const incomplete = allWorkflowRows.filter(
      (r) => !COMPLETE_STATUSES.has(String(r.Status || "").toUpperCase())
    );

    if (incomplete.length > 0) {
      return res.status(400).json({
        message:
          `Bill Code ${current.BillCode} cannot be completed: ` +
          `${incomplete.length} of ${allWorkflowRows.length} institute(s) ` +
          `have not been approved. All applicable institutes must be ` +
          `APPROVED or LOCKED before the month can be closed.`,
        incompleteCount: incomplete.length,
        totalCount: allWorkflowRows.length,
        incompleteInstitutes: incomplete.map((r) => ({
          instituteCode: r.InstituteCode,
          instituteName: r.InstituteName,
          status: r.Status,
        })),
      });
    }

    const updated = await sql.query`
      UPDATE dbo.SalaryBillCodes
      SET
        Status = N'COMPLETED',
        CompletedDate = SYSUTCDATETIME(),
        CompletedBy = ${actor.fullName},
        UpdatedDate = SYSUTCDATETIME(),
        UpdatedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE BillCodeId = ${id}
        AND Status = N'OPEN'
    `;

    if (!updated.recordset[0]) {
      return res.status(409).json({
        message: `Bill Code ${current.BillCode} could not be completed.`,
      });
    }

    await writeAudit({
      actionName: "Bill Code Completed",
      entityKey: current.BillCode,
      details: `OPEN → COMPLETED (${allWorkflowRows.length} institutes all APPROVED/LOCKED)`,
      userName: actor.userName,
      fullName: actor.fullName,
    });

    res.json({
      message: `Bill Code ${current.BillCode} marked as COMPLETED.`,
      data: mapRow(updated.recordset[0]),
    });
  } catch (error) {
    console.error("Complete salary bill code error:", error);
    res.status(500).json({ message: "Unable to complete bill code." });
  }
});

/* POST /api/salary-bill-codes/:id/lock */
router.post("/:id/lock", async (req, res) => {
  try {
    if (!isAdminRole(req.user?.roleName)) {
      return res.status(403).json({
        message:
          "Only System Administrator can lock salary months in Salary Bill Code Master.",
      });
    }
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const current = await getById(id);

    if (!current) {
      return res.status(404).json({ message: "Bill Code not found." });
    }

    if (current.Status === "LOCKED") {
      return res.status(403).json({ message: lockedMessage(current.BillCode) });
    }

    if (current.Status !== "COMPLETED") {
      return res.status(400).json({
        message: "Bill Code must be COMPLETED before it can be locked.",
      });
    }

    /*
     * Phase 9 — Lock completeness gate.
     * All applicable institutes (those with a workflow row for this bill code)
     * must be in LOCKED status before the master bill can be LOCKED.
     * The legacy dbo.SalaryBills check is preserved as a secondary fallback
     * but is no longer the primary gate.
     */
    const lockCheck = await sql.query`
      SELECT
        w.InstituteCode,
        ISNULL(i.InstituteName, w.InstituteCode) AS InstituteName,
        w.Status
      FROM dbo.SalaryBillInstituteWorkflow w
      LEFT JOIN dbo.Institutes i ON i.InstituteCode = w.InstituteCode
      WHERE w.SalaryBillCodeId = ${id}
        AND UPPER(w.Status) <> N'LOCKED'
    `;

    if (lockCheck.recordset.length > 0) {
      return res.status(400).json({
        message:
          `Bill Code ${current.BillCode} cannot be locked: ` +
          `${lockCheck.recordset.length} institute(s) have not been locked yet. ` +
          `All applicable institutes must be LOCKED before the month can be locked.`,
        incompleteCount: lockCheck.recordset.length,
        incompleteInstitutes: lockCheck.recordset.map((r) => ({
          instituteCode: r.InstituteCode,
          instituteName: r.InstituteName,
          status: r.Status,
        })),
      });
    }

    const updated = await sql.query`
      UPDATE dbo.SalaryBillCodes
      SET
        Status = N'LOCKED',
        LockedDate = SYSUTCDATETIME(),
        LockedBy = ${actor.fullName},
        UpdatedDate = SYSUTCDATETIME(),
        UpdatedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE BillCodeId = ${id}
        AND Status = N'COMPLETED'
    `;

    if (!updated.recordset[0]) {
      return res.status(409).json({
        message: `Bill Code ${current.BillCode} could not be locked.`,
      });
    }

    await writeAudit({
      actionName: "Bill Code Locked",
      entityKey: current.BillCode,
      details: "COMPLETED → LOCKED",
      userName: actor.userName,
      fullName: actor.fullName,
    });

    res.json({
      message: `Bill Code ${current.BillCode} is now LOCKED.`,
      data: mapRow(updated.recordset[0]),
    });
  } catch (error) {
    console.error("Lock salary bill code error:", error);
    res.status(500).json({ message: "Unable to lock bill code." });
  }
});

/* POST /api/salary-bill-codes/:id/copy */
router.post("/:id/copy", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const normalized = normalizeBillPayload(req.body);
    const { description } = req.body || {};

    const source = await getById(id);

    if (!source) {
      return res.status(404).json({ message: "Source Bill Code not found." });
    }

    if (source.Status !== "LOCKED" && source.Status !== "APPROVED") {
      return res.status(400).json({
        message: "Only APPROVED or LOCKED Bill Codes can be copied to a new month.",
      });
    }

    if (normalized.error) {
      return res.status(400).json({ message: normalized.error });
    }
    const { billCode, salaryMonth, salaryMonthNumber, salaryYear, billCategory, billType } = normalized;
    const resolvedBillMonth = resolveBillMonth(salaryMonth, req.body?.billMonth);

    const duplicate = await getByCode(billCode);
    if (duplicate) {
      return res.status(409).json({
        message: `Bill Code ${billCode} already exists.`,
      });
    }

    const samePeriod = await getBySalaryPeriod(
      salaryMonth, salaryYear, billCategory, billType, resolvedBillMonth
    );
    if (samePeriod) {
      return res.status(409).json({
        message: `A ${billCategory} / ${billType} Bill Code already exists for Bill Month ${resolvedBillMonth} / Salary Month ${salaryMonth} ${salaryYear}.`,
      });
    }

    const created = await withTransaction(async (transaction) => {
      const insertRequest = new sql.Request(transaction);
      const insert = await insertRequest.query`
        INSERT INTO dbo.SalaryBillCodes
          (
            BillCode, BillMonth, SalaryMonth, SalaryMonthNumber, SalaryYear,
            BillCategory, BillType, Description, Status,
            CreatedBy, CopiedFromBillCode
          )
        OUTPUT INSERTED.*
        VALUES
          (
            ${billCode},
            ${resolvedBillMonth},
            ${salaryMonth},
            ${salaryMonthNumber || null},
            ${salaryYear},
            ${billCategory},
            ${billType},
            ${description || source.Description || ""},
            N'OPEN',
            ${actor.fullName},
            ${source.BillCode}
          )
      `;

      const newRow = insert.recordset[0];

      const auditRequest = new sql.Request(transaction);
      await auditRequest.query`
        INSERT INTO dbo.AuditLogs
          (ModuleName, ActionName, EntityKey, SourceKey, NewKey, Details, UserName, FullName)
        VALUES
          (
            N'SalaryBillCode',
            N'Bill Code Copied',
            ${billCode},
            ${source.BillCode},
            ${billCode},
            N'Created a fresh OPEN bill code from a locked source; employee details were not copied',
            ${actor.userName},
            ${actor.fullName}
          )
      `;

      return newRow;
    });

    res.status(201).json({
      message: `Bill Code ${billCode} created from ${source.BillCode}.`,
      data: mapRow(created),
    });
  } catch (error) {
    console.error("Copy salary bill code error:", error);
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({
        message: `Bill Code ${req.body?.billCode || ""} already exists.`,
      });
    }
    res.status(500).json({
      message: "Unable to copy bill code.",
      error: error.message,
    });
  }
});

/* Guard helper used by salary entry APIs later */
router.post("/guard/:billCode", async (req, res) => {
  try {
    const row = await getByCode(req.params.billCode);
    if (!row) {
      return res.status(404).json({ message: "Bill Code not found.", allowed: false });
    }
    const status = String(row.Status || "").toUpperCase();
    const blocked = ["LOCKED", "APPROVED", "COMPLETED"];
    if (blocked.includes(status)) {
      return res.status(403).json({
        message:
          status === "LOCKED" || status === "APPROVED"
            ? lockedMessage(row.BillCode)
            : `Bill Code ${row.BillCode} is ${status} and cannot be modified.`,
        allowed: false,
        data: mapRow(row),
      });
    }
    /* Salary Entry itself may only touch OPEN bills (RETURNED/REJECTED are the
       correct-and-resubmit exception handled by the Returning Bills screen). */
    if (!ENTRY_MODIFIABLE_STATUSES.has(status)) {
      return res.status(409).json({
        message: `Bill Code ${row.BillCode} is ${status || "UNKNOWN"}. Only OPEN bill codes can be modified from Salary Entry.`,
        allowed: false,
        data: mapRow(row),
      });
    }

    res.json({
      message: "OK",
      allowed: true,
      data: mapRow(row),
    });
  } catch (error) {
    console.error("Guard bill code error:", error);
    res.status(500).json({ message: "Unable to validate bill code.", allowed: false });
  }
});

module.exports = router;
/* Exported for offline tests (scripts/testFinalSalaryBillSelection.js). */
module.exports.isMainSalaryBill = isMainSalaryBill;
module.exports.isClosedMainSalaryBill = isClosedMainSalaryBill;
