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

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  return null;
}

function mapMedicalAllowance(row) {
  return {
    id: Number(row.MedicalAllowanceId),
    medicalAllowanceId: Number(row.MedicalAllowanceId),

    srNo:
      row.SrNo != null
        ? Number(row.SrNo)
        : null,

    allowanceName: row.AllowanceName || "",

    amount:
      row.Amount != null
        ? Number(row.Amount)
        : 0,

    effectiveDate: toDateOnly(row.EffectiveFrom),
    effectiveFrom: toDateOnly(row.EffectiveFrom),
    effectiveTo: toDateOnly(row.EffectiveTo),

    status: normalizeStatus(row.Status),

    payRevisionId:
      row.PayRevisionId != null
        ? Number(row.PayRevisionId)
        : null,

    designationId:
      row.DesignationId != null
        ? Number(row.DesignationId)
        : null,

    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,

    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

function validatePayload(body) {
  const effectiveFrom = toDateOnly(
    body.effectiveDate || body.effectiveFrom
  );

  const allowanceName = String(
    body.allowanceName ||
      body.description ||
      "Medical Allowance"
  ).trim();

  const amount = Number(body.amount);

  const status = normalizeStatus(body.status);

  const payRevisionId =
    body.payRevisionId != null &&
    body.payRevisionId !== ""
      ? Number(body.payRevisionId)
      : null;

  const designationId =
    body.designationId != null &&
    body.designationId !== ""
      ? Number(body.designationId)
      : null;

  if (!effectiveFrom) {
    return {
      error: "Effective From Date is required.",
    };
  }

  if (!Number.isFinite(amount)) {
    return {
      error: "Medical Allowance Amount is required and must be numeric.",
    };
  }

  if (amount < 0) {
    return {
      error: "Medical Allowance Amount cannot be negative.",
    };
  }

  if (!status) {
    return {
      error: "Status is required.",
    };
  }

  return {
    effectiveFrom,
    allowanceName:
      allowanceName || "Medical Allowance",

    amount,
    status,

    payRevisionId:
      Number.isFinite(payRevisionId) && payRevisionId > 0
        ? payRevisionId
        : null,

    designationId:
      Number.isFinite(designationId) && designationId > 0
        ? designationId
        : null,
  };
}


/* =========================================================
   GET /api/medical-allowance-master
   ========================================================= */

router.get("/", async (req, res) => {
  try {
    const effectiveDate = toDateOnly(
      req.query.effectiveDate
    );

    const status = String(
      req.query.status || "All"
    ).trim();

    const amount =
      req.query.amount != null &&
      String(req.query.amount).trim() !== ""
        ? Number(req.query.amount)
        : null;

    let result;

    if (
      effectiveDate ||
      status !== "All" ||
      Number.isFinite(amount)
    ) {
      result = await sql.query`
        SELECT *
        FROM dbo.MedicalAllowanceMaster
        WHERE
          (${effectiveDate} IS NULL
            OR EffectiveFrom = ${effectiveDate})

          AND
          (
            ${status} = N'All'
            OR UPPER(ISNULL(Status, N'Active'))
               = UPPER(${status})
          )

          AND
          (
            ${amount} IS NULL
            OR Amount = ${amount}
          )

        ORDER BY
          EffectiveFrom DESC,
          MedicalAllowanceId DESC
      `;
    } else {
      result = await sql.query`
        SELECT *
        FROM dbo.MedicalAllowanceMaster

        ORDER BY
          EffectiveFrom DESC,
          MedicalAllowanceId DESC
      `;
    }

    res.json({
      success: true,
      message: "OK",
      data: result.recordset.map(
        mapMedicalAllowance
      ),
    });

  } catch (error) {
    console.error(
      "GET /api/medical-allowance-master error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to load Medical Allowance Master.",
    });
  }
});


/* =========================================================
   GET /api/medical-allowance-master/:id
   ========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid MedicalAllowanceId.",
      });
    }

    const result = await sql.query`
      SELECT TOP 1 *
      FROM dbo.MedicalAllowanceMaster
      WHERE MedicalAllowanceId = ${id}
    `;

    if (!result.recordset[0]) {
      return res.status(404).json({
        success: false,
        message:
          "Medical Allowance Master record not found.",
      });
    }

    res.json({
      success: true,
      message: "OK",
      data: mapMedicalAllowance(
        result.recordset[0]
      ),
    });

  } catch (error) {
    console.error(
      "GET /api/medical-allowance-master/:id error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to load Medical Allowance Master.",
    });
  }
});


/* =========================================================
   POST /api/medical-allowance-master
   ========================================================= */

router.post("/", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);

    const parsed = validatePayload(req.body);

    if (parsed.error) {
      return res.status(400).json({
        success: false,
        message: parsed.error,
      });
    }


    /* Prevent duplicate Effective From date */

    const dup = await sql.query`
      SELECT TOP 1 MedicalAllowanceId
      FROM dbo.MedicalAllowanceMaster
      WHERE EffectiveFrom = ${parsed.effectiveFrom}
    `;

    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message:
          "Medical Allowance record already exists for this Effective From Date.",
      });
    }


    /* Generate next SrNo */

    const sr = await sql.query`
      SELECT
        ISNULL(MAX(SrNo), 0) + 1 AS NextSr
      FROM dbo.MedicalAllowanceMaster
    `;

    const srNo = Number(
      sr.recordset[0]?.NextSr || 1
    );


    /* Insert */

    const insert = await sql.query`
      INSERT INTO dbo.MedicalAllowanceMaster
      (
        SrNo,
        AllowanceName,
        Amount,
        EffectiveFrom,
        EffectiveTo,
        Status,
        CreatedBy,
        PayRevisionId,
        DesignationId
      )

      OUTPUT INSERTED.*

      VALUES
      (
        ${srNo},
        ${parsed.allowanceName},
        ${parsed.amount},
        ${parsed.effectiveFrom},
        NULL,
        ${parsed.status},
        ${actor.fullName},
        ${parsed.payRevisionId},
        ${parsed.designationId}
      )
    `;

    const data =
      mapMedicalAllowance(
        insert.recordset[0]
      );

    res.status(201).json({
      success: true,
      message:
        "Medical Allowance Master saved successfully.",
      data,
    });

  } catch (error) {
    console.error(
      "POST /api/medical-allowance-master error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to save Medical Allowance Master.",
    });
  }
});


/* =========================================================
   PUT /api/medical-allowance-master/:id
   ========================================================= */

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const actor = actorFromBody(req.body);

    const parsed = validatePayload(req.body);

    if (parsed.error) {
      return res.status(400).json({
        success: false,
        message: parsed.error,
      });
    }


    const current = await sql.query`
      SELECT TOP 1 *
      FROM dbo.MedicalAllowanceMaster
      WHERE MedicalAllowanceId = ${id}
    `;

    if (!current.recordset[0]) {
      return res.status(404).json({
        success: false,
        message:
          "Medical Allowance Master record not found.",
      });
    }


    /* Prevent duplicate Effective From date */

    const dup = await sql.query`
      SELECT TOP 1 MedicalAllowanceId
      FROM dbo.MedicalAllowanceMaster
      WHERE
        EffectiveFrom = ${parsed.effectiveFrom}
        AND MedicalAllowanceId <> ${id}
    `;

    if (dup.recordset[0]) {
      return res.status(409).json({
        success: false,
        message:
          "Medical Allowance record already exists for this Effective From Date.",
      });
    }


    const update = await sql.query`
      UPDATE dbo.MedicalAllowanceMaster

      SET
        AllowanceName = ${parsed.allowanceName},
        Amount = ${parsed.amount},
        EffectiveFrom = ${parsed.effectiveFrom},
        Status = ${parsed.status},
        PayRevisionId = ${parsed.payRevisionId},
        DesignationId = ${parsed.designationId},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}

      OUTPUT INSERTED.*

      WHERE MedicalAllowanceId = ${id}
    `;

    res.json({
      success: true,
      message:
        "Medical Allowance Master updated successfully.",
      data: mapMedicalAllowance(
        update.recordset[0]
      ),
    });

  } catch (error) {
    console.error(
      "PUT /api/medical-allowance-master/:id error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to update Medical Allowance Master.",
    });
  }
});


/* =========================================================
   DELETE /api/medical-allowance-master/:id
   ========================================================= */

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const current = await sql.query`
      SELECT TOP 1 MedicalAllowanceId
      FROM dbo.MedicalAllowanceMaster
      WHERE MedicalAllowanceId = ${id}
    `;

    if (!current.recordset[0]) {
      return res.status(404).json({
        success: false,
        message:
          "Medical Allowance Master record not found.",
      });
    }


    /* Soft delete */

    await sql.query`
      UPDATE dbo.MedicalAllowanceMaster

      SET
        Status = N'Inactive',
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actorFromBody(req.body).fullName}

      WHERE MedicalAllowanceId = ${id}
    `;

    res.json({
      success: true,
      message:
        "Medical Allowance Master deactivated successfully.",
    });

  } catch (error) {
    console.error(
      "DELETE /api/medical-allowance-master/:id error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to delete Medical Allowance Master.",
    });
  }
});


module.exports = router;