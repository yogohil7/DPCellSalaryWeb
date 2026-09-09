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

function mapSection(row) {
  return {
    sectionId: Number(row.SectionId),
    id: Number(row.SectionId),
    srNo: Number(row.SrNo),
    sectionName: row.SectionName,
    status: row.Status,
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

async function countInstitutesUsingSection(sectionId) {
  const result = await sql.query`
    SELECT COUNT(1) AS Cnt
    FROM dbo.Institutes
    WHERE SectionId = ${sectionId}
  `;
  return Number(result.recordset[0]?.Cnt || 0);
}

/* GET /api/sections
   Default: ACTIVE only (dropdown).
   ?all=1 returns ACTIVE + INACTIVE for Section Master list.
*/
router.get("/", async (req, res) => {
  try {
    const includeAll =
      String(req.query.all || "").toLowerCase() === "1" ||
      String(req.query.all || "").toLowerCase() === "true";

    const result = includeAll
      ? await sql.query`
          SELECT *
          FROM dbo.Sections
          ORDER BY SrNo ASC, SectionId ASC
        `
      : await sql.query`
          SELECT *
          FROM dbo.Sections
          WHERE Status = N'ACTIVE'
          ORDER BY SrNo ASC, SectionId ASC
        `;

    res.json({
      message: "OK",
      data: result.recordset.map(mapSection),
    });
  } catch (error) {
    console.error("GET /api/sections error:", error);
    res.status(500).json({
      message: "Unable to load sections.",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT TOP 1 * FROM dbo.Sections WHERE SectionId = ${id}
    `;
    const row = result.recordset[0];
    if (!row) {
      return res.status(404).json({ message: "Section not found." });
    }
    res.json({ message: "OK", data: mapSection(row) });
  } catch (error) {
    console.error("GET /api/sections/:id error:", error);
    res.status(500).json({ message: "Unable to load section.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const srNo = Number(req.body?.srNo);
    const sectionName = String(req.body?.sectionName || "").trim();
    const status = String(req.body?.status || "ACTIVE").toUpperCase();

    if (!Number.isFinite(srNo) || srNo <= 0) {
      return res.status(400).json({ message: "Sr. No. is required." });
    }
    if (!sectionName) {
      return res.status(400).json({ message: "Section Name is required." });
    }
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const dupSr = await sql.query`
      SELECT TOP 1 SectionId FROM dbo.Sections WHERE SrNo = ${srNo}
    `;
    if (dupSr.recordset[0]) {
      return res.status(409).json({ message: "Sr. No. already exists." });
    }

    const dupName = await sql.query`
      SELECT TOP 1 SectionId FROM dbo.Sections WHERE SectionName = ${sectionName}
    `;
    if (dupName.recordset[0]) {
      return res.status(409).json({ message: "Section Name already exists." });
    }

    const insert = await sql.query`
      INSERT INTO dbo.Sections (SrNo, SectionName, Status, CreatedBy)
      OUTPUT INSERTED.*
      VALUES (${srNo}, ${sectionName}, ${status}, ${actor.fullName})
    `;

    res.status(201).json({
      message: "Section saved successfully.",
      data: mapSection(insert.recordset[0]),
    });
  } catch (error) {
    console.error("POST /api/sections error:", error);
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({ message: "Sr. No. or Section Name already exists." });
    }
    res.status(500).json({ message: "Unable to save section.", error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const srNo = Number(req.body?.srNo);
    const sectionName = String(req.body?.sectionName || "").trim();
    const status = String(req.body?.status || "ACTIVE").toUpperCase();

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.Sections WHERE SectionId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Section not found." });
    }

    if (!Number.isFinite(srNo) || srNo <= 0) {
      return res.status(400).json({ message: "Sr. No. is required." });
    }
    if (!sectionName) {
      return res.status(400).json({ message: "Section Name is required." });
    }
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const dupSr = await sql.query`
      SELECT TOP 1 SectionId FROM dbo.Sections
      WHERE SrNo = ${srNo} AND SectionId <> ${id}
    `;
    if (dupSr.recordset[0]) {
      return res.status(409).json({ message: "Sr. No. already exists." });
    }

    const dupName = await sql.query`
      SELECT TOP 1 SectionId FROM dbo.Sections
      WHERE SectionName = ${sectionName} AND SectionId <> ${id}
    `;
    if (dupName.recordset[0]) {
      return res.status(409).json({ message: "Section Name already exists." });
    }

    const updated = await sql.query`
      UPDATE dbo.Sections
      SET
        SrNo = ${srNo},
        SectionName = ${sectionName},
        Status = ${status},
        ModifiedDate = GETDATE(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE SectionId = ${id}
    `;

    res.json({
      message: "Section updated successfully.",
      data: mapSection(updated.recordset[0]),
    });
  } catch (error) {
    console.error("PUT /api/sections/:id error:", error);
    res.status(500).json({ message: "Unable to update section.", error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const status = String(req.body?.status || "").toUpperCase();

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return res.status(400).json({ message: "Status must be ACTIVE or INACTIVE." });
    }

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.Sections WHERE SectionId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Section not found." });
    }

    const updated = await sql.query`
      UPDATE dbo.Sections
      SET
        Status = ${status},
        ModifiedDate = GETDATE(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE SectionId = ${id}
    `;

    res.json({
      message: `Section marked as ${status}.`,
      data: mapSection(updated.recordset[0]),
    });
  } catch (error) {
    console.error("PATCH /api/sections/:id/status error:", error);
    res.status(500).json({ message: "Unable to update section status.", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.Sections WHERE SectionId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Section not found." });
    }

    const used = await countInstitutesUsingSection(id);
    if (used > 0) {
      return res.status(409).json({
        message:
          "Section cannot be deleted because it is already assigned to an institute.",
      });
    }

    await sql.query`
      DELETE FROM dbo.Sections WHERE SectionId = ${id}
    `;

    res.json({ message: "Section deleted successfully." });
  } catch (error) {
    console.error("DELETE /api/sections/:id error:", error);
    res.status(500).json({ message: "Unable to delete section.", error: error.message });
  }
});

module.exports = router;
