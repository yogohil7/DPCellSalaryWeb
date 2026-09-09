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

function mapHra(row) {
  return {
    id: Number(row.HRAId),
    hraId: Number(row.HRAId),
    effectiveDate: toDateOnly(row.EffectiveFrom || row.EffectiveDate),
    effectiveFrom: toDateOnly(row.EffectiveFrom || row.EffectiveDate),
    effectiveTo: toDateOnly(row.EffectiveTo),
    cityClass: row.CityClass || "",
    cityClassId: row.CityClassId != null ? Number(row.CityClassId) : null,
    hraPercentage: Number(row.HRAPercentage),
    description: row.Description || "",
    status: normalizeStatus(row.Status),
    payRevisionId:
      row.PayRevisionId != null ? Number(row.PayRevisionId) : null,
    isPreviousLocation: Boolean(row.IsPreviousLocation),
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

async function resolveCityClass(body) {
  let cityClassId =
    body.cityClassId != null && body.cityClassId !== ""
      ? Number(body.cityClassId)
      : null;
  let cityClass = String(body.cityClass || "").trim();

  if (Number.isFinite(cityClassId) && cityClassId > 0) {
    const byId = await sql.query`
      SELECT TOP 1 CityClassId, CityClassName
      FROM dbo.CityClasses
      WHERE CityClassId = ${cityClassId}
    `;
    if (!byId.recordset[0]) {
      return { error: "Selected City Class was not found." };
    }
    return {
      cityClassId: Number(byId.recordset[0].CityClassId),
      cityClass: String(byId.recordset[0].CityClassName || "").trim(),
    };
  }

  if (!cityClass) {
    return { error: "City Class is required." };
  }

  const byName = await sql.query`
    SELECT TOP 1 CityClassId, CityClassName
    FROM dbo.CityClasses
    WHERE CityClassName = ${cityClass}
       OR CityClassName = UPPER(${cityClass})
  `;
  if (!byName.recordset[0]) {
    return {
      error: `City Class "${cityClass}" was not found in City Classes master.`,
    };
  }
  return {
    cityClassId: Number(byName.recordset[0].CityClassId),
    cityClass: String(byName.recordset[0].CityClassName || "").trim(),
  };
}

function validatePercentage(body) {
  const effectiveDate = toDateOnly(body.effectiveDate || body.effectiveFrom);
  const hraPercentage = Number(body.hraPercentage);
  const description = String(body.description || "").trim();
  const status = normalizeStatus(body.status);

  if (!effectiveDate) {
    return { error: "Effective From Date is required." };
  }
  if (!Number.isFinite(hraPercentage)) {
    return { error: "HRA Percentage is required and must be numeric." };
  }
  if (hraPercentage < 0 || hraPercentage > 100) {
    return { error: "HRA Percentage must be between 0 and 100." };
  }
  if (!status) {
    return { error: "Status is required." };
  }

  return { effectiveDate, hraPercentage, description, status };
}

/* GET /api/hra-master/city-classes */
router.get("/city-classes", async (_req, res) => {
  try {
    const result = await sql.query`
      SELECT CityClassId, CityClassName, Status
      FROM dbo.CityClasses
      WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
         OR ISNULL(IsActive, 1) = 1
      ORDER BY SrNo, CityClassName
    `;
    res.json({
      success: true,
      message: "OK",
      data: result.recordset.map((r) => ({
        cityClassId: Number(r.CityClassId),
        cityClass: r.CityClassName,
        status: r.Status,
      })),
    });
  } catch (error) {
    console.error("GET /api/hra-master/city-classes error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load City Classes.",
    });
  }
});

/* GET /api/hra-master */
router.get("/", async (req, res) => {
  try {
    const effectiveDate = toDateOnly(req.query.effectiveDate);
    const cityClass = String(req.query.cityClass || "").trim();
    const status = String(req.query.status || "All").trim();

    const result = await sql.query`
      SELECT *
      FROM dbo.HRAMaster
      WHERE (${effectiveDate} IS NULL OR ISNULL(EffectiveFrom, EffectiveDate) = ${effectiveDate})
        AND (${cityClass} = N'' OR CityClass = ${cityClass})
        AND (${status} = N'All' OR UPPER(ISNULL(Status, N'Active')) = UPPER(${status}))
      ORDER BY ISNULL(EffectiveFrom, EffectiveDate) DESC, HRAId DESC
    `;

    res.json({
      success: true,
      message: "OK",
      data: result.recordset.map(mapHra),
    });
  } catch (error) {
    console.error("GET /api/hra-master error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load HRA Master.",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await sql.query`
      SELECT TOP 1 * FROM dbo.HRAMaster WHERE HRAId = ${id}
    `;
    if (!result.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "HRA Master record not found.",
      });
    }
    res.json({
      success: true,
      message: "OK",
      data: mapHra(result.recordset[0]),
    });
  } catch (error) {
    console.error("GET /api/hra-master/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load HRA Master.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const parsed = validatePercentage(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const city = await resolveCityClass(req.body);
    if (city.error) {
      return res.status(400).json({ success: false, message: city.error });
    }

    const dup = await sql.query`
      SELECT TOP 1 HRAId
      FROM dbo.HRAMaster
      WHERE ISNULL(EffectiveFrom, EffectiveDate) = ${parsed.effectiveDate}
        AND CityClass = ${city.cityClass}
        AND ISNULL(IsPreviousLocation, 0) = 0
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message:
          "HRA record already exists for this Effective From Date and City Class.",
      });
    }

    const insert = await sql.query`
      INSERT INTO dbo.HRAMaster
        (
          EffectiveDate, CityClass, HRAPercentage, Description, Status,
          CreatedBy, CityClassId, EffectiveFrom, EffectiveTo, IsPreviousLocation
        )
      OUTPUT INSERTED.*
      VALUES
        (
          ${parsed.effectiveDate},
          ${city.cityClass},
          ${parsed.hraPercentage},
          ${parsed.description || null},
          ${parsed.status},
          ${actor.fullName},
          ${city.cityClassId},
          ${parsed.effectiveDate},
          NULL,
          0
        )
    `;

    res.status(201).json({
      success: true,
      message: "HRA Master saved successfully.",
      data: mapHra(insert.recordset[0]),
    });
  } catch (error) {
    console.error("POST /api/hra-master error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to save HRA Master.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const parsed = validatePercentage(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const city = await resolveCityClass(req.body);
    if (city.error) {
      return res.status(400).json({ success: false, message: city.error });
    }

    const current = await sql.query`
      SELECT TOP 1 * FROM dbo.HRAMaster WHERE HRAId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "HRA Master record not found.",
      });
    }

    const dup = await sql.query`
      SELECT TOP 1 HRAId
      FROM dbo.HRAMaster
      WHERE ISNULL(EffectiveFrom, EffectiveDate) = ${parsed.effectiveDate}
        AND CityClass = ${city.cityClass}
        AND ISNULL(IsPreviousLocation, 0) = 0
        AND HRAId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message:
          "HRA record already exists for this Effective From Date and City Class.",
      });
    }

    const update = await sql.query`
      UPDATE dbo.HRAMaster
      SET
        EffectiveDate = ${parsed.effectiveDate},
        EffectiveFrom = ${parsed.effectiveDate},
        CityClass = ${city.cityClass},
        CityClassId = ${city.cityClassId},
        HRAPercentage = ${parsed.hraPercentage},
        Description = ${parsed.description || null},
        Status = ${parsed.status},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE HRAId = ${id}
    `;

    res.json({
      success: true,
      message: "HRA Master updated successfully.",
      data: mapHra(update.recordset[0]),
    });
  } catch (error) {
    console.error("PUT /api/hra-master/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to update HRA Master.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await sql.query`
      SELECT TOP 1 HRAId FROM dbo.HRAMaster WHERE HRAId = ${id}
    `;
    if (!current.recordset[0]) {
      return res.status(404).json({
        success: false,
        message: "HRA Master record not found.",
      });
    }

    await sql.query`
      UPDATE dbo.HRAMaster
      SET
        Status = N'Inactive',
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actorFromBody(req.body).fullName}
      WHERE HRAId = ${id}
    `;

    res.json({
      success: true,
      message: "HRA Master deactivated successfully.",
    });
  } catch (error) {
    console.error("DELETE /api/hra-master/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to delete HRA Master.",
    });
  }
});

module.exports = router;
