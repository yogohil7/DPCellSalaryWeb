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

function asPositiveId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapInstitute(row) {
  const districtId = asPositiveId(row.DistrictId);
  const cityClassId = asPositiveId(row.CityClassId);
  const districtName = String(
    row.DistrictName ||
      row.ResolvedDistrictName ||
      row.InstituteDistrict ||
      row.District ||
      ""
  ).trim();
  /* Never surface numeric districtId as the display name. */
  const safeDistrictName =
    districtName && districtName !== "0" ? districtName : "";

  return {
    instituteId: Number(row.InstituteId),
    id: Number(row.InstituteId),
    sectionId: row.SectionId != null ? Number(row.SectionId) : null,
    instituteType: row.SectionName || "",
    sectionName: row.SectionName || "",
    instituteCode: row.InstituteCode,
    instituteName: row.InstituteName,
    instituteDistrict: safeDistrictName,
    districtId,
    districtName: safeDistrictName,
    cityClassId,
    cityClass: row.CityClassName || row.CityClass || "",
    cityClassName: row.CityClassName || row.CityClass || "",
    instituteAddress: row.InstituteAddress || "",
    bankAccountNumber: row.BankAccountNumber || "",
    status: row.Status || "Active",
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

const instituteSelect = `
  SELECT
    i.*,
    s.SectionName,
    COALESCE(
      NULLIF(LTRIM(RTRIM(d.DistrictName)), N''),
      NULLIF(LTRIM(RTRIM(i.InstituteDistrict)), N''),
      NULLIF(LTRIM(RTRIM(i.District)), N''),
      dn.DistrictName
    ) AS DistrictName,
    COALESCE(cc.CityClassName, i.CityClass) AS CityClassName
  FROM dbo.Institutes i
  LEFT JOIN dbo.Sections s ON s.SectionId = i.SectionId
  LEFT JOIN dbo.Districts d ON d.DistrictId = i.DistrictId AND i.DistrictId > 0
  LEFT JOIN dbo.Districts dn
    ON i.DistrictId IS NULL
    AND UPPER(LTRIM(RTRIM(dn.DistrictName))) = UPPER(LTRIM(RTRIM(
         COALESCE(NULLIF(i.InstituteDistrict, N''), NULLIF(i.District, N''))
       )))
  LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = i.CityClassId AND i.CityClassId > 0
`;

async function getSectionById(sectionId) {
  const result = await sql.query`
    SELECT TOP 1 * FROM dbo.Sections WHERE SectionId = ${sectionId}
  `;
  return result.recordset[0] || null;
}

async function resolveDistrictId(districtName, districtIdHint) {
  const hint = asPositiveId(districtIdHint);
  if (hint) {
    const byId = await sql.query`
      SELECT TOP 1 DistrictId, DistrictName
      FROM dbo.Districts
      WHERE DistrictId = ${hint}
    `;
    if (byId.recordset[0]) {
      return {
        districtId: Number(byId.recordset[0].DistrictId),
        districtName: String(byId.recordset[0].DistrictName || "").trim(),
      };
    }
  }

  const name = String(districtName || "").trim();
  if (!name || name === "0") {
    return { districtId: null, districtName: "" };
  }

  const byName = await sql.query`
    SELECT TOP 1 DistrictId, DistrictName
    FROM dbo.Districts
    WHERE UPPER(LTRIM(RTRIM(DistrictName))) = ${name.toUpperCase()}
  `;
  if (byName.recordset[0]) {
    return {
      districtId: Number(byName.recordset[0].DistrictId),
      districtName: String(byName.recordset[0].DistrictName || name).trim(),
    };
  }

  return { districtId: null, districtName: name };
}

async function resolveCityClassId(cityClassName, cityClassIdHint) {
  const hint = asPositiveId(cityClassIdHint);
  if (hint) {
    const byId = await sql.query`
      SELECT TOP 1 CityClassId, CityClassName
      FROM dbo.CityClasses
      WHERE CityClassId = ${hint}
    `;
    if (byId.recordset[0]) {
      return {
        cityClassId: Number(byId.recordset[0].CityClassId),
        cityClass: String(byId.recordset[0].CityClassName || "").trim(),
      };
    }
  }

  const name = String(cityClassName || "").trim();
  if (!name) {
    return { cityClassId: null, cityClass: "" };
  }

  const byName = await sql.query`
    SELECT TOP 1 CityClassId, CityClassName
    FROM dbo.CityClasses
    WHERE UPPER(LTRIM(RTRIM(CityClassName))) = ${name.toUpperCase()}
  `;
  if (byName.recordset[0]) {
    return {
      cityClassId: Number(byName.recordset[0].CityClassId),
      cityClass: String(byName.recordset[0].CityClassName || name).trim(),
    };
  }

  return { cityClassId: null, cityClass: name };
}

async function loadInstituteById(id) {
  const result = await new sql.Request().query(`
    ${instituteSelect}
    WHERE i.InstituteId = ${Number(id)}
  `);
  return result.recordset[0] || null;
}

router.get("/", async (_req, res) => {
  try {
    const result = await new sql.Request().query(`
      ${instituteSelect}
      ORDER BY i.InstituteId DESC
    `);
    res.json({
      message: "OK",
      data: result.recordset.map(mapInstitute),
    });
  } catch (error) {
    console.error("GET /api/institutes error:", error);
    res.status(500).json({
      message: "Unable to load institutes.",
      error: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await loadInstituteById(id);
    if (!row) {
      return res.status(404).json({ message: "Institute not found." });
    }
    res.json({ message: "OK", data: mapInstitute(row) });
  } catch (error) {
    console.error("GET /api/institutes/:id error:", error);
    res.status(500).json({ message: "Unable to load institute.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const sectionId = Number(req.body?.sectionId);
    const instituteCode = String(req.body?.instituteCode || "").trim();
    const instituteName = String(req.body?.instituteName || "").trim();
    const instituteDistrictRaw = String(req.body?.instituteDistrict || "").trim();
    const cityClassRaw = String(req.body?.cityClass || "").trim();
    const instituteAddress = String(req.body?.instituteAddress || "").trim();
    const bankAccountNumber = String(req.body?.bankAccountNumber || "").trim();
    const status = String(req.body?.status || "Active");

    if (!sectionId) {
      return res.status(400).json({ message: "Please select Institute Type." });
    }
    if (!instituteCode) {
      return res.status(400).json({ message: "Institute Code is required." });
    }
    if (!instituteName) {
      return res.status(400).json({ message: "Institute Name is required." });
    }
    if (!instituteDistrictRaw) {
      return res.status(400).json({ message: "Institute District is required." });
    }
    if (!cityClassRaw) {
      return res.status(400).json({ message: "City Class is required." });
    }
    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const section = await getSectionById(sectionId);
    if (!section) {
      return res.status(400).json({ message: "Selected Institute Type is invalid." });
    }
    if (String(section.Status).toUpperCase() !== "ACTIVE") {
      return res.status(400).json({ message: "Selected Institute Type is inactive." });
    }

    const district = await resolveDistrictId(
      instituteDistrictRaw,
      req.body?.districtId
    );
    if (!district.districtId) {
      return res.status(400).json({
        message: `District "${instituteDistrictRaw}" was not found in District master.`,
      });
    }

    const city = await resolveCityClassId(cityClassRaw, req.body?.cityClassId);
    if (!city.cityClassId) {
      return res.status(400).json({
        message: `City Class "${cityClassRaw}" was not found in City Class master.`,
      });
    }

    const dup = await sql.query`
      SELECT TOP 1 InstituteId FROM dbo.Institutes WHERE InstituteCode = ${instituteCode}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Institute Code already exists." });
    }

    const insert = await sql.query`
      INSERT INTO dbo.Institutes
        (
          SectionId, InstituteCode, InstituteName, InstituteDistrict, District,
          DistrictId, CityClass, CityClassId,
          InstituteAddress, BankAccountNumber, Status, CreatedBy
        )
      OUTPUT INSERTED.*
      VALUES
        (
          ${sectionId},
          ${instituteCode},
          ${instituteName},
          ${district.districtName},
          ${district.districtName},
          ${district.districtId},
          ${city.cityClass},
          ${city.cityClassId},
          ${instituteAddress},
          ${bankAccountNumber},
          ${status},
          ${actor.fullName}
        )
    `;

    const created = insert.recordset[0];
    const row = await loadInstituteById(created.InstituteId);

    res.status(201).json({
      message: "Institute saved successfully.",
      data: mapInstitute(row),
    });
  } catch (error) {
    console.error("POST /api/institutes error:", error);
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({ message: "Institute Code already exists." });
    }
    res.status(500).json({ message: "Unable to save institute.", error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const sectionId = Number(req.body?.sectionId);
    const instituteCode = String(req.body?.instituteCode || "").trim();
    const instituteName = String(req.body?.instituteName || "").trim();
    const instituteDistrictRaw = String(req.body?.instituteDistrict || "").trim();
    const cityClassRaw = String(req.body?.cityClass || "").trim();
    const instituteAddress = String(req.body?.instituteAddress || "").trim();
    const bankAccountNumber = String(req.body?.bankAccountNumber || "").trim();
    const status = String(req.body?.status || "Active");

    const existing = await sql.query`
      SELECT TOP 1 * FROM dbo.Institutes WHERE InstituteId = ${id}
    `;
    if (!existing.recordset[0]) {
      return res.status(404).json({ message: "Institute not found." });
    }

    if (!sectionId) {
      return res.status(400).json({ message: "Please select Institute Type." });
    }
    if (!instituteCode || !instituteName || !instituteDistrictRaw || !cityClassRaw) {
      return res.status(400).json({ message: "Please fill all required fields." });
    }

    const section = await getSectionById(sectionId);
    if (!section) {
      return res.status(400).json({ message: "Selected Institute Type is invalid." });
    }

    const currentSectionId = Number(existing.recordset[0].SectionId);
    if (
      sectionId !== currentSectionId &&
      String(section.Status).toUpperCase() !== "ACTIVE"
    ) {
      return res.status(400).json({ message: "Selected Institute Type is inactive." });
    }

    const district = await resolveDistrictId(
      instituteDistrictRaw,
      req.body?.districtId
    );
    if (!district.districtId) {
      return res.status(400).json({
        message: `District "${instituteDistrictRaw}" was not found in District master.`,
      });
    }

    const city = await resolveCityClassId(cityClassRaw, req.body?.cityClassId);
    if (!city.cityClassId) {
      return res.status(400).json({
        message: `City Class "${cityClassRaw}" was not found in City Class master.`,
      });
    }

    const dup = await sql.query`
      SELECT TOP 1 InstituteId FROM dbo.Institutes
      WHERE InstituteCode = ${instituteCode} AND InstituteId <> ${id}
    `;
    if (dup.recordset[0]) {
      return res.status(409).json({ message: "Institute Code already exists." });
    }

    await sql.query`
      UPDATE dbo.Institutes
      SET
        SectionId = ${sectionId},
        InstituteCode = ${instituteCode},
        InstituteName = ${instituteName},
        InstituteDistrict = ${district.districtName},
        District = ${district.districtName},
        DistrictId = ${district.districtId},
        CityClass = ${city.cityClass},
        CityClassId = ${city.cityClassId},
        InstituteAddress = ${instituteAddress},
        BankAccountNumber = ${bankAccountNumber},
        Status = ${status},
        ModifiedDate = GETDATE(),
        ModifiedBy = ${actor.fullName}
      WHERE InstituteId = ${id}
    `;

    const row = await loadInstituteById(id);

    res.json({
      message: "Institute updated successfully.",
      data: mapInstitute(row),
    });
  } catch (error) {
    console.error("PUT /api/institutes/:id error:", error);
    res.status(500).json({ message: "Unable to update institute.", error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await sql.query`
      SELECT TOP 1 InstituteId FROM dbo.Institutes WHERE InstituteId = ${id}
    `;
    if (!existing.recordset[0]) {
      return res.status(404).json({ message: "Institute not found." });
    }

    await sql.query`
      DELETE FROM dbo.Institutes WHERE InstituteId = ${id}
    `;

    res.json({ message: "Institute deleted successfully." });
  } catch (error) {
    console.error("DELETE /api/institutes/:id error:", error);
    res.status(500).json({ message: "Unable to delete institute.", error: error.message });
  }
});

module.exports = router;
