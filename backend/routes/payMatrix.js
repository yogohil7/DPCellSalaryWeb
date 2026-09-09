const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { sql } = require("../db");
const { getBasicPay } = require("../utils/payMatrixLookup");
const {
  normalizePayMatrixCellNo,
  normalizePayMatrixLevel,
} = require("../utils/payMatrixLookup");
const XLSX = require("xlsx");
const {
  readWorkbookRows,
  validateImportRows,
  buildTemplateWorkbook,
} = require("../utils/payMatrixImport");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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

function normalizeStatus(value, isActive) {
  if (isActive === false || isActive === 0 || isActive === "0") return "Inactive";
  if (isActive === true || isActive === 1 || isActive === "1") return "Active";
  const raw = String(value || "Active").trim().toUpperCase();
  return raw === "INACTIVE" ? "Inactive" : "Active";
}

function mapMatrix(row) {
  const status = normalizeStatus(row.Status, row.IsActive);
  return {
    payMatrixId: Number(row.PayMatrixId),
    id: Number(row.PayMatrixId),
    payRevisionId: row.PayRevisionId != null ? Number(row.PayRevisionId) : null,
    revisionCode: row.RevisionCode || "",
    revisionName: row.RevisionName || "",
    payCommission: row.PayCommission || "",
    level: row.Level == null ? "" : String(row.Level).trim(),
    cellNo: Number(row.CellNo),
    basicPay: Number(row.BasicPay),
    effectiveDate: row.EffectiveDate,
    status,
    isActive: status === "Active",
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

/* GET /api/pay-matrix?payRevisionId=&active=1 */
router.get("/", async (req, res) => {
  try {
    const payRevisionId = Number(req.query.payRevisionId);
    const activeOnly =
      String(req.query.active || "1").toLowerCase() !== "0" &&
      String(req.query.active || "").toLowerCase() !== "false";

    let result;
    if (Number.isFinite(payRevisionId) && payRevisionId > 0) {
      result = activeOnly
        ? await sql.query`
            SELECT m.*, r.RevisionCode, r.RevisionName
            FROM dbo.PayMatrixMaster m
            LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
            WHERE m.PayRevisionId = ${payRevisionId}
              AND (UPPER(ISNULL(m.Status, N'Active')) = N'ACTIVE' OR ISNULL(m.IsActive, 1) = 1)
            ORDER BY m.Level, m.CellNo
          `
        : await sql.query`
            SELECT m.*, r.RevisionCode, r.RevisionName
            FROM dbo.PayMatrixMaster m
            LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
            WHERE m.PayRevisionId = ${payRevisionId}
            ORDER BY m.Level, m.CellNo
          `;
    } else {
      result = await sql.query`
        SELECT m.*, r.RevisionCode, r.RevisionName
        FROM dbo.PayMatrixMaster m
        LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
        ORDER BY m.PayRevisionId, m.Level, m.CellNo
      `;
    }

    res.json({ message: "OK", data: result.recordset.map(mapMatrix) });
  } catch (error) {
    console.error("GET /api/pay-matrix error:", error);
    res.status(500).json({ message: "Unable to load pay matrix.", error: error.message });
  }
});

/* GET /api/pay-matrix/levels?payRevisionId= */
router.get("/levels", async (req, res) => {
  try {
    const payRevisionId = Number(req.query.payRevisionId);
    if (!Number.isFinite(payRevisionId) || payRevisionId <= 0) {
      return res.status(400).json({ message: "payRevisionId is required." });
    }
    const result = await sql.query`
      SELECT DISTINCT Level
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${payRevisionId}
        AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
      ORDER BY Level
    `;
    res.json({
      message: "OK",
      data: result.recordset.map((r) =>
        r.Level == null ? "" : String(r.Level).trim()
      ),
    });
  } catch (error) {
    console.error("GET /api/pay-matrix/levels error:", error);
    res.status(500).json({ message: "Unable to load levels.", error: error.message });
  }
});

/* GET /api/pay-matrix/cells?payRevisionId=&level= */
router.get("/cells", async (req, res) => {
  try {
    const payRevisionId = Number(req.query.payRevisionId);
    const level = String(req.query.level || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!Number.isFinite(payRevisionId) || !level) {
      return res.status(400).json({ message: "payRevisionId and level are required." });
    }
    const result = await sql.query`
      SELECT PayMatrixId, CellNo, BasicPay
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${payRevisionId}
        AND Level = ${level}
        AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
      ORDER BY CellNo
    `;
    res.json({
      message: "OK",
      data: result.recordset.map((r) => ({
        payMatrixId: Number(r.PayMatrixId),
        cellNo: Number(r.CellNo),
        basicPay: Number(r.BasicPay),
      })),
    });
  } catch (error) {
    console.error("GET /api/pay-matrix/cells error:", error);
    res.status(500).json({ message: "Unable to load cells.", error: error.message });
  }
});

/* GET /api/pay-matrix/basic-pay?payRevisionId=&level=&cellNo=&effectiveDate= */
router.get("/basic-pay", async (req, res) => {
  try {
    const payRevisionId = Number(req.query.payRevisionId);
    const level = normalizePayMatrixLevel(req.query.level);
    const cellNo = normalizePayMatrixCellNo(req.query.cellNo);
    const effectiveDate = req.query.effectiveDate || null;
    if (!Number.isFinite(payRevisionId) || !level || cellNo == null) {
      return res.status(400).json({
        message: "payRevisionId, level and cellNo are required.",
      });
    }
    const data = await getBasicPay({
      payRevisionId,
      level,
      cellNo,
      /* UI preview: same as employee assignment — no DOJ date filter. */
      effectiveDate: null,
    });
    if (!data) {
      return res.status(404).json({ message: "Pay Matrix cell not found." });
    }
    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/pay-matrix/basic-pay error:", error);
    res.status(500).json({ message: "Unable to load basic pay.", error: error.message });
  }
});

/* GET /api/pay-matrix/template — downloadable Excel template */
router.get("/template", (req, res) => {
  try {
    const templatesDir = path.join(__dirname, "..", "templates");
    const filePath = path.join(templatesDir, "PayMatrix_Import_Template.xls");
    const workbook = buildTemplateWorkbook();
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
    XLSX.writeFile(workbook, filePath, { bookType: "xls" });
    res.download(filePath, "PayMatrix_Import_Template.xls");
  } catch (error) {
    console.error("GET /api/pay-matrix/template error:", error);
    res.status(500).json({ message: "Unable to download template.", error: error.message });
  }
});

/* POST /api/pay-matrix/import — Excel upsert (all-or-nothing transaction) */
router.post("/import", upload.single("file"), async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Excel file is required." });
    }

    const selectedPayRevisionId = Number(
      req.body?.payRevisionId || req.body?.PayRevisionId || 0
    );

    let parsed;
    try {
      parsed = readWorkbookRows(req.file.buffer, { debug: true });
    } catch (err) {
      return res.status(err.status || 400).json({
        message: err.message || "Unable to read Excel file.",
        summary: {
          totalRows: 0,
          validRows: 0,
          insertedRows: 0,
          updatedRows: 0,
          failedRows: 0,
        },
        errors: [{ row: 0, field: "File", value: "", message: err.message }],
      });
    }

    const rawRows = parsed.rows || [];
    if (!rawRows.length) {
      return res.status(400).json({
        message: "No data rows found in Excel.",
        summary: {
          totalRows: 0,
          validRows: 0,
          insertedRows: 0,
          updatedRows: 0,
          failedRows: 0,
        },
        errors: [
          {
            row: 0,
            field: "File",
            value: "",
            message: "No data rows found in Excel.",
          },
        ],
      });
    }

    if (!Number.isFinite(selectedPayRevisionId) || selectedPayRevisionId <= 0) {
      return res.status(400).json({
        message: "Pay Revision must be selected before import.",
        summary: {
          totalRows: rawRows.length,
          validRows: 0,
          insertedRows: 0,
          updatedRows: 0,
          failedRows: rawRows.length,
        },
        errors: [
          {
            row: 0,
            field: "PayRevision",
            value: "",
            message: "Select a Pay Revision on the import screen.",
          },
        ],
      });
    }

    const revCheck = await sql.query`
      SELECT TOP 1 PayRevisionId, RevisionCode
      FROM dbo.PayRevisionMaster
      WHERE PayRevisionId = ${selectedPayRevisionId}
    `;
    if (!revCheck.recordset[0]) {
      return res.status(400).json({
        message: "Selected Pay Revision is invalid.",
        summary: {
          totalRows: rawRows.length,
          validRows: 0,
          insertedRows: 0,
          updatedRows: 0,
          failedRows: rawRows.length,
        },
        errors: [
          {
            row: 0,
            field: "PayRevision",
            value: selectedPayRevisionId,
            message: "Selected Pay Revision does not exist.",
          },
        ],
      });
    }

    /* Excel PayRevisionCode is ignored when UI selection is present (kept for legacy files). */
    const revisions = await sql.query`
      SELECT PayRevisionId, RevisionCode
      FROM dbo.PayRevisionMaster
    `;
    const revisionByCode = new Map();
    for (const row of revisions.recordset) {
      revisionByCode.set(String(row.RevisionCode || "").trim().toUpperCase(), row);
    }

    const { errors, valid } = validateImportRows(rawRows, {
      selectedPayRevisionId,
      revisionByCode,
    });
    if (errors.length) {
      return res.status(400).json({
        message: "Import failed. Fix validation errors and re-import. No rows were saved.",
        summary: {
          totalRows: rawRows.length,
          validRows: valid.length,
          insertedRows: 0,
          updatedRows: 0,
          failedRows: errors.length,
        },
        errors,
      });
    }

    const transaction = new sql.Transaction();
    await transaction.begin();
    let insertedRows = 0;
    let updatedRows = 0;

    try {
      for (const row of valid) {
        const reqTx = new sql.Request(transaction);
        reqTx.input("PayRevisionId", sql.Int, row.payRevisionId);
        reqTx.input("Level", sql.NVarChar(50), row.level);
        reqTx.input("CellNo", sql.Int, row.cellNo);
        reqTx.input("BasicPay", sql.Decimal(18, 2), row.basicPay);
        reqTx.input("EffectiveDate", sql.Date, row.effectiveDate);
        reqTx.input("UserName", sql.NVarChar(200), actor.fullName);
        const result = await reqTx.execute("dbo.usp_PayMatrix_Import");
        const action = String(result.recordset?.[0]?.ActionName || "").toUpperCase();
        if (action === "INSERTED") insertedRows += 1;
        else updatedRows += 1;
      }
      await transaction.commit();
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (_) {
        /* ignore */
      }
      throw err;
    }

    res.json({
      message: "Import completed successfully.",
      summary: {
        totalRows: rawRows.length,
        validRows: valid.length,
        insertedRows,
        updatedRows,
        failedRows: 0,
      },
      errors: [],
    });
  } catch (error) {
    console.error("POST /api/pay-matrix/import error:", error);
    res.status(500).json({
      message: error.message || "Unable to import pay matrix.",
      error: error.message,
      summary: {
        totalRows: 0,
        validRows: 0,
        insertedRows: 0,
        updatedRows: 0,
        failedRows: 0,
      },
      errors: [{ row: 0, field: "Server", value: "", message: error.message }],
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT TOP 1 m.*, r.RevisionCode, r.RevisionName
      FROM dbo.PayMatrixMaster m
      LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
      WHERE m.PayMatrixId = ${id}
    `;
    if (!result.recordset[0]) {
      return res.status(404).json({ message: "Pay Matrix row not found." });
    }
    res.json({ message: "OK", data: mapMatrix(result.recordset[0]) });
  } catch (error) {
    console.error("GET /api/pay-matrix/:id error:", error);
    res.status(500).json({ message: "Unable to load pay matrix row.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const payRevisionId = Number(req.body?.payRevisionId);
    const level = String(req.body?.level || "")
      .replace(/\s+/g, " ")
      .trim();
    const cellNo = Number(req.body?.cellNo);
    const basicPay = Number(req.body?.basicPay);
    const effectiveDate = req.body?.effectiveDate || null;
    const payCommission = String(req.body?.payCommission || "").trim() || null;
    const status = normalizeStatus(req.body?.status, req.body?.isActive);
    const isActive = status === "Active" ? 1 : 0;

    if (!Number.isFinite(payRevisionId) || payRevisionId <= 0) {
      return res.status(400).json({ message: "Pay Revision is required." });
    }
    if (!level || level.length > 50) {
      return res.status(400).json({ message: "Level is required (max 50 characters)." });
    }
    if (!Number.isInteger(cellNo) || cellNo <= 0) {
      return res.status(400).json({ message: "Cell No must be a valid positive number." });
    }
    if (!Number.isFinite(basicPay) || basicPay < 0) {
      return res.status(400).json({ message: "Basic Pay must be a number >= 0." });
    }
    if (!effectiveDate) {
      return res.status(400).json({ message: "Effective Date is required." });
    }

    const rev = await sql.query`
      SELECT TOP 1 PayRevisionId FROM dbo.PayRevisionMaster WHERE PayRevisionId = ${payRevisionId}
    `;
    if (!rev.recordset[0]) {
      return res.status(400).json({ message: "Selected Pay Revision is invalid." });
    }

    const dup = await sql.query`
      SELECT TOP 1 PayMatrixId
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${payRevisionId} AND Level = ${level} AND CellNo = ${cellNo}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        message: "Duplicate Pay Matrix row for this Pay Revision + Level + Cell No.",
      });
    }

    const insert = await sql.query`
      INSERT INTO dbo.PayMatrixMaster
        (PayRevisionId, PayCommission, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive, CreatedBy)
      OUTPUT INSERTED.*
      VALUES
        (${payRevisionId}, ${payCommission}, ${level}, ${cellNo}, ${basicPay},
         ${effectiveDate}, ${status}, ${isActive}, ${actor.fullName})
    `;

    const joined = await sql.query`
      SELECT m.*, r.RevisionCode, r.RevisionName
      FROM dbo.PayMatrixMaster m
      LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
      WHERE m.PayMatrixId = ${insert.recordset[0].PayMatrixId}
    `;

    res.status(201).json({
      message: "Pay Matrix row saved successfully.",
      data: mapMatrix(joined.recordset[0]),
    });
  } catch (error) {
    console.error("POST /api/pay-matrix error:", error);
    res.status(500).json({ message: "Unable to save pay matrix.", error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.PayMatrixMaster WHERE PayMatrixId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Pay Matrix row not found." });
    }

    const payRevisionId = Number(req.body?.payRevisionId);
    const level = String(req.body?.level || "")
      .replace(/\s+/g, " ")
      .trim();
    const cellNo = Number(req.body?.cellNo);
    const basicPay = Number(req.body?.basicPay);
    const effectiveDate = req.body?.effectiveDate || null;
    const payCommission = String(req.body?.payCommission || "").trim() || null;
    const status = normalizeStatus(req.body?.status, req.body?.isActive);
    const isActive = status === "Active" ? 1 : 0;

    if (!Number.isFinite(payRevisionId) || !level || !Number.isInteger(cellNo)) {
      return res.status(400).json({ message: "Pay Revision, Level and Cell No are required." });
    }
    if (level.length > 50 || cellNo <= 0) {
      return res.status(400).json({ message: "Level and Cell No must be valid." });
    }
    if (!Number.isFinite(basicPay) || basicPay < 0) {
      return res.status(400).json({ message: "Basic Pay must be a number >= 0." });
    }

    const dup = await sql.query`
      SELECT TOP 1 PayMatrixId
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${payRevisionId}
        AND Level = ${level}
        AND CellNo = ${cellNo}
        AND PayMatrixId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        message: "Duplicate Pay Matrix row for this Pay Revision + Level + Cell No.",
      });
    }

    await sql.query`
      UPDATE dbo.PayMatrixMaster
      SET
        PayRevisionId = ${payRevisionId},
        PayCommission = ${payCommission},
        Level = ${level},
        CellNo = ${cellNo},
        BasicPay = ${basicPay},
        EffectiveDate = ${effectiveDate},
        Status = ${status},
        IsActive = ${isActive},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      WHERE PayMatrixId = ${id}
    `;

    const joined = await sql.query`
      SELECT m.*, r.RevisionCode, r.RevisionName
      FROM dbo.PayMatrixMaster m
      LEFT JOIN dbo.PayRevisionMaster r ON r.PayRevisionId = m.PayRevisionId
      WHERE m.PayMatrixId = ${id}
    `;

    res.json({
      message: "Pay Matrix row updated successfully.",
      data: mapMatrix(joined.recordset[0]),
    });
  } catch (error) {
    console.error("PUT /api/pay-matrix/:id error:", error);
    res.status(500).json({ message: "Unable to update pay matrix.", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.PayMatrixMaster WHERE PayMatrixId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Pay Matrix row not found." });
    }

    const used = await sql.query`
      SELECT COUNT(1) AS Cnt FROM dbo.EmployeeMaster WHERE PayMatrixId = ${id}
    `;
    if (Number(used.recordset[0]?.Cnt || 0) > 0) {
      await sql.query`
        UPDATE dbo.PayMatrixMaster
        SET Status = N'Inactive', IsActive = 0,
            ModifiedDate = SYSDATETIME(), ModifiedBy = ${actor.fullName}
        WHERE PayMatrixId = ${id}
      `;
      return res.status(409).json({
        message:
          "Pay Matrix row is used by employees and was deactivated instead of deleted.",
      });
    }

    await sql.query`DELETE FROM dbo.PayMatrixMaster WHERE PayMatrixId = ${id}`;
    res.json({ message: "Pay Matrix row deleted successfully." });
  } catch (error) {
    console.error("DELETE /api/pay-matrix/:id error:", error);
    res.status(500).json({ message: "Unable to delete pay matrix.", error: error.message });
  }
});

module.exports = router;
