const express = require("express");
const { sql } = require("../db");

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

function normalizeStatus(value, isActive) {
  if (isActive === false || isActive === 0 || isActive === "0") return "Inactive";
  if (isActive === true || isActive === 1 || isActive === "1") return "Active";
  const raw = String(value || "Active").trim().toUpperCase();
  return raw === "INACTIVE" || raw === "0" || raw === "FALSE" ? "Inactive" : "Active";
}

function mapRevision(row) {
  const status = normalizeStatus(row.Status, row.IsActive);
  return {
    payRevisionId: Number(row.PayRevisionId),
    id: Number(row.PayRevisionId),
    srNo: row.SrNo != null ? Number(row.SrNo) : null,
    revisionCode: row.RevisionCode || "",
    revisionName: row.RevisionName || "",
    effectiveFrom: row.EffectiveFrom,
    effectiveTo: row.EffectiveTo,
    description: row.Description || "",
    status,
    isActive: status === "Active",
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

async function writeAudit({ userId, tableName, recordId, action, oldValues, newValues, userName, ip }) {
  try {
    await sql.query`
      INSERT INTO dbo.AuditLogs
        (ModuleName, ActionName, EntityKey, Details, UserName, FullName, UserId, TableName, RecordId, OldValues, NewValues, IPAddress)
      VALUES
        (
          N'PayRevisionMaster',
          ${action},
          ${String(recordId || "")},
          ${action},
          ${userName || "SYSTEM"},
          ${userName || "SYSTEM"},
          ${userId || null},
          ${tableName},
          ${String(recordId || "")},
          ${oldValues ? JSON.stringify(oldValues) : null},
          ${newValues ? JSON.stringify(newValues) : null},
          ${ip || null}
        )
    `;
  } catch (err) {
    console.warn("Audit log skipped:", err.message);
  }
}

/* GET /api/pay-revisions?active=1 */
router.get("/", async (req, res) => {
  try {
    const activeOnly =
      String(req.query.active || "").toLowerCase() === "1" ||
      String(req.query.active || "").toLowerCase() === "true";

    const result = activeOnly
      ? await sql.query`
          SELECT *
          FROM dbo.PayRevisionMaster
          WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
             OR ISNULL(IsActive, 1) = 1
          ORDER BY EffectiveFrom DESC, PayRevisionId DESC
        `
      : await sql.query`
          SELECT *
          FROM dbo.PayRevisionMaster
          ORDER BY EffectiveFrom DESC, PayRevisionId DESC
        `;

    const data = result.recordset
      .map(mapRevision)
      .filter((row) => (activeOnly ? row.isActive : true));

    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/pay-revisions error:", error);
    res.status(500).json({ message: "Unable to load pay revisions.", error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT TOP 1 * FROM dbo.PayRevisionMaster WHERE PayRevisionId = ${id}
    `;
    if (!result.recordset[0]) {
      return res.status(404).json({ message: "Pay Revision not found." });
    }
    res.json({ message: "OK", data: mapRevision(result.recordset[0]) });
  } catch (error) {
    console.error("GET /api/pay-revisions/:id error:", error);
    res.status(500).json({ message: "Unable to load pay revision.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const revisionCode = String(req.body?.revisionCode || "").trim().toUpperCase();
    const revisionName = String(req.body?.revisionName || "").trim();
    const effectiveFrom = req.body?.effectiveFrom || null;
    const effectiveTo = req.body?.effectiveTo || null;
    const description = String(req.body?.description || "").trim();
    const status = normalizeStatus(req.body?.status, req.body?.isActive);
    const isActive = status === "Active" ? 1 : 0;
    const srNo = req.body?.srNo != null && req.body.srNo !== "" ? Number(req.body.srNo) : null;

    if (!revisionCode) {
      return res.status(400).json({ message: "Revision Code is required." });
    }
    if (!revisionName) {
      return res.status(400).json({ message: "Revision Name is required." });
    }
    if (!effectiveFrom) {
      return res.status(400).json({ message: "Effective From is required." });
    }
    if (effectiveTo && String(effectiveTo) < String(effectiveFrom)) {
      return res.status(400).json({ message: "Effective To cannot be earlier than Effective From." });
    }

    const dup = await sql.query`
      SELECT TOP 1 PayRevisionId FROM dbo.PayRevisionMaster WHERE RevisionCode = ${revisionCode}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Revision Code already exists." });
    }

    const insert = await sql.query`
      INSERT INTO dbo.PayRevisionMaster
        (SrNo, RevisionCode, RevisionName, EffectiveFrom, EffectiveTo, Description, Status, IsActive, CreatedBy)
      OUTPUT INSERTED.*
      VALUES
        (${srNo}, ${revisionCode}, ${revisionName}, ${effectiveFrom}, ${effectiveTo || null},
         ${description || null}, ${status}, ${isActive}, ${actor.fullName})
    `;

    const data = mapRevision(insert.recordset[0]);
    await writeAudit({
      action: "CREATE",
      tableName: "PayRevisionMaster",
      recordId: data.payRevisionId,
      newValues: data,
      userName: actor.fullName,
      ip: req.ip,
    });

    res.status(201).json({ message: "Pay Revision saved successfully.", data });
  } catch (error) {
    console.error("POST /api/pay-revisions error:", error);
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({ message: "Revision Code already exists." });
    }
    res.status(500).json({ message: "Unable to save pay revision.", error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.PayRevisionMaster WHERE PayRevisionId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Pay Revision not found." });
    }

    const revisionCode = String(req.body?.revisionCode || "").trim().toUpperCase();
    const revisionName = String(req.body?.revisionName || "").trim();
    const effectiveFrom = req.body?.effectiveFrom || null;
    const effectiveTo = req.body?.effectiveTo || null;
    const description = String(req.body?.description || "").trim();
    const status = normalizeStatus(req.body?.status, req.body?.isActive);
    const isActive = status === "Active" ? 1 : 0;
    const srNo = req.body?.srNo != null && req.body.srNo !== "" ? Number(req.body.srNo) : null;

    if (!revisionCode || !revisionName || !effectiveFrom) {
      return res.status(400).json({ message: "Revision Code, Name and Effective From are required." });
    }
    if (effectiveTo && String(effectiveTo) < String(effectiveFrom)) {
      return res.status(400).json({ message: "Effective To cannot be earlier than Effective From." });
    }

    const dup = await sql.query`
      SELECT TOP 1 PayRevisionId
      FROM dbo.PayRevisionMaster
      WHERE RevisionCode = ${revisionCode} AND PayRevisionId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Revision Code already exists." });
    }

    const updated = await sql.query`
      UPDATE dbo.PayRevisionMaster
      SET
        SrNo = ${srNo},
        RevisionCode = ${revisionCode},
        RevisionName = ${revisionName},
        EffectiveFrom = ${effectiveFrom},
        EffectiveTo = ${effectiveTo || null},
        Description = ${description || null},
        Status = ${status},
        IsActive = ${isActive},
        ModifiedDate = GETDATE(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE PayRevisionId = ${id}
    `;

    const data = mapRevision(updated.recordset[0]);
    await writeAudit({
      action: "UPDATE",
      tableName: "PayRevisionMaster",
      recordId: id,
      oldValues: mapRevision(current.recordset[0]),
      newValues: data,
      userName: actor.fullName,
      ip: req.ip,
    });

    res.json({ message: "Pay Revision updated successfully.", data });
  } catch (error) {
    console.error("PUT /api/pay-revisions/:id error:", error);
    res.status(500).json({ message: "Unable to update pay revision.", error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const status = normalizeStatus(req.body?.status, req.body?.isActive);
    const isActive = status === "Active" ? 1 : 0;

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.PayRevisionMaster WHERE PayRevisionId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Pay Revision not found." });
    }

    const updated = await sql.query`
      UPDATE dbo.PayRevisionMaster
      SET Status = ${status}, IsActive = ${isActive},
          ModifiedDate = GETDATE(), ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE PayRevisionId = ${id}
    `;

    res.json({
      message: `Pay Revision marked as ${status}.`,
      data: mapRevision(updated.recordset[0]),
    });
  } catch (error) {
    console.error("PATCH /api/pay-revisions/:id/status error:", error);
    res.status(500).json({ message: "Unable to update status.", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.PayRevisionMaster WHERE PayRevisionId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Pay Revision not found." });
    }

    const refs = await sql.query`
      SELECT
        (SELECT COUNT(1) FROM dbo.PayMatrixMaster WHERE PayRevisionId = ${id}) AS MatrixCnt,
        (SELECT COUNT(1) FROM dbo.EmployeeMaster WHERE PayRevisionId = ${id}) AS EmpCnt,
        (SELECT COUNT(1) FROM dbo.EmployeePayHistory WHERE PayRevisionId = ${id}) AS HistCnt
    `;
    const matrixCnt = Number(refs.recordset[0]?.MatrixCnt || 0);
    const empCnt = Number(refs.recordset[0]?.EmpCnt || 0);
    const histCnt = Number(refs.recordset[0]?.HistCnt || 0);

    if (matrixCnt > 0 || empCnt > 0 || histCnt > 0) {
      return res.status(409).json({
        message:
          "Pay Revision cannot be deleted because it is referenced by Pay Matrix / Employee / Pay History. Deactivate it instead.",
      });
    }

    await sql.query`DELETE FROM dbo.PayRevisionMaster WHERE PayRevisionId = ${id}`;
    await writeAudit({
      action: "DELETE",
      tableName: "PayRevisionMaster",
      recordId: id,
      oldValues: mapRevision(current.recordset[0]),
      userName: actor.fullName,
      ip: req.ip,
    });

    res.json({ message: "Pay Revision deleted successfully." });
  } catch (error) {
    console.error("DELETE /api/pay-revisions/:id error:", error);
    res.status(500).json({ message: "Unable to delete pay revision.", error: error.message });
  }
});

module.exports = router;
