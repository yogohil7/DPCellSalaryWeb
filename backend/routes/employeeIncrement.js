/**
 * Employee Increment API.
 *
 * GET    /api/employee-increment                  list (filterable)
 * GET    /api/employee-increment/employee/:id     one employee's increments
 * GET    /api/employee-increment/history/:id      full history incl. cancelled
 * POST   /api/employee-increment/calculate        preview, writes nothing
 * POST   /api/employee-increment                  create
 * PUT    /api/employee-increment/:id              amend a NON-applied increment
 * DELETE /api/employee-increment/:id              cancel (soft, keeps history)
 *
 * Every employee id is validated against SQL Server; nothing is trusted
 * from the browser.
 */

const express = require("express");
const { sql } = require("../db");
const { loadEmployee, resolveBasicPay } = require("./salaryCalculate");
const {
  monthKey,
  monthLabel,
  firstOfMonth,
  pad2,
  roundMoney,
  toNum,
  listIncrements,
  getIncrementById,
  resolveIncrementForMonth,
  recordIncrement,
} = require("../utils/employeeIncrement");

const router = express.Router();

function actorFromBody(body = {}) {
  return {
    userName: body.userName || body.actorUserName || "SYSTEM",
    fullName:
      body.fullName || body.actorFullName || body.userName || "SYSTEM",
  };
}

function mapIncrement(row) {
  return {
    id: Number(row.IncrementId),
    incrementId: Number(row.IncrementId),
    employeeId: Number(row.EmployeeId),
    incrementDate: row.IncrementDate,
    previousBasic: toNum(row.PreviousBasic),
    incrementAmount: toNum(row.IncrementAmount),
    newBasic: toNum(row.NewBasic),
    previousPayLevel: row.PreviousPayLevel || "",
    newPayLevel: row.NewPayLevel || "",
    previousCellNo: row.PreviousCellNo,
    newCellNo: row.NewCellNo,
    effectiveMonth: row.EffectiveMonth,
    effectiveDate: row.EffectiveDate,
    status: row.Status,
    remarks: row.Remarks || "",
    salaryBillCodeId: row.SalaryBillCodeId,
    instituteCode: row.InstituteCode || "",
    appliedAutomatically: Boolean(row.AppliedAutomatically),
    employeeName: row.EmployeeName || "",
    employeeCode: row.EmployeeCode || "",
    instituteName: row.InstituteName || "",
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy || "",
    updatedDate: row.UpdatedDate,
    updatedBy: row.UpdatedBy || "",
  };
}

/** Validate an employee id against SQL Server. */
async function requireEmployee(employeeId) {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error("A valid Employee is required.");
    err.status = 400;
    throw err;
  }
  const employee = await loadEmployee(id);
  if (!employee) {
    const err = new Error("Employee not found.");
    err.status = 404;
    throw err;
  }
  return employee;
}

/** Normalise the (year, month) pair a caller sent. */
function readPeriod(source = {}) {
  const year = String(source.salaryYear || source.year || "").trim();
  const monthNumber = pad2(
    Number(source.salaryMonthNumber || source.monthNumber || 0)
  );

  if (!/^\d{4}$/.test(year) ||
      !/^(0[1-9]|1[0-2])$/.test(monthNumber)) {
    const err = new Error(
      "A valid Salary Year (YYYY) and Salary Month (01-12) are required."
    );
    err.status = 400;
    throw err;
  }
  return { year, monthNumber, key: monthKey(year, monthNumber) };
}

/* =========================================================
   LIST
   ========================================================= */

router.get("/", async (req, res) => {
  try {
    const employeeId = Number(req.query.employeeId) || null;
    const instituteCode = String(req.query.instituteCode || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();

    const result = await sql.query`
      SELECT
        i.*,
        e.EmployeeName,
        e.EmployeeCode,
        inst.InstituteName
      FROM dbo.EmployeeIncrement i
      LEFT JOIN dbo.EmployeeMaster e ON e.EmployeeId = i.EmployeeId
      LEFT JOIN dbo.Institutes inst  ON inst.InstituteId = e.InstituteId
      WHERE (${employeeId} IS NULL OR i.EmployeeId = ${employeeId})
        AND (${instituteCode} = N'' OR inst.InstituteCode = ${instituteCode})
        AND (${status} = N'' OR UPPER(i.Status) = ${status})
      ORDER BY i.EffectiveMonth DESC, i.IncrementId DESC
    `;

    res.json({
      message: "OK",
      data: result.recordset.map(mapIncrement),
    });
  } catch (error) {
    console.error("GET /api/employee-increment error:", error);
    const missingTable = String(error.message || "")
      .toLowerCase()
      .includes("invalid object name");
    res.status(500).json({
      message: missingTable
        ? "EmployeeIncrement table is missing. Run: npm run migrate:da-difference"
        : "Unable to load increments.",
      error: error.message,
    });
  }
});

/* =========================================================
   ONE EMPLOYEE
   ========================================================= */

router.get("/employee/:employeeId", async (req, res) => {
  try {
    await requireEmployee(req.params.employeeId);
    const rows = await listIncrements(req.params.employeeId);
    res.json({ message: "OK", data: rows.map(mapIncrement) });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message || "Unable to load employee increments.",
    });
  }
});

/* Full history, cancelled rows included — history is never destroyed. */
router.get("/history/:employeeId", async (req, res) => {
  try {
    const employee = await requireEmployee(req.params.employeeId);
    const rows = await listIncrements(req.params.employeeId, {
      includeCancelled: true,
    });
    res.json({
      message: "OK",
      employee: {
        employeeId: Number(employee.EmployeeId),
        employeeName: employee.EmployeeName,
        employeeCode: employee.EmployeeCode,
        monthOfIncrement: employee.MonthOfIncrement,
        incrementDate: employee.IncrementDate,
      },
      data: rows.map(mapIncrement),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message || "Unable to load increment history.",
    });
  }
});

/* =========================================================
   CALCULATE (preview only — writes nothing)
   ========================================================= */

router.post("/calculate", async (req, res) => {
  try {
    const employee = await requireEmployee(req.body?.employeeId);
    const period = readPeriod(req.body);

    const pay = await resolveBasicPay(employee);
    const resolved = await resolveIncrementForMonth({
      employee: { ...employee, ...pay, PayLevel: employee.PayLevel ?? pay.level, PayMatrixCellNo: employee.PayMatrixCellNo ?? pay.cellNo, PayRevisionId: employee.PayRevisionId ?? pay.payRevisionId },
      currentBasic: pay.basicPay,
      year: period.year,
      monthNumber: period.monthNumber,
      manualAmount: req.body?.incrementAmount,
      manualNewBasic: req.body?.newBasic,
    });

    res.json({
      message: "OK",
      employee: {
        employeeId: Number(employee.EmployeeId),
        employeeName: employee.EmployeeName,
        employeeCode: employee.EmployeeCode,
      },
      salaryMonth: monthLabel(period.year, period.monthNumber),
      effectiveMonth: period.key,
      data: resolved,
    });
  } catch (error) {
    console.error("POST /api/employee-increment/calculate error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to calculate increment.",
    });
  }
});

/* =========================================================
   CREATE
   ========================================================= */

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const employee = await requireEmployee(req.body?.employeeId);
    const period = readPeriod(req.body);

    const pay = await resolveBasicPay(employee);
    const resolved = await resolveIncrementForMonth({
      employee: {
        ...employee,
        PayLevel: employee.PayLevel ?? pay.level,
        PayMatrixCellNo: employee.PayMatrixCellNo ?? pay.cellNo,
        PayRevisionId: employee.PayRevisionId ?? pay.payRevisionId,
      },
      currentBasic: req.body?.previousBasic ?? pay.basicPay,
      year: period.year,
      monthNumber: period.monthNumber,
      manualAmount: req.body?.incrementAmount,
      manualNewBasic: req.body?.newBasic,
    });

    if (resolved.alreadyRecorded) {
      return res.status(409).json({
        message:
          `An increment is already recorded for ${employee.EmployeeName} ` +
          `effective ${monthLabel(period.year, period.monthNumber)}.`,
        data: mapIncrement(resolved.increment),
      });
    }

    const incrementAmount = roundMoney(resolved.incrementAmount);
    if (incrementAmount <= 0) {
      return res.status(400).json({
        message:
          resolved.reason ||
          "Increment amount must be greater than zero. Enter an amount or check the Pay Matrix.",
      });
    }

    const effectiveDate = firstOfMonth(period.year, period.monthNumber);
    const incrementId = await recordIncrement(null, {
      employeeId: Number(employee.EmployeeId),
      incrementDate: req.body?.incrementDate || effectiveDate,
      previousBasic: resolved.previousBasic,
      incrementAmount,
      newBasic: resolved.newBasic,
      previousPayLevel: resolved.previousPayLevel,
      newPayLevel: resolved.newPayLevel,
      previousCellNo: resolved.previousCellNo,
      newCellNo: resolved.newCellNo,
      payRevisionId: employee.PayRevisionId ?? pay.payRevisionId,
      payMatrixId: resolved.payMatrixId,
      effectiveMonth: period.key,
      effectiveDate,
      status: "Active",
      remarks: req.body?.remarks || resolved.reason,
      appliedAutomatically: false,
      createdBy: actor.fullName || actor.userName,
    });

    const saved = await getIncrementById(incrementId);
    res.status(201).json({
      message: `Increment saved for ${employee.EmployeeName}, effective ${monthLabel(period.year, period.monthNumber)}.`,
      data: saved ? mapIncrement(saved) : null,
    });
  } catch (error) {
    console.error("POST /api/employee-increment error:", error);
    if (/UQ_EmpInc_Employee_Month_Active/i.test(String(error.message))) {
      return res.status(409).json({
        message:
          "An active increment already exists for this employee and month.",
      });
    }
    res.status(error.status || 500).json({
      message: error.message || "Unable to save increment.",
    });
  }
});

/* =========================================================
   UPDATE
   An increment already consumed by a salary bill is frozen: correcting it
   would silently change a bill that has been paid.
   ========================================================= */

router.put("/:id", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const existing = await getIncrementById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Increment not found." });
    }

    if (existing.SalaryBillCodeId) {
      return res.status(409).json({
        message:
          "This increment has already been applied to a salary bill and cannot be edited. Cancel it and record a new one if it is wrong.",
      });
    }

    const incrementAmount =
      req.body?.incrementAmount != null && req.body.incrementAmount !== ""
        ? roundMoney(req.body.incrementAmount)
        : toNum(existing.IncrementAmount);

    if (incrementAmount <= 0) {
      return res
        .status(400)
        .json({ message: "Increment amount must be greater than zero." });
    }

    const previousBasic =
      req.body?.previousBasic != null && req.body.previousBasic !== ""
        ? roundMoney(req.body.previousBasic)
        : toNum(existing.PreviousBasic);

    const newBasic =
      req.body?.newBasic != null && req.body.newBasic !== ""
        ? roundMoney(req.body.newBasic)
        : roundMoney(previousBasic + incrementAmount);

    await sql.query`
      UPDATE dbo.EmployeeIncrement
      SET
        IncrementDate   = ${req.body?.incrementDate || existing.IncrementDate},
        PreviousBasic   = ${previousBasic},
        IncrementAmount = ${incrementAmount},
        NewBasic        = ${newBasic},
        NewPayLevel     = ${req.body?.newPayLevel ?? existing.NewPayLevel},
        NewCellNo       = ${req.body?.newCellNo != null ? Number(req.body.newCellNo) : existing.NewCellNo},
        Remarks         = ${req.body?.remarks ?? existing.Remarks},
        UpdatedDate     = SYSUTCDATETIME(),
        UpdatedBy       = ${actor.fullName || actor.userName}
      WHERE IncrementId = ${Number(req.params.id)}
    `;

    const saved = await getIncrementById(req.params.id);
    res.json({
      message: "Increment updated successfully.",
      data: saved ? mapIncrement(saved) : null,
    });
  } catch (error) {
    console.error("PUT /api/employee-increment error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to update increment.",
    });
  }
});

/* =========================================================
   CANCEL (soft delete — history is preserved)
   ========================================================= */

router.delete("/:id", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const existing = await getIncrementById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Increment not found." });
    }

    if (existing.SalaryBillCodeId) {
      return res.status(409).json({
        message:
          "This increment has already been applied to a salary bill and cannot be cancelled.",
      });
    }

    await sql.query`
      UPDATE dbo.EmployeeIncrement
      SET Status      = N'Cancelled',
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy   = ${actor.fullName || actor.userName},
          Remarks     = ISNULL(Remarks, N'') + N' [Cancelled]'
      WHERE IncrementId = ${Number(req.params.id)}
    `;

    res.json({
      message: "Increment cancelled. The history record is preserved.",
    });
  } catch (error) {
    console.error("DELETE /api/employee-increment error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to cancel increment.",
    });
  }
});

module.exports = router;
