const express = require("express");
const { sql } = require("../db");

const router = express.Router();

function mapDistrict(row) {
  return {
    districtId: Number(row.DistrictId),
    id: Number(row.DistrictId),
    srNo: row.SrNo != null ? Number(row.SrNo) : null,
    districtName: String(row.DistrictName || "").trim(),
    status: row.Status || (row.IsActive === false || row.IsActive === 0 ? "Inactive" : "Active"),
    isActive:
      row.IsActive == null
        ? String(row.Status || "Active").toUpperCase() === "ACTIVE"
        : Boolean(row.IsActive),
  };
}

/* GET /api/districts — Active districts for dropdowns (default).
   ?all=1 includes inactive. */
router.get("/", async (req, res) => {
  try {
    const includeAll =
      String(req.query.all || "").toLowerCase() === "1" ||
      String(req.query.all || "").toLowerCase() === "true";

    const result = includeAll
      ? await sql.query`
          SELECT DistrictId, SrNo, DistrictName, Status, IsActive
          FROM dbo.Districts
          ORDER BY DistrictName ASC, DistrictId ASC
        `
      : await sql.query`
          SELECT DistrictId, SrNo, DistrictName, Status, IsActive
          FROM dbo.Districts
          WHERE UPPER(ISNULL(Status, N'Active')) = N'ACTIVE'
            AND ISNULL(IsActive, 1) = 1
          ORDER BY DistrictName ASC, DistrictId ASC
        `;

    res.json({
      message: "OK",
      data: result.recordset.map(mapDistrict).filter((d) => d.districtName),
    });
  } catch (error) {
    console.error("GET /api/districts error:", error);
    res.status(500).json({
      message: "Unable to load districts.",
      error: error.message,
    });
  }
});

module.exports = router;
