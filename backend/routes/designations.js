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
  if (raw === "INACTIVE" || raw === "0" || raw === "FALSE") return "Inactive";
  return "Active";
}

function mapDesignation(row) {
  return {
    designationId: Number(row.DesignationId),
    id: Number(row.DesignationId),
    designationCode: row.DesignationCode || "",
    designationName: row.DesignationName || "",
    designationType: row.DesignationType || "",
    employeeClass: row.EmployeeClass || "",
    status: normalizeStatus(row.Status),
    isActive: row.IsActive == null ? normalizeStatus(row.Status) === "Active" : Boolean(row.IsActive),
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

/* GET /api/designations
   Default: Active only (Employee Master dropdown).
   ?all=1 returns Active + Inactive for Designation Master list.
*/
router.get("/", async (req, res) => {
  try {
    const includeAll =
      String(req.query.all || "").toLowerCase() === "1" ||
      String(req.query.all || "").toLowerCase() === "true";

    const result = includeAll
      ? await sql.query`
          SELECT *
          FROM dbo.Designations
          ORDER BY DesignationName ASC, DesignationId ASC
        `
      : await sql.query`
          SELECT *
          FROM dbo.Designations
          WHERE UPPER(LTRIM(RTRIM(Status))) = N'ACTIVE'
             OR IsActive = 1
          ORDER BY DesignationName ASC, DesignationId ASC
        `;

    const data = result.recordset
      .map(mapDesignation)
      .filter((row) => (includeAll ? true : row.status === "Active"));

    res.json({ message: "OK", data });
  } catch (error) {
    console.error("GET /api/designations error:", error);
    res.status(500).json({
      message: "Unable to load designations.",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT TOP 1 * FROM dbo.Designations WHERE DesignationId = ${id}
    `;
    const row = result.recordset[0];
    if (!row) {
      return res.status(404).json({ message: "Designation not found." });
    }
    res.json({ message: "OK", data: mapDesignation(row) });
  } catch (error) {
    console.error("GET /api/designations/:id error:", error);
    res.status(500).json({
      message: "Unable to load designation.",
      error: error.message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const designationCode = String(req.body?.designationCode || "")
      .trim()
      .toUpperCase();
    const designationName = String(req.body?.designationName || "").trim();
    const designationType = String(req.body?.designationType || "").trim();
    const employeeClass = String(req.body?.employeeClass || "").trim();
    const status = normalizeStatus(req.body?.status);
    const isActive = status === "Active" ? 1 : 0;

    if (!designationCode) {
      return res.status(400).json({ message: "Designation Code is required." });
    }
    if (!designationName) {
      return res.status(400).json({ message: "Designation Name is required." });
    }
    if (!designationType) {
      return res.status(400).json({ message: "Designation Type is required." });
    }
    if (!employeeClass) {
      return res.status(400).json({ message: "Employee Class is required." });
    }

    const dup = await sql.query`
      SELECT TOP 1 DesignationId
      FROM dbo.Designations
      WHERE DesignationCode = ${designationCode}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Designation Code already exists." });
    }

    const insert = await sql.query`
      INSERT INTO dbo.Designations (
        DesignationCode, DesignationName, DesignationType, EmployeeClass,
        Status, IsActive, CreatedBy
      )
      OUTPUT INSERTED.*
      VALUES (
        ${designationCode},
        ${designationName},
        ${designationType},
        ${employeeClass},
        ${status},
        ${isActive},
        ${actor.fullName}
      )
    `;

    res.status(201).json({
      message: "Designation saved successfully.",
      data: mapDesignation(insert.recordset[0]),
    });
  } catch (error) {
    console.error("POST /api/designations error:", error);
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({ message: "Designation Code already exists." });
    }
    res.status(500).json({
      message: "Unable to save designation.",
      error: error.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const designationCode = String(req.body?.designationCode || "")
      .trim()
      .toUpperCase();
    const designationName = String(req.body?.designationName || "").trim();
    const designationType = String(req.body?.designationType || "").trim();
    const employeeClass = String(req.body?.employeeClass || "").trim();
    const status = normalizeStatus(req.body?.status);
    const isActive = status === "Active" ? 1 : 0;

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.Designations WHERE DesignationId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Designation not found." });
    }

    if (!designationCode || !designationName || !designationType || !employeeClass) {
      return res.status(400).json({ message: "Please fill all required fields." });
    }

    const dup = await sql.query`
      SELECT TOP 1 DesignationId
      FROM dbo.Designations
      WHERE DesignationCode = ${designationCode}
        AND DesignationId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Designation Code already exists." });
    }

    const updated = await sql.query`
      UPDATE dbo.Designations
      SET
        DesignationCode = ${designationCode},
        DesignationName = ${designationName},
        DesignationType = ${designationType},
        EmployeeClass = ${employeeClass},
        Status = ${status},
        IsActive = ${isActive},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE DesignationId = ${id}
    `;

    res.json({
      message: "Designation updated successfully.",
      data: mapDesignation(updated.recordset[0]),
    });
  } catch (error) {
    console.error("PUT /api/designations/:id error:", error);
    res.status(500).json({
      message: "Unable to update designation.",
      error: error.message,
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.Designations WHERE DesignationId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({ message: "Designation not found." });
    }

    await sql.query`
      DELETE FROM dbo.Designations WHERE DesignationId = ${id}
    `;

    res.json({ message: "Designation deleted successfully." });
  } catch (error) {
    console.error("DELETE /api/designations/:id error:", error);
    res.status(500).json({
      message: "Unable to delete designation.",
      error: error.message,
    });
  }
});

module.exports = router;
