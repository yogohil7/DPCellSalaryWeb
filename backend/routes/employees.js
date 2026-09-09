const express = require("express");
const { sql } = require("../db");
const {
  normalizeEmployeeType,
  isPayChanged,
} = require("../utils/employeePayRules");
const { withTransaction } = require("./salaryEmployeeDetails");

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

function asPositiveId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapEmployee(row) {
  return {
    employeeId: Number(row.EmployeeId),
    id: Number(row.EmployeeId),
    employeeCode: row.EmployeeCode || "",
    employeeName: row.EmployeeName || "",
    designationId: row.DesignationId != null ? Number(row.DesignationId) : null,
    designationName: row.DesignationName || "",
    instituteId: row.InstituteId != null ? Number(row.InstituteId) : null,
    instituteCode: row.InstituteCode || "",
    instituteName: row.InstituteName || "",
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    sectionName: row.SectionName || "",
    districtId: asPositiveId(row.DistrictId) || asPositiveId(row.InstituteDistrictId),
    districtName:
      row.DistrictName ||
      row.InstituteDistrictName ||
      "",
    cityClassId:
      asPositiveId(row.CityClassId) || asPositiveId(row.InstituteCityClassId),
    cityClassName:
      row.CityClassName ||
      row.InstituteCityClassName ||
      row.CityClass ||
      "",
    payRevisionId: row.PayRevisionId != null ? Number(row.PayRevisionId) : null,
    revisionCode: row.RevisionCode || "",
    payMatrixId: row.PayMatrixId != null ? Number(row.PayMatrixId) : null,
    payLevel: row.PayLevel == null ? null : String(row.PayLevel).trim(),
    payMatrixCellNo: row.PayMatrixCellNo != null ? Number(row.PayMatrixCellNo) : null,
    payMatrixCell: row.PayMatrixCellNo != null ? Number(row.PayMatrixCellNo) : null,
    basicPay: row.BasicPay != null ? Number(row.BasicPay) : 0,
    effectiveDate: row.EffectiveDate,
    employeeType: normalizeEmployeeType(row.EmployeeType) || row.EmployeeType || "",
    scaleOfPay: row.ScaleOfPay || "",
    dateOfJoining: row.DateOfJoining,
    dateOfFullPay: row.DateOfFullPay,
    dateOfBirth: row.DateOfBirth,
    dateOfRetirement: row.DateOfRetirement,
    monthOfIncrement:
      row.MonthOfIncrement == null ? null : Number(row.MonthOfIncrement),
    gpfNps: row.GPFNPS || "",
    gpfNpsNumber: row.GPFNPSNumber || "",
    cccPassDate: row.CCCPassDate,
    bankAccountNumber: row.BankAccountNumber || "",
    status: row.Status || "Active",
    isActive: row.IsActive == null ? true : Boolean(row.IsActive),
  };
}

/** Generated Employee IDs: integers >= 2001. */
function isValidGeneratedEmployeeId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 2001 && n <= 2147483647;
}

const MONTH_NAME_TO_NUMBER = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * MonthOfIncrement is INT 1–12 in EmployeeMaster.
 * Accepts 7, "7", or legacy "July".
 */
function parseMonthOfIncrement(raw) {
  if (raw == null || raw === "") {
    return { value: null };
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1 || raw > 12) {
      return {
        error: "Month of Increment must be between January and December.",
      };
    }
    return { value: raw };
  }
  const text = String(raw).trim();
  if (!text) return { value: null };
  if (/^\d{1,2}$/.test(text)) {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return {
        error: "Month of Increment must be between January and December.",
      };
    }
    return { value: n };
  }
  const mapped = MONTH_NAME_TO_NUMBER[text.toLowerCase()];
  if (mapped) return { value: mapped };
  return {
    error: "Month of Increment must be between January and December.",
  };
}

function validateBankAccountNumber(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { value: null };
  }
  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    return {
      error: "Bank Account Number must contain only numeric characters.",
    };
  }
  return { value };
}

/**
 * Preview next ID from EmployeeMaster only.
 * Does NOT advance any sequence — failed saves must not change this.
 */
async function peekNextEmployeeId() {
  const maxRes = await sql.query`
    SELECT ISNULL(MAX(EmployeeId), 0) AS MaxId FROM dbo.EmployeeMaster
  `;
  const maxId = Number(maxRes.recordset[0]?.MaxId || 0);
  if (maxId < 2001) return 2001;
  return maxId + 1;
}

/**
 * Resolve ID for INSERT inside an open transaction.
 * Prefers the client-displayed Employee ID; rejects duplicates.
 * Falls back to MAX(EmployeeId)+1 (min 2001) with row locks.
 * Does NOT consume EmployeeIdSequence (avoids gaps on failed saves).
 */
async function resolveCreateEmployeeId(transaction, preferredId) {
  const request = new sql.Request(transaction);
  const preferred = Number(preferredId);

  if (isValidGeneratedEmployeeId(preferred)) {
    request.input("PrefId", sql.Int, preferred);
    request.input("PrefCode", sql.NVarChar(50), String(preferred));
    const dup = await request.query(`
      SELECT TOP 1 EmployeeId
      FROM dbo.EmployeeMaster WITH (UPDLOCK, HOLDLOCK)
      WHERE EmployeeId = @PrefId OR EmployeeCode = @PrefCode
    `);
    if (dup.recordset[0]) {
      const err = new Error(`Employee ID ${preferred} already exists.`);
      err.status = 409;
      throw err;
    }
    return preferred;
  }

  const maxRes = await new sql.Request(transaction).query(`
    SELECT ISNULL(MAX(EmployeeId), 0) AS MaxId
    FROM dbo.EmployeeMaster WITH (UPDLOCK, HOLDLOCK)
  `);
  const maxId = Number(maxRes.recordset[0]?.MaxId || 0);
  return maxId >= 2001 ? maxId + 1 : 2001;
}

async function resolveActivePayRevisionId(preferredId = null) {
  if (Number.isFinite(Number(preferredId)) && Number(preferredId) > 0) {
    return Number(preferredId);
  }
  const result = await sql.query`
    SELECT PayRevisionId
    FROM dbo.PayRevisionMaster
    WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
       OR ISNULL(IsActive, 1) = 1
    ORDER BY EffectiveFrom DESC, PayRevisionId DESC
  `;
  const rows = result.recordset || [];
  if (!rows.length) return null;
  return Number(rows[0].PayRevisionId);
}

async function resolvePayFromMatrix(payRevisionId, payLevel, cellNo, effectiveDate = null) {
  const { getBasicPay } = require("../utils/payMatrixLookup");
  const found = await getBasicPay({
    payRevisionId,
    level: payLevel,
    cellNo,
    /* Employee Master assignment: do not block on DOJ vs matrix EffectiveDate. */
    effectiveDate: null,
    preferActive: true,
  });
  if (!found) return null;
  return {
    PayMatrixId: found.payMatrixId,
    BasicPay: found.basicPay,
    PayRevisionId: found.payRevisionId,
    Level: found.level,
    CellNo: found.cellNo,
  };
}

/**
 * Authoritative pay resolution.
 * Never trusts BasicPay from the client.
 *
 * FIX → BasicPay = 0 (no matrix lookup)
 * REGULAR → BasicPay from PayMatrixMaster when Level/Cell known.
 *
 * NOTE: Designations currently has no PayLevel/Cell/PayRevision mapping.
 * When Regular pay fields are omitted, existing employee pay pointers are preserved on update.
 */
async function validateAndBuildPay(body, existingEmployee = null) {
  const {
    normalizePayMatrixLevel,
    normalizePayMatrixCellNo,
  } = require("../utils/payMatrixLookup");
  const employeeType = normalizeEmployeeType(body?.employeeType);
  if (!employeeType) {
    return { error: "Invalid Employee Type." };
  }

  if (employeeType === "FIX") {
    return {
      employeeType,
      payRevisionId: null,
      payLevel: null,
      payMatrixCellNo: null,
      payMatrixId: null,
      basicPay: 0,
    };
  }

  let payRevisionId = Number(
    body?.payRevisionId ?? body?.PayRevisionId ?? 0
  );
  let payLevel = normalizePayMatrixLevel(
    body?.payLevel ?? body?.level ?? body?.PayLevel ?? ""
  );
  let payMatrixCellNo = normalizePayMatrixCellNo(
    body?.payMatrixCellNo ?? body?.cellNo ?? body?.payMatrixCell ?? body?.CellNo
  );

  if (!Number.isFinite(payRevisionId) || payRevisionId <= 0) {
    payRevisionId = await resolveActivePayRevisionId(
      existingEmployee?.PayRevisionId
    );
  }

  const bodyHasLevelCell =
    Boolean(payLevel) &&
    payMatrixCellNo != null &&
    Number.isInteger(payMatrixCellNo) &&
    payMatrixCellNo > 0;

  if (!bodyHasLevelCell && existingEmployee) {
    if (!payLevel) {
      payLevel = normalizePayMatrixLevel(existingEmployee.PayLevel);
    }
    if (payMatrixCellNo == null) {
      payMatrixCellNo = normalizePayMatrixCellNo(
        existingEmployee.PayMatrixCellNo
      );
    }
  }

  if (
    !Number.isFinite(payRevisionId) ||
    payRevisionId <= 0 ||
    !payLevel ||
    payMatrixCellNo == null
  ) {
    return {
      error:
        "REGULAR employee requires Pay Level and Pay Matrix Cell from Pay Matrix.",
    };
  }

  const revInfo = await sql.query`
    SELECT TOP 1 PayRevisionId, RevisionCode
    FROM dbo.PayRevisionMaster
    WHERE PayRevisionId = ${payRevisionId}
  `;
  const revisionCode =
    revInfo.recordset[0]?.RevisionCode || String(payRevisionId);

  const matrix = await resolvePayFromMatrix(
    payRevisionId,
    payLevel,
    payMatrixCellNo,
    null
  );
  if (!matrix) {
    return {
      error: `Pay Matrix record not found for Pay Revision ${revisionCode}, Level ${payLevel}, Cell ${payMatrixCellNo}.`,
    };
  }

  return {
    employeeType,
    payRevisionId,
    payLevel: String(matrix.Level),
    payMatrixCellNo: Number(matrix.CellNo),
    payMatrixId: Number(matrix.PayMatrixId),
    basicPay: Number(matrix.BasicPay),
  };
}

async function writeAudit({ action, recordId, oldValues, newValues, userName, ip }) {
  try {
    await sql.query`
      INSERT INTO dbo.AuditLogs
        (ModuleName, ActionName, EntityKey, Details, UserName, FullName, TableName, RecordId, OldValues, NewValues, IPAddress)
      VALUES
        (
          N'EmployeeMaster',
          ${action},
          ${String(recordId || "")},
          ${action},
          ${userName || "SYSTEM"},
          ${userName || "SYSTEM"},
          N'EmployeeMaster',
          ${String(recordId || "")},
          ${oldValues ? JSON.stringify(oldValues) : null},
          ${newValues ? JSON.stringify(newValues) : null},
          ${ip || null}
        )
    `;
  } catch (err) {
    console.warn("Employee audit skipped:", err.message);
  }
}

async function insertPayHistory(employeeId, pay, effectiveFrom, userName, reason) {
  if (!pay || pay.employeeType === "FIX" || !pay.payMatrixId) {
    return;
  }
  const fromDate = effectiveFrom || new Date().toISOString().slice(0, 10);
  await sql.query`
    UPDATE dbo.EmployeePayHistory
    SET EffectiveTo = DATEADD(DAY, -1, CAST(${fromDate} AS DATE))
    WHERE EmployeeId = ${employeeId}
      AND EffectiveTo IS NULL
      AND EffectiveFrom < CAST(${fromDate} AS DATE)
  `;

  await sql.query`
    INSERT INTO dbo.EmployeePayHistory
      (EmployeeId, PayRevisionId, PayMatrixId, Level, CellNo, BasicPay, EffectiveFrom, Reason, CreatedBy)
    VALUES
      (
        ${employeeId},
        ${pay.payRevisionId},
        ${pay.payMatrixId},
        ${pay.payLevel},
        ${pay.payMatrixCellNo},
        ${pay.basicPay},
        ${fromDate},
        ${reason || "Employee Master save"},
        ${userName || "SYSTEM"}
      )
  `;
}

const employeeSelect = `
  SELECT
    e.*,
    d.DesignationName,
    i.InstituteCode,
    i.InstituteName,
    i.DistrictId AS InstituteDistrictId,
    i.InstituteDistrict AS InstituteDistrictName,
    i.CityClassId AS InstituteCityClassId,
    i.CityClass AS InstituteCityClassName,
    COALESCE(
      dist.DistrictName,
      NULLIF(LTRIM(RTRIM(i.InstituteDistrict)), N''),
      NULLIF(LTRIM(RTRIM(i.District)), N'')
    ) AS DistrictName,
    COALESCE(cc.CityClassName, i.CityClass) AS CityClassName,
    s.SectionName,
    r.RevisionCode
  FROM dbo.EmployeeMaster e
  LEFT JOIN dbo.Designations d ON d.DesignationId = e.DesignationId
  LEFT JOIN dbo.Institutes i ON i.InstituteId = e.InstituteId
  LEFT JOIN dbo.Districts dist
    ON dist.DistrictId = ISNULL(NULLIF(e.DistrictId, 0), NULLIF(i.DistrictId, 0))
  LEFT JOIN dbo.CityClasses cc
    ON cc.CityClassId = ISNULL(NULLIF(e.CityClassId, 0), NULLIF(i.CityClassId, 0))
  LEFT JOIN dbo.Sections s ON s.SectionId = e.SectionId
  LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = e.PayRevisionId
`;

router.get("/", async (_req, res) => {
  try {
    const request = new sql.Request();
    const result = await request.query(`
      ${employeeSelect}
      ORDER BY e.EmployeeId DESC
    `);
    res.json({ message: "OK", data: result.recordset.map(mapEmployee) });
  } catch (error) {
    console.error("GET /api/employees error:", error);
    res.status(500).json({ message: "Unable to load employees.", error: error.message });
  }
});

/* Preview only — does not reserve / consume the sequence. */
router.get("/next-id", async (_req, res) => {
  try {
    const employeeId = await peekNextEmployeeId();
    res.json({ message: "OK", employeeId, data: { employeeId } });
  } catch (error) {
    console.error("GET /api/employees/next-id error:", error);
    res.status(500).json({
      message: "Unable to load next Employee ID.",
      error: error.message,
    });
  }
});

router.get("/:id/pay-history", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT
        h.*,
        r.RevisionCode,
        r.RevisionName
      FROM dbo.EmployeePayHistory h
      LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = h.PayRevisionId
      WHERE h.EmployeeId = ${id}
      ORDER BY h.EffectiveFrom DESC, h.EmployeePayHistoryId DESC
    `;
    res.json({
      message: "OK",
      data: result.recordset.map((row) => ({
        employeePayHistoryId: Number(row.EmployeePayHistoryId),
        employeeId: Number(row.EmployeeId),
        payRevisionId: row.PayRevisionId != null ? Number(row.PayRevisionId) : null,
        revisionCode: row.RevisionCode || "",
        revisionName: row.RevisionName || "",
        payMatrixId: row.PayMatrixId != null ? Number(row.PayMatrixId) : null,
        level: row.Level == null ? null : String(row.Level).trim(),
        cellNo: row.CellNo != null ? Number(row.CellNo) : null,
        basicPay: Number(row.BasicPay || 0),
        effectiveFrom: row.EffectiveFrom,
        effectiveTo: row.EffectiveTo,
        reason: row.Reason || "",
        createdDate: row.CreatedDate,
        createdBy: row.CreatedBy,
      })),
    });
  } catch (error) {
    console.error("GET /api/employees/:id/pay-history error:", error);
    res.status(500).json({ message: "Unable to load pay history.", error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const request = new sql.Request();
    request.input("id", sql.Int, id);
    const result = await request.query(`
      ${employeeSelect}
      WHERE e.EmployeeId = @id
    `);
    if (!result.recordset[0]) {
      return res.status(404).json({ message: "Employee not found." });
    }
    res.json({ message: "OK", data: mapEmployee(result.recordset[0]) });
  } catch (error) {
    console.error("GET /api/employees/:id error:", error);
    res.status(500).json({ message: "Unable to load employee.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    /* Client EmployeeId is preferred; next-id is MAX+1 preview only (no sequence burn). */
    const employeeName = String(req.body?.employeeName || "").trim();
    const designationId = Number(req.body?.designationId);
    const instituteId = Number(req.body?.instituteId);
    const sectionId =
      req.body?.sectionId != null && req.body.sectionId !== ""
        ? Number(req.body.sectionId)
        : null;
    const dateOfJoining = req.body?.dateOfJoining || null;
    const dateOfBirth = req.body?.dateOfBirth || null;
    const dateOfFullPay = req.body?.dateOfFullPay || null;
    const dateOfRetirement = req.body?.dateOfRetirement || null;
    const monthParsed = parseMonthOfIncrement(req.body?.monthOfIncrement);
    if (monthParsed.error) {
      return res.status(400).json({ message: monthParsed.error });
    }
    const monthOfIncrement = monthParsed.value;
    const cccPassDate = req.body?.cccPassDate || null;
    const effectiveDate = req.body?.effectiveDate || dateOfJoining || null;
    const status = String(req.body?.status || "Active").trim() || "Active";
    const scaleOfPay = String(req.body?.scaleOfPay || "").trim() || null;
    const bankCheck = validateBankAccountNumber(req.body?.bankAccountNumber);
    if (bankCheck.error) {
      return res.status(400).json({ message: bankCheck.error });
    }
    const bankAccountNumber = bankCheck.value;
    const gpfNps = String(req.body?.gpfNps || "").trim() || null;
    const gpfNpsNumber = String(req.body?.gpfNpsNumber || "").trim() || null;

    if (!employeeName) {
      return res.status(400).json({ message: "Employee Name is required." });
    }
    if (!Number.isFinite(designationId) || designationId <= 0) {
      return res.status(400).json({ message: "Designation is required." });
    }
    if (!Number.isFinite(instituteId) || instituteId <= 0) {
      return res.status(400).json({ message: "Institute is required." });
    }
    if (!dateOfJoining || !dateOfBirth) {
      return res
        .status(400)
        .json({ message: "Date of Joining and Date of Birth are required." });
    }

    const desig = await sql.query`
      SELECT TOP 1 DesignationId FROM dbo.Designations WHERE DesignationId = ${designationId}
    `;
    if (!desig.recordset[0]) {
      return res.status(400).json({ message: "Selected Designation is invalid." });
    }

    const pay = await validateAndBuildPay(req.body);
    if (pay.error) {
      return res.status(400).json({ message: pay.error });
    }

    const inst = await sql.query`
      SELECT TOP 1 InstituteId, DistrictId, CityClassId, SectionId
      FROM dbo.Institutes WHERE InstituteId = ${instituteId}
    `;
    if (!inst.recordset[0]) {
      return res.status(400).json({ message: "Selected Institute is invalid." });
    }

    const resolvedSectionId = sectionId || inst.recordset[0].SectionId || null;
    const preferredId = req.body?.employeeId ?? req.body?.EmployeeId ?? null;

    const data = await withTransaction(async (transaction) => {
      const newId = await resolveCreateEmployeeId(transaction, preferredId);
      const employeeCode = String(newId);

      const insertReq = new sql.Request(transaction);
      insertReq.input("EmployeeId", sql.Int, newId);
      insertReq.input("EmployeeCode", sql.NVarChar(50), employeeCode);
      insertReq.input("EmployeeName", sql.NVarChar(200), employeeName);
      insertReq.input("DesignationId", sql.Int, designationId);
      insertReq.input("InstituteId", sql.Int, instituteId);
      insertReq.input("DistrictId", sql.Int, inst.recordset[0].DistrictId);
      insertReq.input("CityClassId", sql.Int, inst.recordset[0].CityClassId);
      insertReq.input("PayMatrixId", sql.Int, pay.payMatrixId);
      insertReq.input("EmployeeType", sql.NVarChar(20), pay.employeeType);
      insertReq.input("ScaleOfPay", sql.NVarChar(100), scaleOfPay);
      insertReq.input("DateOfJoining", sql.Date, dateOfJoining);
      insertReq.input("DateOfFullPay", sql.Date, dateOfFullPay);
      insertReq.input("DateOfBirth", sql.Date, dateOfBirth);
      insertReq.input("DateOfRetirement", sql.Date, dateOfRetirement);
      insertReq.input("MonthOfIncrement", sql.Int, monthOfIncrement);
      insertReq.input("CCCPassDate", sql.Date, cccPassDate);
      insertReq.input("Status", sql.NVarChar(50), status);
      insertReq.input("SectionId", sql.Int, resolvedSectionId);
      insertReq.input("PayRevisionId", sql.Int, pay.payRevisionId);
      insertReq.input("BasicPay", sql.Decimal(18, 2), pay.basicPay);
      insertReq.input("EffectiveDate", sql.Date, effectiveDate);
      insertReq.input("BankAccountNumber", sql.NVarChar(50), bankAccountNumber);
      insertReq.input("GPFNPS", sql.NVarChar(20), gpfNps);
      insertReq.input("GPFNPSNumber", sql.NVarChar(100), gpfNpsNumber);
      insertReq.input("PayLevel", sql.NVarChar(50), pay.payLevel);
      insertReq.input("PayMatrixCellNo", sql.Int, pay.payMatrixCellNo);
      insertReq.input("CreatedBy", sql.NVarChar(100), actor.fullName);

      await insertReq.query(`
        SET IDENTITY_INSERT dbo.EmployeeMaster ON;
        INSERT INTO dbo.EmployeeMaster
          (
            EmployeeId, EmployeeCode, EmployeeName, DesignationId, InstituteId, DistrictId, CityClassId,
            PayMatrixId, EmployeeType, ScaleOfPay, DateOfJoining, DateOfFullPay, DateOfBirth,
            DateOfRetirement, MonthOfIncrement, CCCPassDate, Status,
            SectionId, PayRevisionId, BasicPay, EffectiveDate, BankAccountNumber, GPFNPS, GPFNPSNumber,
            PayLevel, PayMatrixCellNo, IsActive, CreatedBy
          )
        VALUES
          (
            @EmployeeId, @EmployeeCode, @EmployeeName, @DesignationId, @InstituteId, @DistrictId, @CityClassId,
            @PayMatrixId, @EmployeeType, @ScaleOfPay, @DateOfJoining, @DateOfFullPay, @DateOfBirth,
            @DateOfRetirement, @MonthOfIncrement, @CCCPassDate, @Status,
            @SectionId, @PayRevisionId, @BasicPay, @EffectiveDate, @BankAccountNumber, @GPFNPS, @GPFNPSNumber,
            @PayLevel, @PayMatrixCellNo, 1, @CreatedBy
          );
        SET IDENTITY_INSERT dbo.EmployeeMaster OFF;
      `);

      const loadReq = new sql.Request(transaction);
      loadReq.input("id", sql.Int, newId);
      const loaded = await loadReq.query(
        `${employeeSelect} WHERE e.EmployeeId = @id`
      );
      return mapEmployee(loaded.recordset[0]);
    });

    await insertPayHistory(
      data.employeeId,
      pay,
      effectiveDate,
      actor.fullName,
      "Initial employee create"
    );

    await writeAudit({
      action: "CREATE",
      recordId: data.employeeId,
      newValues: data,
      userName: actor.fullName,
      ip: req.ip,
    });

    res.status(201).json({
      message: `Employee saved successfully. Employee ID: ${data.employeeId}`,
      data,
    });
  } catch (error) {
    console.error("POST /api/employees error:", error);
    const status = error.status || (error.number === 2627 ? 409 : 500);
    let message = error.message || "Unable to save employee.";
    if (error.number === 2627) {
      const idHint = Number(req.body?.employeeId ?? req.body?.EmployeeId);
      message = isValidGeneratedEmployeeId(idHint)
        ? `Employee ID ${idHint} already exists.`
        : "Employee ID already exists.";
    }
    res.status(status).json({ message, error: message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.EmployeeMaster WHERE EmployeeId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Employee not found." });
    }

    /* Employee ID is immutable on edit — reject client attempts to change it. */
    const requestedId = req.body?.employeeId ?? req.body?.EmployeeId;
    const requestedCode = req.body?.employeeCode ?? req.body?.EmployeeCode;
    if (
      requestedId != null &&
      String(requestedId).trim() !== "" &&
      Number(requestedId) !== id
    ) {
      return res.status(400).json({
        message: "Employee ID cannot be changed.",
      });
    }
    if (
      requestedCode != null &&
      String(requestedCode).trim() !== "" &&
      String(requestedCode).trim() !== String(current.recordset[0].EmployeeCode) &&
      String(requestedCode).trim() !== String(id)
    ) {
      return res.status(400).json({
        message: "Employee ID cannot be changed.",
      });
    }

    const employeeCode = String(current.recordset[0].EmployeeCode || id);
    const employeeName = String(req.body?.employeeName || "").trim();
    const designationId = Number(req.body?.designationId);
    const instituteId = Number(req.body?.instituteId);
    const sectionId =
      req.body?.sectionId != null && req.body.sectionId !== ""
        ? Number(req.body.sectionId)
        : null;
    const dateOfJoining = req.body?.dateOfJoining || null;
    const dateOfBirth = req.body?.dateOfBirth || null;
    const dateOfFullPay = req.body?.dateOfFullPay || null;
    const dateOfRetirement = req.body?.dateOfRetirement || null;
    const monthParsed = parseMonthOfIncrement(req.body?.monthOfIncrement);
    if (monthParsed.error) {
      return res.status(400).json({ message: monthParsed.error });
    }
    const monthOfIncrement = monthParsed.value;
    const cccPassDate = req.body?.cccPassDate || null;
    const effectiveDate =
      req.body?.effectiveDate ||
      current.recordset[0].EffectiveDate ||
      dateOfJoining ||
      new Date().toISOString().slice(0, 10);
    const status = String(req.body?.status || "Active").trim() || "Active";
    const scaleOfPay = String(req.body?.scaleOfPay || "").trim() || null;
    const bankCheck = validateBankAccountNumber(req.body?.bankAccountNumber);
    if (bankCheck.error) {
      return res.status(400).json({ message: bankCheck.error });
    }
    const bankAccountNumber = bankCheck.value;
    const gpfNps = String(req.body?.gpfNps || "").trim() || null;
    const gpfNpsNumber = String(req.body?.gpfNpsNumber || "").trim() || null;

    if (!employeeName) {
      return res.status(400).json({ message: "Employee Name is required." });
    }
    if (!Number.isFinite(designationId) || designationId <= 0) {
      return res.status(400).json({ message: "Designation is required." });
    }
    if (!Number.isFinite(instituteId) || instituteId <= 0) {
      return res.status(400).json({ message: "Institute is required." });
    }

    const desig = await sql.query`
      SELECT TOP 1 DesignationId FROM dbo.Designations WHERE DesignationId = ${designationId}
    `;
    if (!desig.recordset[0]) {
      return res.status(400).json({ message: "Selected Designation is invalid." });
    }

    const pay = await validateAndBuildPay(req.body, current.recordset[0]);
    if (pay.error) {
      return res.status(400).json({ message: pay.error });
    }

    const inst = await sql.query`
      SELECT TOP 1 InstituteId, DistrictId, CityClassId, SectionId
      FROM dbo.Institutes WHERE InstituteId = ${instituteId}
    `;
    if (!inst.recordset[0]) {
      return res.status(400).json({ message: "Selected Institute is invalid." });
    }

    const dup = await sql.query`
      SELECT TOP 1 EmployeeId FROM dbo.EmployeeMaster
      WHERE EmployeeCode = ${employeeCode} AND EmployeeId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Employee ID already exists." });
    }

    const oldMapped = mapEmployee(current.recordset[0]);

    await sql.query`
      UPDATE dbo.EmployeeMaster
      SET
        EmployeeCode = ${employeeCode},
        EmployeeName = ${employeeName},
        DesignationId = ${designationId},
        InstituteId = ${instituteId},
        DistrictId = ${inst.recordset[0].DistrictId},
        CityClassId = ${inst.recordset[0].CityClassId},
        SectionId = ${sectionId || inst.recordset[0].SectionId},
        PayRevisionId = ${pay.payRevisionId},
        PayMatrixId = ${pay.payMatrixId},
        PayLevel = ${pay.payLevel},
        PayMatrixCellNo = ${pay.payMatrixCellNo},
        BasicPay = ${pay.basicPay},
        EffectiveDate = ${effectiveDate},
        EmployeeType = ${pay.employeeType},
        ScaleOfPay = ${scaleOfPay},
        DateOfJoining = ${dateOfJoining},
        DateOfFullPay = ${dateOfFullPay},
        DateOfBirth = ${dateOfBirth},
        DateOfRetirement = ${dateOfRetirement},
        MonthOfIncrement = ${monthOfIncrement},
        CCCPassDate = ${cccPassDate},
        BankAccountNumber = ${bankAccountNumber},
        GPFNPS = ${gpfNps},
        GPFNPSNumber = ${gpfNpsNumber},
        Status = ${status},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      WHERE EmployeeId = ${id}
    `;

    if (isPayChanged(current.recordset[0], pay)) {
      await insertPayHistory(
        id,
        pay,
        effectiveDate,
        actor.fullName,
        "Pay change from Employee Master"
      );
    }

    const request = new sql.Request();
    request.input("id", sql.Int, id);
    const loaded = await request.query(`${employeeSelect} WHERE e.EmployeeId = @id`);
    const data = mapEmployee(loaded.recordset[0]);

    await writeAudit({
      action: "UPDATE",
      recordId: id,
      oldValues: oldMapped,
      newValues: data,
      userName: actor.fullName,
      ip: req.ip,
    });

    res.json({ message: "Employee updated successfully.", data });
  } catch (error) {
    console.error("PUT /api/employees/:id error:", error);
    res.status(500).json({ message: "Unable to update employee.", error: error.message });
  }
});

module.exports = router;
module.exports.validateAndBuildPay = validateAndBuildPay;
module.exports.normalizeEmployeeType = normalizeEmployeeType;
module.exports.resolvePayFromMatrix = resolvePayFromMatrix;
