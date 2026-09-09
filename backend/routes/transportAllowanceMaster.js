const express = require("express");
const { sql } = require("../db");

const router = express.Router();

const ALLOWED_PAY_LEVEL_GROUPS = [
    "Level 2 and Below",
    "Level 3-8",
    "Level 9 and Above",
];

/* =========================================================
   HELPERS
========================================================= */

function normalizeStatus(value) {
    const status = String(value || "Active").trim();

    return status.toLowerCase() === "inactive"
        ? "Inactive"
        : "Active";
}

function normalizeDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    const valueString = String(value);

    if (/^\d{4}-\d{2}-\d{2}/.test(valueString)) {
        return valueString.substring(0, 10);
    }

    return null;
}

function mapRecord(row) {
    return {
        id: row.TransportAllowanceId,

        transportAllowanceId:
            row.TransportAllowanceId,

        effectiveDate:
            normalizeDate(row.EffectiveDate),

        payLevelGroup:
            row.PayLevelGroup || "",

        cityClass:
            row.CityClass || "",

        taAmount:
            row.TAAmount != null
                ? Number(row.TAAmount)
                : "",

        description:
            row.Description || "",

        status:
            normalizeStatus(row.Status),

        createdDate:
            row.CreatedDate,

        createdBy:
            row.CreatedBy,

        modifiedDate:
            row.ModifiedDate,

        modifiedBy:
            row.ModifiedBy
    };
}


/* =========================================================
   GET ALL (optional filters)
========================================================= */

router.get("/", async (req, res) => {

    try {
        const effectiveDate = normalizeDate(req.query.effectiveDate);
        const payLevelGroup = String(req.query.payLevelGroup || "").trim();
        const cityClass = String(req.query.cityClass || "").trim();
        const taAmount =
            req.query.taAmount != null && String(req.query.taAmount).trim() !== ""
                ? Number(req.query.taAmount)
                : null;
        const status = String(req.query.status || "All").trim();

        const result = await sql.query`
            SELECT
                TransportAllowanceId,
                EffectiveDate,
                PayLevelGroup,
                CityClass,
                TAAmount,
                Description,
                Status,
                CreatedDate,
                CreatedBy,
                ModifiedDate,
                ModifiedBy
            FROM dbo.TransportAllowanceMaster
            WHERE (${effectiveDate} IS NULL OR EffectiveDate = ${effectiveDate})
              AND (${payLevelGroup} = N'' OR PayLevelGroup = ${payLevelGroup})
              AND (${cityClass} = N'' OR CityClass = ${cityClass})
              AND (${taAmount} IS NULL OR TAAmount = ${taAmount})
              AND (${status} = N'All' OR UPPER(ISNULL(Status, N'Active')) = UPPER(${status}))
            ORDER BY
                EffectiveDate DESC,
                TransportAllowanceId DESC
        `;

        res.json({
            success: true,
            data: result.recordset.map(mapRecord)
        });

    } catch (error) {

        console.error(
            "GET Transport Allowance Error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Unable to load Transport Allowance records.",
            error: error.message
        });
    }
});


/* =========================================================
   LOOKUPS (must be before /:id)
========================================================= */

router.get("/lookups/pay-level-groups", async (_req, res) => {
    try {
        res.json({
            success: true,
            data: [...ALLOWED_PAY_LEVEL_GROUPS],
        });
    } catch (error) {
        console.error("GET pay-level-groups error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load Pay Level Groups.",
        });
    }
});

router.get("/lookups/city-classes", async (_req, res) => {
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
            data: result.recordset.map((r) => ({
                cityClassId: Number(r.CityClassId),
                cityClass: r.CityClassName,
                status: r.Status,
            })),
        });
    } catch (error) {
        console.error("GET city-classes error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load City Classes.",
        });
    }
});


/* =========================================================
   GET BY ID
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {

            return res.status(400).json({
                success: false,
                message: "Invalid Transport Allowance ID."
            });
        }

        const result = await sql.query`
            SELECT
                TransportAllowanceId,
                EffectiveDate,
                PayLevelGroup,
                CityClass,
                TAAmount,
                Description,
                Status,
                CreatedDate,
                CreatedBy,
                ModifiedDate,
                ModifiedBy
            FROM dbo.TransportAllowanceMaster
            WHERE TransportAllowanceId = ${id}
        `;

        if (result.recordset.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    "Transport Allowance record not found."
            });
        }

        res.json({
            success: true,
            data: mapRecord(result.recordset[0])
        });

    } catch (error) {

        console.error(
            "GET Transport Allowance By ID Error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Unable to load Transport Allowance record.",
            error: error.message
        });
    }
});


/* =========================================================
   CREATE
========================================================= */

router.post("/", async (req, res) => {

    try {

        console.log(
            "Transport Allowance POST:",
            req.body
        );

        const {
            effectiveDate,
            payLevelGroup,
            cityClass,
            taAmount,
            description,
            status
        } = req.body;


        /* -----------------------------
           VALIDATION
        ----------------------------- */

        if (!effectiveDate) {

            return res.status(400).json({
                success: false,
                message: "Effective Date is required."
            });
        }

        if (!payLevelGroup) {

            return res.status(400).json({
                success: false,
                message: "Pay Level Group is required."
            });
        }

        if (!ALLOWED_PAY_LEVEL_GROUPS.includes(String(payLevelGroup).trim())) {

            return res.status(400).json({
                success: false,
                message: "Invalid Pay Level Group."
            });
        }

        if (!cityClass) {

            return res.status(400).json({
                success: false,
                message: "City Class is required."
            });
        }

        if (
            taAmount === "" ||
            taAmount === null ||
            taAmount === undefined ||
            Number.isNaN(Number(taAmount))
        ) {

            return res.status(400).json({
                success: false,
                message: "TA Amount is required."
            });
        }

        if (Number(taAmount) < 0) {

            return res.status(400).json({
                success: false,
                message:
                    "TA Amount cannot be negative."
            });
        }


        /* -----------------------------
           DUPLICATE CHECK
        ----------------------------- */

        const duplicate = await sql.query`

            SELECT TOP 1
                TransportAllowanceId

            FROM dbo.TransportAllowanceMaster

            WHERE
                EffectiveDate = ${effectiveDate}
                AND PayLevelGroup = ${payLevelGroup}
                AND CityClass = ${cityClass}

        `;

        if (duplicate.recordset.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "Transport Allowance already exists for the selected Effective Date, Pay Level Group and City Class."
            });
        }


        /* -----------------------------
           CREATED BY
        ----------------------------- */

        const createdBy =
            req.body.createdBy ||
            req.body.userName ||
            "SYSTEM";


        /* -----------------------------
           INSERT
        ----------------------------- */

        const result = await sql.query`

            INSERT INTO dbo.TransportAllowanceMaster
            (
                EffectiveDate,
                PayLevelGroup,
                CityClass,
                TAAmount,
                Description,
                Status,
                CreatedDate,
                CreatedBy
            )

            OUTPUT INSERTED.*

            VALUES
            (
                ${effectiveDate},
                ${payLevelGroup},
                ${cityClass},
                ${Number(taAmount)},
                ${description || ""},
                ${normalizeStatus(status)},
                SYSDATETIME(),
                ${createdBy}
            )

        `;


        res.status(201).json({

            success: true,

            message:
                "Transport Allowance saved successfully.",

            data:
                mapRecord(result.recordset[0])

        });

    } catch (error) {

        console.error(
            "POST Transport Allowance Error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to save Transport Allowance.",

            error:
                error.message

        });
    }
});


/* =========================================================
   UPDATE
========================================================= */

router.put("/:id", async (req, res) => {

    try {

        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid Transport Allowance ID."
            });
        }


        const {
            effectiveDate,
            payLevelGroup,
            cityClass,
            taAmount,
            description,
            status
        } = req.body;


        /* -----------------------------
           VALIDATION
        ----------------------------- */

        if (!effectiveDate) {

            return res.status(400).json({
                success: false,
                message: "Effective Date is required."
            });
        }

        if (!payLevelGroup) {

            return res.status(400).json({
                success: false,
                message: "Pay Level Group is required."
            });
        }

        if (!ALLOWED_PAY_LEVEL_GROUPS.includes(String(payLevelGroup).trim())) {

            return res.status(400).json({
                success: false,
                message: "Invalid Pay Level Group."
            });
        }

        if (!cityClass) {

            return res.status(400).json({
                success: false,
                message: "City Class is required."
            });
        }

        if (
            taAmount === "" ||
            taAmount === null ||
            taAmount === undefined ||
            Number.isNaN(Number(taAmount))
        ) {

            return res.status(400).json({
                success: false,
                message: "TA Amount is required."
            });
        }


        /* -----------------------------
           CHECK EXISTING
        ----------------------------- */

        const existing = await sql.query`

            SELECT TOP 1
                TransportAllowanceId

            FROM dbo.TransportAllowanceMaster

            WHERE TransportAllowanceId = ${id}

        `;

        if (existing.recordset.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    "Transport Allowance record not found."
            });
        }


        /* -----------------------------
           DUPLICATE CHECK
        ----------------------------- */

        const duplicate = await sql.query`

            SELECT TOP 1
                TransportAllowanceId

            FROM dbo.TransportAllowanceMaster

            WHERE
                EffectiveDate = ${effectiveDate}
                AND PayLevelGroup = ${payLevelGroup}
                AND CityClass = ${cityClass}
                AND TransportAllowanceId <> ${id}

        `;

        if (duplicate.recordset.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "Another Transport Allowance record already exists with the same details."
            });
        }


        const modifiedBy =
            req.body.modifiedBy ||
            req.body.userName ||
            "SYSTEM";


        /* -----------------------------
           UPDATE
        ----------------------------- */

        const result = await sql.query`

            UPDATE dbo.TransportAllowanceMaster

            SET
                EffectiveDate = ${effectiveDate},

                PayLevelGroup = ${payLevelGroup},

                CityClass = ${cityClass},

                TAAmount = ${Number(taAmount)},

                Description = ${description || ""},

                Status = ${normalizeStatus(status)},

                ModifiedDate = SYSDATETIME(),

                ModifiedBy = ${modifiedBy}

            OUTPUT INSERTED.*

            WHERE
                TransportAllowanceId = ${id}

        `;


        res.json({

            success: true,

            message:
                "Transport Allowance updated successfully.",

            data:
                mapRecord(result.recordset[0])

        });

    } catch (error) {

        console.error(
            "PUT Transport Allowance Error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to update Transport Allowance.",

            error:
                error.message

        });
    }
});


/* =========================================================
   DELETE (hard delete by primary key)
========================================================= */

router.delete("/:id", async (req, res) => {

    try {

        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid Transport Allowance ID."
            });
        }


        const existing = await sql.query`

            SELECT TOP 1
                TransportAllowanceId

            FROM dbo.TransportAllowanceMaster

            WHERE TransportAllowanceId = ${id}

        `;

        if (existing.recordset.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    "Transport Allowance record not found."
            });
        }


        await sql.query`
            DELETE FROM dbo.TransportAllowanceMaster
            WHERE TransportAllowanceId = ${id}
        `;


        res.json({

            success: true,

            message:
                "Transport Allowance deleted successfully."

        });

    } catch (error) {

        console.error(
            "DELETE Transport Allowance Error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to delete Transport Allowance.",

            error:
                error.message

        });
    }
});


module.exports = router;