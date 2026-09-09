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

function normalizeStatus(value) {
  const raw = String(value || "Active").trim().toUpperCase();
  return raw === "INACTIVE" || raw === "0" || raw === "FALSE"
    ? "Inactive"
    : "Active";
}

function toDateOnly(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function mapDa(row) {
  return {
    id: Number(row.DAId),
    daId: Number(row.DAId),
    srNo: row.SrNo != null ? Number(row.SrNo) : null,
    effectiveDate: toDateOnly(row.EffectiveFrom),
    effectiveFrom: toDateOnly(row.EffectiveFrom),
    effectiveTo: toDateOnly(row.EffectiveTo),
    daPercentage: Number(row.DAPercentage),
    description: row.DAName || "",
    daName: row.DAName || "",
    status: normalizeStatus(row.Status),
    payRevisionId:
      row.PayRevisionId != null ? Number(row.PayRevisionId) : null,
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

function validatePayload(body) {
  const effectiveFrom = toDateOnly(body.effectiveDate || body.effectiveFrom);
  const daPercentage = Number(body.daPercentage);
  const description = String(body.description || body.daName || "").trim();
  const status = normalizeStatus(body.status);
  const payRevisionId =
    body.payRevisionId != null && body.payRevisionId !== ""
      ? Number(body.payRevisionId)
      : null;

  if (!effectiveFrom) {
    return { error: "Effective From Date is required." };
  }
  if (!Number.isFinite(daPercentage)) {
    return { error: "DA Percentage is required and must be numeric." };
  }
  if (daPercentage < 0 || daPercentage > 100) {
    return { error: "DA Percentage must be between 0 and 100." };
  }
  if (!status) {
    return { error: "Status is required." };
  }

  return {
    effectiveFrom,
    daPercentage,
    description: description || `DA ${daPercentage}% from ${effectiveFrom}`,
    status,
    payRevisionId:
      Number.isFinite(payRevisionId) && payRevisionId > 0
        ? payRevisionId
        : null,
  };
}

/* GET /api/da-master */
router.get("/", async (req, res) => {
  try {
    const effectiveDate = toDateOnly(req.query.effectiveDate);
    const status = String(req.query.status || "All").trim();
    const daPercentage =
      req.query.daPercentage != null && String(req.query.daPercentage).trim() !== ""
        ? Number(req.query.daPercentage)
        : null;

    let result;
    if (effectiveDate || status !== "All" || Number.isFinite(daPercentage)) {
      result = await sql.query`
        SELECT *
        FROM dbo.DAMaster
        WHERE (${effectiveDate} IS NULL OR EffectiveFrom = ${effectiveDate})
          AND (${status} = N'All' OR UPPER(ISNULL(Status, N'Active')) = UPPER(${status}))
          AND (${daPercentage} IS NULL OR DAPercentage = ${daPercentage})
        ORDER BY EffectiveFrom DESC, DAId DESC
      `;
    } else {
      result = await sql.query`
        SELECT *
        FROM dbo.DAMaster
        ORDER BY EffectiveFrom DESC, DAId DESC
      `;
    }

    res.json({
      success: true,
      message: "OK",
      data: result.recordset.map(mapDa),
    });
  } catch (error) {
    console.error("GET /api/da-master error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load DA Master.",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT TOP 1 * FROM dbo.DAMaster WHERE DAId = ${id}
    `;
    if (!result.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "DA Master record not found.",
      });
    }
    res.json({
      success: true,
      message: "OK",
      data: mapDa(result.recordset[0]),
    });
  } catch (error) {
    console.error("GET /api/da-master/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load DA Master.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const parsed = validatePayload(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    /* Phase 9 — exact-date duplicate check (existing). */
    const dup = await sql.query`
      SELECT TOP 1 DAId
      FROM dbo.DAMaster
      WHERE EffectiveFrom = ${parsed.effectiveFrom}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message: "DA record already exists for this Effective From Date.",
      });
    }

    /*
     * Phase 9 — same-calendar-month overlap check (Option A).
     * Only one Active DA record may have an EffectiveFrom date in a given
     * calendar year/month. Because EffectiveTo is always NULL the salary
     * calculator picks the record with the latest EffectiveFrom <= salary
     * month, so two records in the same month would create silent ambiguity.
     * Inactive records are excluded: soft-deleted records do not participate
     * in salary calculation and must not block legitimate corrections.
     */
    const newDate = new Date(parsed.effectiveFrom);
    const newYear = newDate.getFullYear();
    const newMonth = newDate.getMonth() + 1; // 1-based
    const monthOverlap = await sql.query`
      SELECT TOP 1 DAId, EffectiveFrom
      FROM dbo.DAMaster
      WHERE YEAR(EffectiveFrom)  = ${newYear}
        AND MONTH(EffectiveFrom) = ${newMonth}
        AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
    `;
    if (monthOverlap.recordset[0]) {
      const existingDate = monthOverlap.recordset[0].EffectiveFrom
        ? String(monthOverlap.recordset[0].EffectiveFrom).slice(0, 10)
        : "unknown date";
      const monthLabel = newDate.toLocaleString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      return res.status(409).json({
        success: false,
        message:
          `A DA rate already exists for ${monthLabel} ` +
          `(effective from ${existingDate}). ` +
          `Only one Active DA rate may take effect per calendar month.`,
      });
    }

    const sr = await sql.query`
      SELECT ISNULL(MAX(SrNo), 0) + 1 AS NextSr FROM dbo.DAMaster
    `;
    const srNo = Number(sr.recordset[0]?.NextSr || 1);

    const insert = await sql.query`
      INSERT INTO dbo.DAMaster
        (SrNo, DAName, DAPercentage, EffectiveFrom, EffectiveTo, Status, CreatedBy, PayRevisionId)
      OUTPUT INSERTED.*
      VALUES
        (
          ${srNo},
          ${parsed.description},
          ${parsed.daPercentage},
          ${parsed.effectiveFrom},
          NULL,
          ${parsed.status},
          ${actor.fullName},
          ${parsed.payRevisionId}
        )
    `;

    const data = mapDa(insert.recordset[0]);
    res.status(201).json({
      success: true,
      message: "DA Master saved successfully.",
      data,
    });
  } catch (error) {
    console.error("POST /api/da-master error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to save DA Master.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const parsed = validatePayload(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.DAMaster WHERE DAId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "DA Master record not found.",
      });
    }

    /* Phase 9 — exact-date duplicate check (existing, excludes self). */
    const dup = await sql.query`
      SELECT TOP 1 DAId
      FROM dbo.DAMaster
      WHERE EffectiveFrom = ${parsed.effectiveFrom}
        AND DAId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message: "DA record already exists for this Effective From Date.",
      });
    }

    /*
     * Phase 9 — same-calendar-month overlap check for PUT (excludes self).
     * If the update moves this record into a month already occupied by another
     * Active record, reject the change.
     */
    const putDate = new Date(parsed.effectiveFrom);
    const putYear = putDate.getFullYear();
    const putMonth = putDate.getMonth() + 1;
    const putMonthOverlap = await sql.query`
      SELECT TOP 1 DAId, EffectiveFrom
      FROM dbo.DAMaster
      WHERE YEAR(EffectiveFrom)  = ${putYear}
        AND MONTH(EffectiveFrom) = ${putMonth}
        AND UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
        AND DAId <> ${id}
    `;
    if (putMonthOverlap.recordset[0]) {
      const existingDate = putMonthOverlap.recordset[0].EffectiveFrom
        ? String(putMonthOverlap.recordset[0].EffectiveFrom).slice(0, 10)
        : "unknown date";
      const monthLabel = putDate.toLocaleString("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      return res.status(409).json({
        success: false,
        message:
          `A DA rate already exists for ${monthLabel} ` +
          `(effective from ${existingDate}). ` +
          `Only one Active DA rate may take effect per calendar month.`,
      });
    }

    const update = await sql.query`
      UPDATE dbo.DAMaster
      SET
        DAName = ${parsed.description},
        DAPercentage = ${parsed.daPercentage},
        EffectiveFrom = ${parsed.effectiveFrom},
        Status = ${parsed.status},
        PayRevisionId = ${parsed.payRevisionId},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE DAId = ${id}
    `;

    res.json({
      success: true,
      message: "DA Master updated successfully.",
      data: mapDa(update.recordset[0]),
    });
  } catch (error) {
    console.error("PUT /api/da-master/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to update DA Master.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await sql.query`
      SELECT TOP 1 DAId FROM dbo.DAMaster WHERE DAId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "DA Master record not found.",
      });
    }

    /* Soft-delete: keep historical rates available for audit; mark Inactive. */
    await sql.query`
      UPDATE dbo.DAMaster
      SET
        Status = N'Inactive',
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actorFromBody(req.body).fullName}
      WHERE DAId = ${id}
    `;

    res.json({
      success: true,
      message: "DA Master deactivated successfully.",
    });
  } catch (error) {
    console.error("DELETE /api/da-master/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to delete DA Master.",
    });
  }
});

module.exports = router;
