/**
 * DA Difference API.
 *
 *  GET    /api/da-difference                  list DA Difference bills
 *  GET    /api/da-difference/:id              one bill + its period
 *  POST   /api/da-difference                  create (Masters -> DA Difference Master)
 *  PUT    /api/da-difference/:id              amend period/description while OPEN
 *  GET    /api/da-difference/:id/detail       saved snapshot for an institute
 *  POST   /api/da-difference/:id/calculate    preview, writes nothing
 *  POST   /api/da-difference/:id/save         save snapshot (DRAFT)
 *  POST   /api/da-difference/:id/submit       save + submit for approval
 *
 * The bill code itself lives in dbo.SalaryBillCodes (BillCategory
 * 'Difference', BillType 'DA Difference'), and approval reuses
 * dbo.SalaryBillInstituteWorkflow. No parallel bill or approval system.
 */

const express = require("express");
const { sql } = require("../db");
const { withTransaction } = require("./salaryEmployeeDetails");
const {
  buildMonthRange,
  buildRateMap,
  calculateEmployeeDifference,
  listEmployeesForPeriod,
  validateNpsOverride,
} = require("../utils/daDifference");
const { pad2, roundMoney, toNum, monthName } = require("../utils/employeeIncrement");
const { yearMonthKey } = require("../utils/salaryMonthKey");
const {
  getInstituteWorkflow,
  upsertInstituteWorkflow,
  assertInstituteEditable,
} = require("../utils/salaryBillInstituteWorkflow");
const {
  assertDaDifferenceMonthEditable,
  isDaDifferenceMonthLocked,
  lockDaDifferenceMonth,
  listDaDifferenceMonthLocks,
  resolveMonthParts,
  mapLockRow,
} = require("../utils/daDifferenceMonthLock");
const {
  hasPermissionPrefix,
  isAdminRole,
} = require("../middleware/auth");

const router = express.Router();

function actorFromBody(body = {}) {
  return {
    userName: body.userName || body.actorUserName || "SYSTEM",
    fullName:
      body.fullName || body.actorFullName || body.userName || "SYSTEM",
    userId:
      body.userId != null
        ? Number(body.userId)
        : body.actorUserId != null
          ? Number(body.actorUserId)
          : null,
  };
}

function mapBill(row, monthLockByKey = null) {
  const paymentParts = resolveMonthParts({
    paymentSalaryMonth: row.PaymentSalaryMonth,
    paymentSalaryMonthNumber: row.PaymentSalaryMonthNumber,
    paymentSalaryYear: row.PaymentSalaryYear,
  });
  const lockInfo =
    paymentParts && monthLockByKey
      ? monthLockByKey.get(paymentParts.key) || null
      : null;
  return {
    id: Number(row.DADifferenceBillId),
    daDifferenceBillId: Number(row.DADifferenceBillId),
    salaryBillCodeId: Number(row.SalaryBillCodeId),
    billCode: row.BillCode,
    paymentSalaryMonth: row.PaymentSalaryMonth,
    paymentSalaryMonthNumber: row.PaymentSalaryMonthNumber,
    paymentSalaryYear: row.PaymentSalaryYear,
    paymentMonthLabel: paymentParts?.label || "",
    monthLockStatus: lockInfo?.status || "OPEN",
    monthLocked: Boolean(lockInfo?.isLocked),
    fromSalaryMonth: row.FromSalaryMonth,
    fromSalaryMonthNumber: row.FromSalaryMonthNumber,
    fromSalaryYear: row.FromSalaryYear,
    toSalaryMonth: row.ToSalaryMonth,
    toSalaryMonthNumber: row.ToSalaryMonthNumber,
    toSalaryYear: row.ToSalaryYear,
    description: row.Description || "",
    status: row.Status,
    billCodeStatus: row.BillCodeStatus || null,
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy || "",
    updatedDate: row.UpdatedDate,
    updatedBy: row.UpdatedBy || "",
  };
}

/* =========================================================
   VALIDATION HELPERS — everything is checked against SQL Server
   ========================================================= */

async function getBill(id) {
  const result = await sql.query`
    SELECT b.*, c.Status AS BillCodeStatus
    FROM dbo.DADifferenceBill b
    LEFT JOIN dbo.SalaryBillCodes c ON c.BillCodeId = b.SalaryBillCodeId
    WHERE b.DADifferenceBillId = ${Number(id)}
  `;
  return result.recordset[0] || null;
}

async function requireBill(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    const err = new Error("A valid DA Difference bill is required.");
    err.status = 400;
    throw err;
  }
  const bill = await getBill(numeric);
  if (!bill) {
    const err = new Error("DA Difference bill not found.");
    err.status = 404;
    throw err;
  }
  return bill;
}

/** Institute is resolved from SQL Server, never trusted from the request. */
async function requireInstitute(instituteId, instituteCode) {
  if (instituteId) {
    const byId = await sql.query`
      SELECT TOP 1 * FROM dbo.Institutes WHERE InstituteId = ${Number(instituteId)}
    `;
    if (byId.recordset[0]) return byId.recordset[0];
  }
  if (instituteCode) {
    const byCode = await sql.query`
      SELECT TOP 1 * FROM dbo.Institutes
      WHERE InstituteCode = ${String(instituteCode).trim()}
    `;
    if (byCode.recordset[0]) return byCode.recordset[0];
  }
  const err = new Error("Institute not found.");
  err.status = 404;
  throw err;
}

/** The DA Difference bill code row in SalaryBillCodes. */
async function requireDifferenceBillCode(billCode) {
  const code = String(billCode || "").trim();
  if (!code) {
    const err = new Error("DA Difference Bill Code is required.");
    err.status = 400;
    throw err;
  }

  const result = await sql.query`
    SELECT TOP 1 * FROM dbo.SalaryBillCodes WHERE BillCode = ${code}
  `;
  const row = result.recordset[0];

  if (!row) {
    const err = new Error(
      `Bill Code ${code} does not exist. Create it in Salary Bill Code Master ` +
      `with Category "Difference" and Type "DA Difference" first.`
    );
    err.status = 404;
    throw err;
  }

  if (String(row.BillType || "").trim() !== "DA Difference") {
    const err = new Error(
      `Bill Code ${code} is of type "${row.BillType}". A DA Difference bill ` +
      `requires Bill Type "DA Difference".`
    );
    err.status = 400;
    throw err;
  }

  return row;
}

function monthsFromBill(bill) {
  return buildMonthRange(
    bill.FromSalaryYear,
    bill.FromSalaryMonthNumber,
    bill.ToSalaryYear,
    bill.ToSalaryMonthNumber
  );
}

/**
 * A DA Difference bill may only be edited while OPEN, and only while this
 * institute's workflow allows it. Non-editable states return 409, so the
 * API cannot be driven by hand once a bill is submitted or locked.
 */
async function assertEditable(bill, instituteCode) {
  const status = String(bill.Status || "").trim().toUpperCase();
  if (status !== "OPEN") {
    return {
      status: 409,
      message: `DA Difference bill ${bill.BillCode} is ${status} and cannot be modified.`,
    };
  }

  const monthBlock = await assertDaDifferenceMonthEditable({
    paymentSalaryMonth: bill.PaymentSalaryMonth,
    paymentSalaryMonthNumber: bill.PaymentSalaryMonthNumber,
    paymentSalaryYear: bill.PaymentSalaryYear,
  });
  if (monthBlock) return monthBlock;

  const workflow = await getInstituteWorkflow(
    Number(bill.SalaryBillCodeId),
    instituteCode
  );
  return assertInstituteEditable(workflow, bill.BillCode, instituteCode);
}

function canManageDaDifferenceMaster(user) {
  if (!user) return false;
  if (isAdminRole(user.roleName)) return true;
  return hasPermissionPrefix(user, "MASTER_DA_DIFFERENCE");
}

/* =========================================================
   MANUAL NPS DEDUCTION
   A user-entered NPS survives every later recalculation. The amounts
   themselves are always recomputed from SQL Server, so a tampered payload
   cannot change what is paid — only the NPS field is accepted from the
   client, and only after validation.
   ========================================================= */

function npsKey(employeeId, year, monthNumber) {
  return `${Number(employeeId)}|${String(year)}-${String(monthNumber)}`;
}

/** NPS values already flagged manual for this bill + institute. */
async function loadSavedManualNps(daDifferenceBillId, instituteCode) {
  const map = new Map();
  try {
    const result = await sql.query`
      SELECT EmployeeId, SalaryYear, SalaryMonthNumber, NPSDeduction
      FROM dbo.DADifferenceMonthDetails
      WHERE DADifferenceBillId = ${Number(daDifferenceBillId)}
        AND InstituteCode = ${String(instituteCode)}
        AND NPSManual = 1
    `;
    for (const row of result.recordset) {
      map.set(
        npsKey(row.EmployeeId, row.SalaryYear, row.SalaryMonthNumber),
        toNum(row.NPSDeduction)
      );
    }
  } catch (error) {
    /* Columns not yet migrated — behave as if nothing were saved. */
    if (!/invalid column name/i.test(String(error.message))) throw error;
  }
  return map;
}

/** NPS values the client is submitting with this request. */
function collectNpsOverrides(body) {
  const rows = Array.isArray(body?.npsOverrides) ? body.npsOverrides : [];
  const map = new Map();
  for (const row of rows) {
    const employeeId = Number(row?.employeeId);
    const year = String(row?.salaryYear || "").trim();
    const monthNumber = pad2(Number(row?.salaryMonthNumber || 0));
    if (!Number.isInteger(employeeId) || !year || monthNumber === "00") continue;
    map.set(npsKey(employeeId, year, monthNumber), row?.npsDeduction);
  }
  return map;
}

/**
 * Saved manual values, overlaid with anything the client just sent.
 * Returns { byEmployee: Map(employeeId -> Map(monthKey -> value)), errors }.
 */
function mergeNpsSources(savedMap, clientMap) {
  const byEmployee = new Map();
  const put = (key, value) => {
    const [employeePart, monthKey] = key.split("|");
    const employeeId = Number(employeePart);
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Map());
    byEmployee.get(employeeId).set(monthKey, value);
  };
  for (const [key, value] of savedMap) put(key, value);
  for (const [key, value] of clientMap) put(key, value);
  return byEmployee;
}

/* =========================================================
   MONTH LOCK — DA Difference Master only
   ========================================================= */

router.get("/month-lock", async (req, res) => {
  try {
    const parts = resolveMonthParts({
      month: req.query.month || req.query.salaryMonth,
      year: req.query.year,
      monthNumber: req.query.monthNumber || req.query.paymentSalaryMonthNumber,
      paymentSalaryYear: req.query.paymentSalaryYear || req.query.year,
      paymentSalaryMonthNumber:
        req.query.paymentSalaryMonthNumber || req.query.monthNumber,
    });
    if (!parts) {
      return res.status(400).json({
        message: "Month and Year are required to check DA Difference lock status.",
      });
    }
    const status = await isDaDifferenceMonthLocked(parts);
    res.json({
      message: "OK",
      data: status.locked
        ? mapLockRow(status.row, status.parts)
        : {
            year: parts.year,
            month: parts.month,
            monthNumber: parts.monthNumber,
            label: parts.label,
            status: "OPEN",
            isLocked: false,
            lockedDate: null,
            lockedBy: "",
            lockedByUserId: null,
            remarks: "",
          },
    });
  } catch (error) {
    console.error("GET /api/da-difference/month-lock error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to load DA Difference month lock status.",
    });
  }
});

router.get("/month-locks", async (_req, res) => {
  try {
    const rows = await listDaDifferenceMonthLocks();
    res.json({ message: "OK", data: rows });
  } catch (error) {
    console.error("GET /api/da-difference/month-locks error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to list DA Difference month locks.",
    });
  }
});

router.post("/month-lock", async (req, res) => {
  try {
    if (!canManageDaDifferenceMaster(req.user)) {
      return res.status(403).json({
        message:
          "Only users with DA Difference Master permission can lock a DA Difference month.",
      });
    }

    const parts = resolveMonthParts({
      month: req.body?.month || req.body?.salaryMonth,
      year: req.body?.year || req.body?.paymentSalaryYear,
      monthNumber:
        req.body?.monthNumber || req.body?.paymentSalaryMonthNumber,
      paymentSalaryMonth: req.body?.paymentSalaryMonth,
      paymentSalaryMonthNumber: req.body?.paymentSalaryMonthNumber,
      paymentSalaryYear: req.body?.paymentSalaryYear,
    });
    if (!parts) {
      return res.status(400).json({
        message: "A valid DA Difference month and year are required to lock.",
      });
    }

    const actor = {
      ...actorFromBody(req.body),
      userId: req.user?.userId ?? actorFromBody(req.body).userId,
      userName: req.user?.userName || actorFromBody(req.body).userName,
      fullName: req.user?.fullName || actorFromBody(req.body).fullName,
    };

    const locked = await lockDaDifferenceMonth({
      year: parts.year,
      month: parts.month,
      actor,
      remarks: req.body?.remarks || null,
    });

    res.json({
      message: `DA Difference month ${locked.label} has been locked successfully.`,
      data: locked,
    });
  } catch (error) {
    console.error("POST /api/da-difference/month-lock error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to lock DA Difference month.",
    });
  }
});

/* =========================================================
   LIST / GET
   ========================================================= */

router.get("/", async (_req, res) => {
  try {
    const result = await sql.query`
      SELECT b.*, c.Status AS BillCodeStatus
      FROM dbo.DADifferenceBill b
      LEFT JOIN dbo.SalaryBillCodes c ON c.BillCodeId = b.SalaryBillCodeId
      ORDER BY b.PaymentSalaryYear DESC,
               b.PaymentSalaryMonthNumber DESC,
               b.DADifferenceBillId DESC
    `;
    const locks = await listDaDifferenceMonthLocks().catch(() => []);
    const lockMap = new Map(
      locks.map((row) => [yearMonthKey({ year: row.year, month: row.month }), row])
    );
    res.json({
      message: "OK",
      data: result.recordset.map((row) => mapBill(row, lockMap)),
    });
  } catch (error) {
    console.error("GET /api/da-difference error:", error);
    const missingTable = String(error.message || "")
      .toLowerCase()
      .includes("invalid object name");
    res.status(500).json({
      message: missingTable
        ? "DA Difference tables are missing. Run: npm run migrate:da-difference"
        : "Unable to load DA Difference bills.",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const bill = await requireBill(req.params.id);
    const locks = await listDaDifferenceMonthLocks().catch(() => []);
    const lockMap = new Map(
      locks.map((row) => [yearMonthKey({ year: row.year, month: row.month }), row])
    );
    res.json({
      message: "OK",
      data: mapBill(bill, lockMap),
      months: monthsFromBill(bill).map((m) => ({
        key: m.key,
        label: m.label,
        name: m.name,
        salaryYear: m.year,
        salaryMonthNumber: m.monthNumber,
      })),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message || "Unable to load DA Difference bill.",
    });
  }
});

/* =========================================================
   CREATE
   ========================================================= */

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const billCodeRow = await requireDifferenceBillCode(req.body?.billCode);

    const paymentYear = String(req.body?.paymentSalaryYear || "").trim();
    const paymentMonth = pad2(Number(req.body?.paymentSalaryMonthNumber || 0));
    const fromYear = String(req.body?.fromSalaryYear || "").trim();
    const fromMonth = pad2(Number(req.body?.fromSalaryMonthNumber || 0));
    const toYear = String(req.body?.toSalaryYear || "").trim();
    const toMonth = pad2(Number(req.body?.toSalaryMonthNumber || 0));

    for (const [label, y, m] of [
      ["Payment", paymentYear, paymentMonth],
      ["From", fromYear, fromMonth],
      ["To", toYear, toMonth],
    ]) {
      if (!/^\d{4}$/.test(y) || !/^(0[1-9]|1[0-2])$/.test(m)) {
        return res.status(400).json({
          message: `${label} Salary Month and four-digit Year are required.`,
        });
      }
    }

    const monthBlock = await assertDaDifferenceMonthEditable({
      paymentSalaryMonthNumber: paymentMonth,
      paymentSalaryYear: paymentYear,
    });
    if (monthBlock) {
      return res.status(monthBlock.status).json({ message: monthBlock.message });
    }

    const months = buildMonthRange(fromYear, fromMonth, toYear, toMonth);
    if (months.length === 0) {
      return res.status(400).json({
        message: "The From month must be the same as or earlier than the To month.",
      });
    }

    const existing = await sql.query`
      SELECT TOP 1 DADifferenceBillId FROM dbo.DADifferenceBill
      WHERE SalaryBillCodeId = ${Number(billCodeRow.BillCodeId)}
    `;
    if (existing.recordset[0]) {
      return res.status(409).json({
        message: `A DA Difference bill already exists for ${billCodeRow.BillCode}.`,
      });
    }

    const inserted = await sql.query`
      INSERT INTO dbo.DADifferenceBill
        (
          SalaryBillCodeId, BillCode,
          PaymentSalaryMonth, PaymentSalaryMonthNumber, PaymentSalaryYear,
          FromSalaryMonth, FromSalaryMonthNumber, FromSalaryYear,
          ToSalaryMonth, ToSalaryMonthNumber, ToSalaryYear,
          Description, Status, CreatedBy
        )
      OUTPUT INSERTED.DADifferenceBillId
      VALUES
        (
          ${Number(billCodeRow.BillCodeId)},
          ${billCodeRow.BillCode},
          ${monthName(paymentMonth)}, ${paymentMonth}, ${paymentYear},
          ${monthName(fromMonth)}, ${fromMonth}, ${fromYear},
          ${monthName(toMonth)}, ${toMonth}, ${toYear},
          ${req.body?.description || null},
          ${String(req.body?.status || "OPEN").toUpperCase()},
          ${actor.fullName || actor.userName}
        )
    `;

    const saved = await getBill(inserted.recordset[0].DADifferenceBillId);
    res.status(201).json({
      message: `DA Difference bill ${billCodeRow.BillCode} created for ${months.length} month(s).`,
      data: mapBill(saved),
    });
  } catch (error) {
    console.error("POST /api/da-difference error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to create DA Difference bill.",
    });
  }
});

/* =========================================================
   UPDATE — period may change only while nothing is saved yet
   ========================================================= */

router.put("/:id", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const bill = await requireBill(req.params.id);

    if (String(bill.Status || "").toUpperCase() !== "OPEN") {
      return res.status(409).json({
        message: `DA Difference bill ${bill.BillCode} is ${bill.Status} and cannot be modified.`,
      });
    }

    const monthBlock = await assertDaDifferenceMonthEditable({
      paymentSalaryMonth: bill.PaymentSalaryMonth,
      paymentSalaryMonthNumber: bill.PaymentSalaryMonthNumber,
      paymentSalaryYear: bill.PaymentSalaryYear,
    });
    if (monthBlock) {
      return res.status(monthBlock.status).json({ message: monthBlock.message });
    }

    const fromYear = String(req.body?.fromSalaryYear || bill.FromSalaryYear).trim();
    const fromMonth = pad2(
      Number(req.body?.fromSalaryMonthNumber || bill.FromSalaryMonthNumber)
    );
    const toYear = String(req.body?.toSalaryYear || bill.ToSalaryYear).trim();
    const toMonth = pad2(
      Number(req.body?.toSalaryMonthNumber || bill.ToSalaryMonthNumber)
    );

    const periodChanged =
      fromYear !== String(bill.FromSalaryYear) ||
      fromMonth !== String(bill.FromSalaryMonthNumber) ||
      toYear !== String(bill.ToSalaryYear) ||
      toMonth !== String(bill.ToSalaryMonthNumber);

    if (periodChanged) {
      const saved = await sql.query`
        SELECT COUNT(1) AS SavedCount
        FROM dbo.DADifferenceMonthDetails
        WHERE DADifferenceBillId = ${Number(bill.DADifferenceBillId)}
      `;
      if (Number(saved.recordset[0]?.SavedCount || 0) > 0) {
        return res.status(409).json({
          message:
            "Calculated amounts are already saved against this bill, so the " +
            "difference period can no longer be changed. Create a new DA " +
            "Difference bill instead.",
        });
      }

      if (buildMonthRange(fromYear, fromMonth, toYear, toMonth).length === 0) {
        return res.status(400).json({
          message: "The From month must be the same as or earlier than the To month.",
        });
      }
    }

    await sql.query`
      UPDATE dbo.DADifferenceBill
      SET
        FromSalaryMonth       = ${monthName(fromMonth)},
        FromSalaryMonthNumber = ${fromMonth},
        FromSalaryYear        = ${fromYear},
        ToSalaryMonth         = ${monthName(toMonth)},
        ToSalaryMonthNumber   = ${toMonth},
        ToSalaryYear          = ${toYear},
        Description           = ${req.body?.description ?? bill.Description},
        Status                = ${String(req.body?.status || bill.Status).toUpperCase()},
        UpdatedDate           = SYSUTCDATETIME(),
        UpdatedBy             = ${actor.fullName || actor.userName}
      WHERE DADifferenceBillId = ${Number(bill.DADifferenceBillId)}
    `;

    const saved = await getBill(bill.DADifferenceBillId);
    res.json({
      message: "DA Difference bill updated successfully.",
      data: mapBill(saved),
    });
  } catch (error) {
    console.error("PUT /api/da-difference error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to update DA Difference bill.",
    });
  }
});

/* =========================================================
   CALCULATE — preview only, writes nothing
   ========================================================= */

router.post("/:id/calculate", async (req, res) => {
  try {
    const bill = await requireBill(req.params.id);
    const institute = await requireInstitute(
      req.body?.instituteId,
      req.body?.instituteCode
    );

    const months = monthsFromBill(bill);
    if (months.length === 0) {
      return res
        .status(400)
        .json({ message: "This bill has an invalid difference period." });
    }

    const rateMap = await buildRateMap(months);
    const employees = await listEmployeesForPeriod({
      instituteCode: institute.InstituteCode,
      months,
    });

    /* A preview still shows any NPS the user already saved by hand. */
    const savedNps = await loadSavedManualNps(
      bill.DADifferenceBillId,
      institute.InstituteCode
    );
    const npsByEmployee = mergeNpsSources(
      savedNps,
      collectNpsOverrides(req.body)
    );

    const rows = [];
    let order = 1;
    for (const emp of employees) {
      const detail = await calculateEmployeeDifference({
        employeeId: emp.EmployeeId,
        instituteCode: institute.InstituteCode,
        months,
        rateMap,
        savedNpsByMonth: npsByEmployee.get(Number(emp.EmployeeId)) || null,
      });
      detail.displayOrder = order;
      detail.employeeName = detail.employeeName || emp.EmployeeName || "";
      detail.employeeCode = emp.EmployeeCode || "";
      detail.designation = detail.designation || emp.Designation || "";
      rows.push(detail);
      order += 1;
    }

    const missingRates = months
      .filter((m) => !rateMap.get(m.key)?.found)
      .map((m) => m.label);

    res.json({
      message: rows.length
        ? "OK"
        : `No salary snapshots found for ${institute.InstituteCode} in this period. ` +
          `DA Difference can only be calculated for months whose salary bill was saved.`,
      bill: mapBill(bill),
      institute: {
        instituteId: Number(institute.InstituteId),
        instituteCode: institute.InstituteCode,
        instituteName: institute.InstituteName,
      },
      months: months.map((m) => ({
        key: m.key,
        label: m.label,
        name: m.name,
        salaryYear: m.year,
        salaryMonthNumber: m.monthNumber,
        revisedDARate: rateMap.get(m.key)?.rate ?? null,
      })),
      warnings: missingRates.length
        ? [`No DA rate configured in DA Master for: ${missingRates.join(", ")}.`]
        : [],
      data: rows,
      grandTotal: roundMoney(
        rows.reduce((sum, r) => sum + toNum(r.totalDifferenceAmount), 0)
      ),
      grandTotalNps: roundMoney(
        rows.reduce((sum, r) => sum + toNum(r.totalNpsDeduction), 0)
      ),
      grandTotalNet: roundMoney(
        rows.reduce((sum, r) => sum + toNum(r.totalNetDifferenceAmount), 0)
      ),
    });
  } catch (error) {
    console.error("POST /api/da-difference/:id/calculate error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to calculate DA Difference.",
    });
  }
});

/* =========================================================
   SAVE / SUBMIT — writes the permanent snapshot
   ========================================================= */

/** A date the database accepts, or null. Never today's date by default. */
function parseBillDate(value) {
  if (value == null || String(value).trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function saveDifferenceHandler(req, res, { submitted }) {
  /* Bill header fields — stored as entered, never auto-overwritten. */
  const billNo = String(req.body?.billNo ?? "").trim();
  const billDate = parseBillDate(req.body?.billDate);
  const npsScheduleNo = String(req.body?.npsScheduleNo ?? "").trim();
  const actor = actorFromBody(req.body);
  const bill = await requireBill(req.params.id);
  const institute = await requireInstitute(
    req.body?.instituteId,
    req.body?.instituteCode
  );

  const blocked = await assertEditable(bill, institute.InstituteCode);
  if (blocked) {
    return res
      .status(blocked.status)
      .json({ message: blocked.message, allowed: false });
  }

  const months = monthsFromBill(bill);
  if (months.length === 0) {
    return res
      .status(400)
      .json({ message: "This bill has an invalid difference period." });
  }

  /*
    Amounts are ALWAYS recomputed here from SQL Server and never taken from
    the request body, so a tampered payload cannot change what is paid.
  */
  const rateMap = await buildRateMap(months);
  const employees = await listEmployeesForPeriod({
    instituteCode: institute.InstituteCode,
    months,
  });

  if (employees.length === 0) {
    return res.status(400).json({
      message:
        `No salary snapshots exist for institute ${institute.InstituteCode} ` +
        `in this period, so there is nothing to save.`,
    });
  }

  /*
    NPS is the ONLY field accepted from the client, and only after
    validation. Everything else is recomputed from SQL Server below.
    Previously saved manual values are merged in first, so a save that
    does not resend them does not silently revert them to the default.
  */
  const savedNps = await loadSavedManualNps(
    bill.DADifferenceBillId,
    institute.InstituteCode
  );
  const clientNps = collectNpsOverrides(req.body);

  const badValues = [];
  for (const [key, value] of clientNps) {
    const amount = Number(value);
    if (value == null || value === "" || !Number.isFinite(amount)) {
      badValues.push(`${key}: NPS deduction must be numeric.`);
    } else if (amount < 0) {
      badValues.push(`${key}: NPS deduction cannot be negative.`);
    }
  }
  if (badValues.length) {
    return res.status(400).json({
      message: "One or more NPS deductions are invalid. Nothing was saved.",
      errors: badValues,
    });
  }

  const npsByEmployee = mergeNpsSources(savedNps, clientNps);

  const previousWorkflow = await getInstituteWorkflow(
    Number(bill.SalaryBillCodeId),
    institute.InstituteCode
  );
  const previousStatus = String(
    previousWorkflow?.Status || "DRAFT"
  ).toUpperCase();

  let nextStatus = "DRAFT";
  if (submitted) {
    nextStatus =
      previousStatus === "RETURNED" || previousStatus === "REJECTED"
        ? "RESUBMITTED"
        : "SUBMITTED";
  }

  const saved = await withTransaction(async (transaction) => {
    const request = () => new sql.Request(transaction);
    const out = [];

    /* Replace only THIS institute's rows for THIS bill. Other institutes
       are untouched, so institute isolation holds. */
    await request().query`
      DELETE FROM dbo.DADifferenceMonthDetails
      WHERE DADifferenceBillId = ${Number(bill.DADifferenceBillId)}
        AND InstituteCode = ${institute.InstituteCode}
    `;
    await request().query`
      DELETE FROM dbo.DADifferenceEmployeeDetails
      WHERE DADifferenceBillId = ${Number(bill.DADifferenceBillId)}
        AND InstituteCode = ${institute.InstituteCode}
    `;

    let order = 1;
    for (const emp of employees) {
      const detail = await calculateEmployeeDifference({
        employeeId: emp.EmployeeId,
        instituteCode: institute.InstituteCode,
        months,
        rateMap,
        savedNpsByMonth: npsByEmployee.get(Number(emp.EmployeeId)) || null,
      });

      const empInsert = await request().query`
        INSERT INTO dbo.DADifferenceEmployeeDetails
          (
            DADifferenceBillId, SalaryBillCodeId, EmployeeId,
            InstituteId, InstituteCode,
            EmployeeName, EmployeeCode, Designation, EmployeeType, PayLevel,
            TotalDifferenceAmount, TotalNPSDeduction, TotalNetDifferenceAmount,
            DisplayOrder, CreatedBy
          )
        OUTPUT INSERTED.DADifferenceEmployeeDetailId
        VALUES
          (
            ${Number(bill.DADifferenceBillId)},
            ${Number(bill.SalaryBillCodeId)},
            ${Number(emp.EmployeeId)},
            ${Number(institute.InstituteId)},
            ${institute.InstituteCode},
            ${detail.employeeName || emp.EmployeeName || null},
            ${emp.EmployeeCode || null},
            ${detail.designation || emp.Designation || null},
            ${detail.employeeType || emp.EmployeeType || null},
            ${detail.payLevel || null},
            ${roundMoney(detail.totalDifferenceAmount)},
            ${roundMoney(detail.totalNpsDeduction)},
            ${roundMoney(detail.totalNetDifferenceAmount)},
            ${order},
            ${actor.fullName || actor.userName}
          )
      `;

      const employeeDetailId = Number(
        empInsert.recordset[0].DADifferenceEmployeeDetailId
      );

      for (const month of detail.months) {
        await request().query`
          INSERT INTO dbo.DADifferenceMonthDetails
            (
              DADifferenceBillId, DADifferenceEmployeeDetailId,
              EmployeeId, InstituteCode,
              SalaryMonth, SalaryMonthNumber, SalaryYear,
              SourceSalaryBillCodeId, SourceBillCode,
              HistoricalBasic, OldDARate, OldDA,
              RevisedDARate, RevisedDA, DifferenceAmount,
              NPSDeduction, NPSManual, NetDifferenceAmount,
              SnapshotMissing, Remarks, CreatedBy
            )
          VALUES
            (
              ${Number(bill.DADifferenceBillId)},
              ${employeeDetailId},
              ${Number(emp.EmployeeId)},
              ${institute.InstituteCode},
              ${month.salaryMonth},
              ${month.salaryMonthNumber},
              ${month.salaryYear},
              ${month.sourceSalaryBillCodeId},
              ${month.sourceBillCode},
              ${roundMoney(month.historicalBasic)},
              ${month.oldDARate},
              ${roundMoney(month.oldDA)},
              ${month.revisedDARate},
              ${roundMoney(month.revisedDA)},
              ${roundMoney(month.differenceAmount)},
              ${roundMoney(month.npsDeduction)},
              ${month.npsManual ? 1 : 0},
              ${roundMoney(month.netDifferenceAmount)},
              ${month.snapshotMissing ? 1 : 0},
              ${month.remarks},
              ${actor.fullName || actor.userName}
            )
        `;
      }

      detail.displayOrder = order;
      detail.employeeCode = emp.EmployeeCode || "";
      out.push(detail);
      order += 1;
    }

    /* An NPS larger than its own DA difference aborts the whole save, so
       nothing is written from a half-valid payload. */
    const rejected = out.flatMap((row) =>
      (row.npsErrors || []).map(
        (message) => `Employee ${row.employeeId} — ${message}`
      )
    );
    if (rejected.length) {
      const error = new Error(
        "One or more NPS deductions are invalid. Nothing was saved."
      );
      error.status = 400;
      error.details = rejected;
      throw error;
    }

    /* Submission requires the bill header; a draft may still be incomplete. */
    if (submitted) {
      const missing = [];
      if (!billNo) missing.push("Bill Number is required.");
      if (!billDate) missing.push("Bill Date is required.");
      if (missing.length) {
        const error = new Error("Bill details are incomplete.");
        error.status = 400;
        error.details = missing;
        throw error;
      }
    }

    /* Same institute-wise workflow table the salary bills use. */
    await upsertInstituteWorkflow(transaction, {
      bill: { BillCodeId: bill.SalaryBillCodeId, BillCode: bill.BillCode },
      institute,
      nextStatus,
      actor,
    });

    /*
      Bill No. / Bill Date / NPS Schedule No. for this DA Difference bill.

      REUSED, NOT NEW: these are the same three columns Salary Entry writes on
      dbo.SalaryBillInstituteWorkflow (migrations 37 and 45), keyed by the
      exact (SalaryBillCodeId, InstituteCode) pair — which is what keeps one
      institute's DA Difference bill separate from another's, and from the
      ordinary salary bill for the same month. No new table, no new column,
      no second bill-number system.

      Bill Date stays distinct from Payment Month / Salary Month / Bill Month:
      it is the date written on the document.
    */
    try {
      await request().query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          BillNo = ${billNo || null},
          BillDate = ${billDate},
          NPSScheduleNo = ${npsScheduleNo || null},
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${actor.fullName || actor.userName}
        WHERE SalaryBillCodeId = ${Number(bill.SalaryBillCodeId)}
          AND InstituteCode = ${institute.InstituteCode}
      `;
    } catch (err) {
      /* Pre-migration database: never fail a save over a header field. */
      if (!/invalid column name/i.test(String(err.message))) throw err;
      console.warn(
        "DA Difference: BillNo/BillDate/NPSScheduleNo columns missing — run " +
          "migrate:bill-no-date and migrate:nps-schedule-no"
      );
    }

    try {
      await request().query`
        INSERT INTO dbo.AuditLogs
          (ModuleName, ActionName, EntityKey, Details, UserName, FullName,
           TableName, RecordId, NewValues)
        VALUES
          (
            N'DADifference',
            ${submitted ? "SUBMIT" : "SAVE_DRAFT"},
            ${bill.BillCode},
            ${submitted ? "DA Difference bill submitted" : "DA Difference snapshot saved"},
            ${actor.userName},
            ${actor.fullName},
            N'DADifferenceMonthDetails',
            ${String(bill.DADifferenceBillId)},
            ${JSON.stringify({
              billCode: bill.BillCode,
              instituteCode: institute.InstituteCode,
              employeeCount: out.length,
              months: months.map((m) => m.label),
              previousStatus,
              status: nextStatus,
            })}
          )
      `;
    } catch (_) {
      /* audit is optional */
    }

    return out;
  });

  res.json({
    message: submitted
      ? nextStatus === "RESUBMITTED"
        ? "DA Difference bill resubmitted successfully."
        : "DA Difference bill submitted successfully."
      : "DA Difference snapshot saved successfully.",
    bill: mapBill(bill),
    institute: {
      instituteId: Number(institute.InstituteId),
      instituteCode: institute.InstituteCode,
      instituteName: institute.InstituteName,
    },
    status: nextStatus,
    data: saved,
    grandTotal: roundMoney(
      saved.reduce((sum, r) => sum + toNum(r.totalDifferenceAmount), 0)
    ),
    grandTotalNps: roundMoney(
      saved.reduce((sum, r) => sum + toNum(r.totalNpsDeduction), 0)
    ),
    grandTotalNet: roundMoney(
      saved.reduce((sum, r) => sum + toNum(r.totalNetDifferenceAmount), 0)
    ),
  });
}

router.post("/:id/save", async (req, res) => {
  try {
    await saveDifferenceHandler(req, res, { submitted: false });
  } catch (error) {
    console.error("POST /api/da-difference/:id/save error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to save DA Difference snapshot.",
      errors: error.details || undefined,
    });
  }
});

router.post("/:id/submit", async (req, res) => {
  try {
    await saveDifferenceHandler(req, res, { submitted: true });
  } catch (error) {
    console.error("POST /api/da-difference/:id/submit error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to submit DA Difference bill.",
      errors: error.details || undefined,
    });
  }
});

/* =========================================================
   DETAIL — the SAVED snapshot, read back exactly as stored
   ========================================================= */

router.get("/:id/detail", async (req, res) => {
  try {
    const bill = await requireBill(req.params.id);
    const institute = await requireInstitute(
      req.query?.instituteId,
      req.query?.instituteCode
    );

    const employeeRows = await sql.query`
      SELECT *
      FROM dbo.DADifferenceEmployeeDetails
      WHERE DADifferenceBillId = ${Number(bill.DADifferenceBillId)}
        AND InstituteCode = ${institute.InstituteCode}
      ORDER BY DisplayOrder, DADifferenceEmployeeDetailId
    `;

    const monthRows = await sql.query`
      SELECT *
      FROM dbo.DADifferenceMonthDetails
      WHERE DADifferenceBillId = ${Number(bill.DADifferenceBillId)}
        AND InstituteCode = ${institute.InstituteCode}
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
        sourceBillCode: row.SourceBillCode,
        historicalBasic: toNum(row.HistoricalBasic),
        oldDARate: row.OldDARate != null ? toNum(row.OldDARate) : null,
        oldDA: toNum(row.OldDA),
        revisedDARate: toNum(row.RevisedDARate),
        revisedDA: toNum(row.RevisedDA),
        differenceAmount: toNum(row.DifferenceAmount),
        /* Read back exactly as stored — a manually entered NPS is never
           recalculated when the bill is reopened. */
        npsDeduction: toNum(row.NPSDeduction),
        npsManual: Boolean(row.NPSManual),
        netDifferenceAmount: toNum(row.NetDifferenceAmount),
        snapshotMissing: Boolean(row.SnapshotMissing),
        remarks: row.Remarks || null,
      });
    }

    const workflow = await getInstituteWorkflow(
      Number(bill.SalaryBillCodeId),
      institute.InstituteCode
    );

    const data = employeeRows.recordset.map((row) => ({
      employeeId: Number(row.EmployeeId),
      employeeName: row.EmployeeName || "",
      employeeCode: row.EmployeeCode || "",
      designation: row.Designation || "",
      employeeType: row.EmployeeType || "",
      payLevel: row.PayLevel || "",
      instituteCode: row.InstituteCode,
      displayOrder: row.DisplayOrder,
      totalDifferenceAmount: toNum(row.TotalDifferenceAmount),
      totalNpsDeduction: toNum(row.TotalNPSDeduction),
      totalNetDifferenceAmount: toNum(row.TotalNetDifferenceAmount),
      months: byEmployee.get(Number(row.EmployeeId)) || [],
    }));

    res.json({
      message: "OK",
      bill: mapBill(bill),
      institute: {
        instituteId: Number(institute.InstituteId),
        instituteCode: institute.InstituteCode,
        instituteName: institute.InstituteName,
      },
      months: monthsFromBill(bill).map((m) => ({
        key: m.key,
        label: m.label,
        name: m.name,
        salaryYear: m.year,
        salaryMonthNumber: m.monthNumber,
      })),
      workflowStatus: workflow?.Status || null,
      /* Restored exactly as stored; opening a bill never rewrites them. */
      billNo: workflow?.BillNo != null ? String(workflow.BillNo) : "",
      billDate: workflow?.BillDate || null,
      npsScheduleNo:
        workflow?.NPSScheduleNo != null ? String(workflow.NPSScheduleNo) : "",
      saved: data.length > 0,
      data,
      grandTotal: roundMoney(
        data.reduce((sum, r) => sum + toNum(r.totalDifferenceAmount), 0)
      ),
      grandTotalNps: roundMoney(
        data.reduce((sum, r) => sum + toNum(r.totalNpsDeduction), 0)
      ),
      grandTotalNet: roundMoney(
        data.reduce((sum, r) => sum + toNum(r.totalNetDifferenceAmount), 0)
      ),
    });
  } catch (error) {
    console.error("GET /api/da-difference/:id/detail error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to load DA Difference detail.",
    });
  }
});

module.exports = router;
