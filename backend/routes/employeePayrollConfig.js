const express = require("express");
const { sql } = require("../db");
const {
  mapConfigRow,
  mapEmployeeSnapshot,
  normalizeNppa,
  toBool,
  defaultPayrollConfig,
  canManagePayrollConfig,
  canConfigureInactiveEmployee,
} = require("../utils/payrollConfig");

const router = express.Router();

function actorFromBody(body = {}) {
  return {
    userId: body.userId || null,
    userName: body.userName || body.actorUserName || "SYSTEM",
    fullName:
      body.fullName ||
      body.actorFullName ||
      body.userName ||
      body.actorUserName ||
      "SYSTEM",
    roleName: body.roleName || "",
  };
}

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

async function writeAudit({
  userId,
  recordId,
  action,
  oldValues,
  newValues,
  userName,
  ip,
}) {
  try {
    await sql.query`
      INSERT INTO dbo.AuditLogs
        (ModuleName, ActionName, EntityKey, Details, UserName, FullName, UserId, TableName, RecordId, OldValues, NewValues, IPAddress)
      VALUES
        (
          N'EmployeePayrollConfiguration',
          ${action},
          ${String(recordId || "")},
          ${action},
          ${userName || "SYSTEM"},
          ${userName || "SYSTEM"},
          ${userId || null},
          N'EmployeePayrollConfiguration',
          ${String(recordId || "")},
          ${oldValues ? JSON.stringify(oldValues) : null},
          ${newValues ? JSON.stringify(newValues) : null},
          ${ip || null}
        )
    `;
  } catch (err) {
    console.warn("Payroll config audit skipped:", err.message);
  }
}

const employeeSearchSelect = `
  SELECT
    e.EmployeeId,
    e.EmployeeCode,
    e.EmployeeName,
    e.EmployeeType,
    e.Status,
    e.IsActive,
    e.PayRevisionId,
    e.PayLevel,
    e.PayMatrixCellNo,
    e.BasicPay,
    d.DesignationName,
    i.InstituteCode,
    i.InstituteName,
    i.CityClass,
    i.InstituteDistrict,
    COALESCE(
      dist.DistrictName,
      NULLIF(LTRIM(RTRIM(i.InstituteDistrict)), N''),
      NULLIF(LTRIM(RTRIM(i.District)), N'')
    ) AS DistrictName,
    COALESCE(cc.CityClassName, i.CityClass) AS CityClassName,
    r.RevisionCode
  FROM dbo.EmployeeMaster e
  LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
  LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
  LEFT JOIN dbo.Districts dist
    ON dist.DistrictId = ISNULL(NULLIF(e.DistrictId, 0), NULLIF(i.DistrictId, 0))
  LEFT JOIN dbo.CityClasses cc
    ON cc.CityClassId = ISNULL(NULLIF(e.CityClassId, 0), NULLIF(i.CityClassId, 0))
  LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
`;

async function loadConfigById(id) {
  const request = new sql.Request();
  request.input("Id", sql.Int, id);
  const result = await request.execute("usp_EmployeePayrollConfiguration_Get");
  return result.recordset?.[0] ? mapConfigRow(result.recordset[0]) : null;
}

async function saveConfiguration(body, actor, ip) {
  if (!canManagePayrollConfig(actor)) {
    const err = new Error(
      "You are not authorized to save payroll configuration."
    );
    err.status = 403;
    throw err;
  }

  const employeeId = Number(body.employeeId);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    const err = new Error("EmployeeId is required.");
    err.status = 400;
    throw err;
  }

  const effectiveFrom = body.effectiveFrom
    ? String(body.effectiveFrom).slice(0, 10)
    : null;
  if (!effectiveFrom) {
    const err = new Error("EffectiveFrom is required.");
    err.status = 400;
    throw err;
  }

  const nppa = normalizeNppa(body.nppaApplicable);
  const idIn = body.id != null && Number(body.id) > 0 ? Number(body.id) : null;

  const empCheck = await sql.query`
    SELECT EmployeeId, Status, IsActive
    FROM dbo.EmployeeMaster
    WHERE EmployeeId = ${employeeId}
  `;
  const emp = empCheck.recordset[0];
  if (!emp) {
    const err = new Error("Employee does not exist.");
    err.status = 400;
    throw err;
  }
  const inactive =
    String(emp.Status || "").toUpperCase() === "INACTIVE" ||
    emp.IsActive === false ||
    emp.IsActive === 0;
  if (inactive && !canConfigureInactiveEmployee(actor)) {
    const err = new Error(
      "Cannot configure payroll for an inactive employee."
    );
    err.status = 400;
    throw err;
  }

  let oldValues = null;
  if (idIn) {
    oldValues = await loadConfigById(idIn);
  } else {
    const oldReq = new sql.Request();
    oldReq.input("EmployeeId", sql.Int, employeeId);
    oldReq.input("AsOfDate", sql.Date, effectiveFrom);
    const oldRes = await oldReq.execute(
      "usp_EmployeePayrollConfiguration_GetByEmployee"
    );
    if (oldRes.recordset?.[0]) oldValues = mapConfigRow(oldRes.recordset[0]);
  }

  const saveReq = new sql.Request();
  saveReq.input("Id", sql.Int, idIn);
  saveReq.input("EmployeeId", sql.Int, employeeId);
  saveReq.input(
    "MedicalAllowanceApplicable",
    sql.Bit,
    toBool(body.medicalAllowanceApplicable) ? 1 : 0
  );
  saveReq.input(
    "TransportAllowanceApplicable",
    sql.Bit,
    toBool(body.transportAllowanceApplicable) ? 1 : 0
  );
  saveReq.input(
    "HraPreviousLocationApplicable",
    sql.Bit,
    toBool(body.hraPreviousLocationApplicable) ? 1 : 0
  );
  saveReq.input(
    "ProfessionalTaxApplicable",
    sql.Bit,
    toBool(body.professionalTaxApplicable) ? 1 : 0
  );
  saveReq.input("NppaApplicable", sql.NVarChar(10), nppa);
  saveReq.input("EffectiveFrom", sql.Date, effectiveFrom);
  saveReq.input(
    "EffectiveTo",
    sql.Date,
    body.effectiveTo ? String(body.effectiveTo).slice(0, 10) : null
  );
  saveReq.input(
    "IsActive",
    sql.Bit,
    body.isActive === false || body.isActive === 0 ? 0 : 1
  );
  saveReq.input("Actor", sql.NVarChar(100), actor.userName);

  const result = await saveReq.execute("usp_EmployeePayrollConfiguration_Save");
  const saved = mapConfigRow(result.recordset?.[0]);

  await writeAudit({
    userId: actor.userId,
    recordId: saved.id,
    action: idIn ? "UPDATE" : "CREATE",
    oldValues,
    newValues: saved,
    userName: actor.userName,
    ip,
  });

  return { saved, created: !idIn };
}

/* GET list */
router.get("/", async (req, res) => {
  try {
    const request = new sql.Request();
    const employeeId = req.query.employeeId
      ? Number(req.query.employeeId)
      : null;
    request.input(
      "EmployeeId",
      sql.Int,
      Number.isFinite(employeeId) && employeeId > 0 ? employeeId : null
    );
    request.input(
      "EmployeeName",
      sql.NVarChar(200),
      req.query.employeeName || req.query.q || null
    );
    request.input(
      "InstituteCode",
      sql.NVarChar(50),
      req.query.instituteCode || null
    );
    request.input(
      "EmployeeType",
      sql.NVarChar(20),
      req.query.employeeType || null
    );
    request.input("Status", sql.NVarChar(20), req.query.status || "ALL");

    const result = await request.execute(
      "usp_EmployeePayrollConfiguration_List"
    );
    res.json({
      message: "OK",
      data: (result.recordset || []).map(mapConfigRow),
    });
  } catch (error) {
    console.error("GET /api/employee-payroll-config error:", error);
    res.status(500).json({
      message: "Unable to load payroll configurations.",
      error: error.message,
    });
  }
});

/* GET employee search */
router.get("/search-employees", async (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || "").trim();
    const request = new sql.Request();
    let result;
    if (!q) {
      result = await request.query(`
        ${employeeSearchSelect}
        WHERE UPPER(ISNULL(e.Status, N'Active')) = N'ACTIVE'
          AND ISNULL(e.IsActive, 1) = 1
        ORDER BY e.EmployeeName
        OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
      `);
    } else if (/^\d+$/.test(q)) {
      request.input("Id", sql.Int, Number(q));
      request.input("Q", sql.NVarChar(100), q);
      result = await request.query(`
        ${employeeSearchSelect}
        WHERE e.EmployeeId = @Id
           OR e.EmployeeCode LIKE N'%' + @Q + N'%'
           OR e.EmployeeName LIKE N'%' + @Q + N'%'
           OR i.InstituteCode LIKE N'%' + @Q + N'%'
        ORDER BY e.EmployeeName
        OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
      `);
    } else {
      request.input("Q", sql.NVarChar(100), q);
      result = await request.query(`
        ${employeeSearchSelect}
        WHERE e.EmployeeCode LIKE N'%' + @Q + N'%'
           OR e.EmployeeName LIKE N'%' + @Q + N'%'
           OR i.InstituteCode LIKE N'%' + @Q + N'%'
        ORDER BY e.EmployeeName
        OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
      `);
    }

    res.json({
      message: "OK",
      data: (result.recordset || []).map(mapEmployeeSnapshot),
    });
  } catch (error) {
    console.error("GET search-employees error:", error);
    res.status(500).json({
      message: "Unable to search employees.",
      error: error.message,
    });
  }
});

/* GET by employee */
router.get("/by-employee/:employeeId", async (req, res) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return res.status(400).json({ message: "Valid EmployeeId is required." });
    }

    const asOf = req.query.asOf || null;
    const empReq = new sql.Request();
    empReq.input("EmployeeId", sql.Int, employeeId);
    const empResult = await empReq.query(`
      ${employeeSearchSelect}
      WHERE e.EmployeeId = @EmployeeId
    `);
    const employee = mapEmployeeSnapshot(empResult.recordset[0]);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found." });
    }

    const cfgReq = new sql.Request();
    cfgReq.input("EmployeeId", sql.Int, employeeId);
    cfgReq.input(
      "AsOfDate",
      sql.Date,
      asOf || new Date().toISOString().slice(0, 10)
    );
    const cfgResult = await cfgReq.execute(
      "usp_EmployeePayrollConfiguration_GetByEmployee"
    );
    const config = cfgResult.recordset?.[0]
      ? mapConfigRow(cfgResult.recordset[0])
      : { ...defaultPayrollConfig(), employeeId };

    res.json({ message: "OK", data: { employee, config } });
  } catch (error) {
    console.error("GET by-employee error:", error);
    res.status(500).json({
      message: "Unable to load employee payroll configuration.",
      error: error.message,
    });
  }
});

/* GET by id */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Valid Id is required." });
    }
    const data = await loadConfigById(id);
    if (!data) {
      return res.status(404).json({ message: "Payroll configuration not found." });
    }
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /:id error:", error);
    res.status(500).json({
      message: "Unable to load payroll configuration.",
      error: error.message,
    });
  }
});

/* POST create/update */
router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const { saved, created } = await saveConfiguration(
      req.body || {},
      actor,
      clientIp(req)
    );
    res.json({
      message: created
        ? "Payroll configuration saved."
        : "Payroll configuration updated.",
      data: saved,
    });
  } catch (error) {
    console.error("POST payroll-config error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to save payroll configuration.",
      error: error.message,
    });
  }
});

/* PUT update */
router.put("/:id", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const { saved } = await saveConfiguration(
      { ...(req.body || {}), id: Number(req.params.id) },
      actor,
      clientIp(req)
    );
    res.json({ message: "Payroll configuration updated.", data: saved });
  } catch (error) {
    console.error("PUT payroll-config error:", error);
    res.status(error.status || 500).json({
      message: error.message || "Unable to update payroll configuration.",
      error: error.message,
    });
  }
});

async function deactivateHandler(req, res) {
  const actor = actorFromBody(req.body);
  try {
    if (!canManagePayrollConfig(actor)) {
      return res.status(403).json({
        message: "You are not authorized to deactivate payroll configuration.",
      });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Valid Id is required." });
    }

    const oldValues = await loadConfigById(id);
    if (!oldValues) {
      return res.status(404).json({ message: "Payroll configuration not found." });
    }

    const request = new sql.Request();
    request.input("Id", sql.Int, id);
    request.input("Actor", sql.NVarChar(100), actor.userName);
    const result = await request.execute(
      "usp_EmployeePayrollConfiguration_Delete"
    );
    const saved = mapConfigRow(result.recordset?.[0]);

    await writeAudit({
      userId: actor.userId,
      recordId: id,
      action: "DEACTIVATE",
      oldValues,
      newValues: saved,
      userName: actor.userName,
      ip: clientIp(req),
    });

    res.json({ message: "Payroll configuration deactivated.", data: saved });
  } catch (error) {
    console.error("deactivate payroll-config error:", error);
    res.status(500).json({
      message: error.message || "Unable to deactivate payroll configuration.",
      error: error.message,
    });
  }
}

router.patch("/:id/deactivate", deactivateHandler);
router.delete("/:id", deactivateHandler);

module.exports = router;
