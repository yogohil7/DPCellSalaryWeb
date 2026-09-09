const express = require("express");
const { sql } = require("../db");

const router = express.Router();

/*
=========================================================
CLA MASTER
Table: dbo.CLAMaster

Database columns:
CLAId
EffectiveDate
PayLevelGroup
CityClass
CLAAmount
Description
Status
CreatedDate
CreatedBy
ModifiedDate
ModifiedBy
PayRevisionId
CityClassId
EmployeeClass
=========================================================
*/


// =======================================================
// ACTOR
// =======================================================

function actorFromBody(body = {}) {
    return {
        userName:
            body.userName ||
            body.actorUserName ||
            "SYSTEM",

        fullName:
            body.fullName ||
            body.actorFullName ||
            body.userName ||
            body.actorUserName ||
            "SYSTEM"
    };
}


// =======================================================
// STATUS
// =======================================================

function normalizeStatus(value) {
    const raw = String(value || "Active")
        .trim()
        .toUpperCase();

    if (
        raw === "INACTIVE" ||
        raw === "0" ||
        raw === "FALSE"
    ) {
        return "Inactive";
    }

    return "Active";
}


// =======================================================
// DATE
// =======================================================

function toDateOnly(value) {

    if (value == null || value === "") {
        return null;
    }

    if (value instanceof Date) {

        if (Number.isNaN(value.getTime())) {
            return null;
        }

        /* Prefer calendar date from UTC midnight (SQL date → JS Date). */
        const y = value.getUTCFullYear();
        const m = String(value.getUTCMonth() + 1).padStart(2, "0");
        const d = String(value.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    const s = String(value).trim();

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        return s.slice(0, 10);
    }

    // DD-MM-YYYY
    const match = s.match(
        /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/
    );

    if (match) {
        const day = match[1];
        const month = match[2];
        const year = match[3];

        return `${year}-${month}-${day}`;
    }

    return null;
}


// =======================================================
// NUMBER
// =======================================================

function toNumber(value) {

    if (value == null || value === "") {
        return null;
    }

    const n = Number(value);

    return Number.isFinite(n) ? n : null;
}


// =======================================================
// MAP DATABASE ROW
// =======================================================

function mapCla(row) {

    if (!row) {
        return null;
    }

    return {

        id:
            row.CLAId != null
                ? Number(row.CLAId)
                : null,

        claId:
            row.CLAId != null
                ? Number(row.CLAId)
                : null,

        effectiveDate:
            toDateOnly(row.EffectiveDate),

        payLevelGroup:
            row.PayLevelGroup || "",

        cityClass:
            row.CityClass || "",

        claAmount:
            row.CLAAmount != null
                ? Number(row.CLAAmount)
                : 0,

        description:
            row.Description || "",

        status:
            normalizeStatus(row.Status),

        payRevisionId:
            row.PayRevisionId != null
                ? Number(row.PayRevisionId)
                : null,

        cityClassId:
            row.CityClassId != null
                ? Number(row.CityClassId)
                : null,

        employeeClass:
            row.EmployeeClass || "",

        createdDate:
            row.CreatedDate || null,

        createdBy:
            row.CreatedBy || null,

        modifiedDate:
            row.ModifiedDate || null,

        modifiedBy:
            row.ModifiedBy || null
    };
}


// =======================================================
// VALIDATE PAYLOAD
// =======================================================

function validatePayload(body = {}) {

    const effectiveDate = toDateOnly(
        body.effectiveDate ||
        body.EffectiveDate
    );

    const payLevelGroup = String(
        body.payLevelGroup ||
        body.PayLevelGroup ||
        ""
    ).trim();

    const cityClass = String(
        body.cityClass ||
        body.CityClass ||
        ""
    ).trim();

    const claAmount = toNumber(
        body.claAmount ??
        body.CLAAmount
    );

    const description = String(
        body.description ||
        body.Description ||
        ""
    ).trim();

    const status = normalizeStatus(
        body.status ||
        body.Status
    );

    const payRevisionId =
        body.payRevisionId != null &&
        body.payRevisionId !== ""
            ? Number(body.payRevisionId)
            : null;

    const cityClassId =
        body.cityClassId != null &&
        body.cityClassId !== ""
            ? Number(body.cityClassId)
            : null;

    const employeeClass = String(
        body.employeeClass ||
        body.EmployeeClass ||
        ""
    ).trim();


    // -----------------------------------------------
    // Required Effective Date
    // -----------------------------------------------

    if (!effectiveDate) {

        return {
            error: "Effective Date is required."
        };
    }


    // -----------------------------------------------
    // Required Pay Level Group
    // -----------------------------------------------

    if (!payLevelGroup) {

        return {
            error: "Pay Level Group is required."
        };
    }


    // -----------------------------------------------
    // Required City Class
    // -----------------------------------------------

    if (!cityClass) {

        return {
            error: "City Class is required."
        };
    }


    // -----------------------------------------------
    // CLA Amount
    // -----------------------------------------------

    if (claAmount == null) {

        return {
            error: "CLA Amount is required and must be numeric."
        };
    }


    if (claAmount < 0) {

        return {
            error: "CLA Amount cannot be negative."
        };
    }


    // -----------------------------------------------
    // Status
    // -----------------------------------------------

    if (!status) {

        return {
            error: "Status is required."
        };
    }


    return {

        effectiveDate,

        payLevelGroup,

        cityClass,

        claAmount,

        description,

        status,

        payRevisionId:
            Number.isFinite(payRevisionId) &&
            payRevisionId > 0
                ? payRevisionId
                : null,

        cityClassId:
            Number.isFinite(cityClassId) &&
            cityClassId > 0
                ? cityClassId
                : null,

        employeeClass
    };
}


// =======================================================
// TEST ROUTE
// GET /api/cla-master/test
// =======================================================

router.get("/test", async (req, res) => {

    try {

        const result = await sql.query`
            SELECT
                COUNT(*) AS TotalRecords
            FROM dbo.CLAMaster
        `;

        res.json({

            success: true,

            message: "CLA Master database connection is working.",

            totalRecords:
                Number(
                    result.recordset[0]?.TotalRecords || 0
                )
        });

    } catch (error) {

        console.error(
            "GET /api/cla-master/test error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to test CLA Master database.",

            error:
                error.message
        });
    }
});


// =======================================================
// GET ALL CLA
// GET /api/cla-master
// =======================================================

router.get("/", async (req, res) => {

    try {

        console.log(
            "GET /api/cla-master",
            req.query
        );


        const effectiveDate =
            toDateOnly(
                req.query.effectiveDate
            );


        const payLevelGroupRaw =
            String(
                req.query.payLevelGroup || ""
            ).trim();

        const payLevelGroup =
            !payLevelGroupRaw ||
            payLevelGroupRaw.toLowerCase() === "all"
                ? "All"
                : payLevelGroupRaw;


        const cityClassRaw =
            String(
                req.query.cityClass || ""
            ).trim();

        const cityClass =
            !cityClassRaw ||
            cityClassRaw.toLowerCase() === "all"
                ? "All"
                : cityClassRaw;


        const statusRaw =
            String(
                req.query.status || ""
            ).trim();

        const status =
            !statusRaw ||
            statusRaw.toLowerCase() === "all"
                ? "All"
                : statusRaw;


        console.log("CLA filters:", {
            effectiveDate,
            payLevelGroup,
            cityClass,
            status
        });


        /*
        ==================================================
        IMPORTANT

        We are querying the EXACT columns from
        dbo.CLAMaster.

        EffectiveDate
        PayLevelGroup
        CityClass
        Status
        ==================================================
        */

        const result = await sql.query`

            SELECT
                CLAId,
                EffectiveDate,
                PayLevelGroup,
                CityClass,
                CLAAmount,
                Description,
                Status,
                CreatedDate,
                CreatedBy,
                ModifiedDate,
                ModifiedBy,
                PayRevisionId,
                CityClassId,
                EmployeeClass

            FROM dbo.CLAMaster

            WHERE
                (
                    ${effectiveDate} IS NULL
                    OR CONVERT(date, EffectiveDate)
                       = CONVERT(date, ${effectiveDate})
                )

                AND
                (
                    ${payLevelGroup} = N'All'
                    OR PayLevelGroup = ${payLevelGroup}
                )

                AND
                (
                    ${cityClass} = N'All'
                    OR CityClass = ${cityClass}
                )

                AND
                (
                    ${status} = N'All'
                    OR UPPER(ISNULL(Status, N'Active'))
                       = UPPER(${status})
                )

            ORDER BY
                EffectiveDate DESC,
                CLAId DESC
        `;


        console.log(
            "CLA records found:",
            result.recordset.length
        );


        res.json({

            success: true,

            message:
                "CLA Master loaded successfully.",

            data:
                result.recordset.map(mapCla)

        });

    } catch (error) {

        console.error(
            "GET /api/cla-master error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to load CLA Master.",

            error:
                error.message

        });
    }
});


// =======================================================
// GET ONE CLA
// GET /api/cla-master/:id
// =======================================================

router.get("/:id", async (req, res) => {

    try {

        const id =
            Number(req.params.id);


        if (!Number.isFinite(id)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid CLA Id."

            });
        }


        const result = await sql.query`

            SELECT TOP 1

                CLAId,
                EffectiveDate,
                PayLevelGroup,
                CityClass,
                CLAAmount,
                Description,
                Status,
                CreatedDate,
                CreatedBy,
                ModifiedDate,
                ModifiedBy,
                PayRevisionId,
                CityClassId,
                EmployeeClass

            FROM dbo.CLAMaster

            WHERE CLAId = ${id}
        `;


        if (!result.recordset[0]) {

            return res.status(404).json({

                success: false,

                message:
                    "CLA Master record not found."

            });
        }


        res.json({

            success: true,

            message: "OK",

            data:
                mapCla(
                    result.recordset[0]
                )

        });

    } catch (error) {

        console.error(
            "GET /api/cla-master/:id error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to load CLA Master.",

            error:
                error.message

        });
    }
});


// =======================================================
// POST CLA
// POST /api/cla-master
// =======================================================

router.post("/", async (req, res) => {

    try {

        console.log(
            "POST /api/cla-master BODY:",
            req.body
        );


        const actor =
            actorFromBody(req.body);


        const parsed =
            validatePayload(req.body);


        if (parsed.error) {

            return res.status(400).json({

                success: false,

                message:
                    parsed.error

            });
        }


        // -----------------------------------------------
        // Check duplicate
        // -----------------------------------------------

        const duplicate =
            await sql.query`

                SELECT TOP 1
                    CLAId

                FROM dbo.CLAMaster

                WHERE
                    CONVERT(date, EffectiveDate)
                    = CONVERT(date, ${parsed.effectiveDate})

                    AND
                    PayLevelGroup =
                    ${parsed.payLevelGroup}

                    AND
                    CityClass =
                    ${parsed.cityClass}
            `;


        if (duplicate.recordset[0]) {

            return res.status(409).json({

                success: false,

                message:
                    "CLA record already exists for this Effective Date, Pay Level Group and City Class."

            });
        }


        // -----------------------------------------------
        // INSERT
        // -----------------------------------------------

        const insert =
            await sql.query`

                INSERT INTO dbo.CLAMaster
                (
                    EffectiveDate,
                    PayLevelGroup,
                    CityClass,
                    CLAAmount,
                    Description,
                    Status,
                    CreatedDate,
                    CreatedBy,
                    PayRevisionId,
                    CityClassId,
                    EmployeeClass
                )

                OUTPUT INSERTED.*

                VALUES
                (
                    ${parsed.effectiveDate},
                    ${parsed.payLevelGroup},
                    ${parsed.cityClass},
                    ${parsed.claAmount},
                    ${parsed.description || null},
                    ${parsed.status},
                    SYSDATETIME(),
                    ${actor.fullName},
                    ${parsed.payRevisionId},
                    ${parsed.cityClassId},
                    ${parsed.employeeClass || null}
                )
            `;


        if (!insert.recordset[0]) {
            return res.status(500).json({
                success: false,
                message:
                    "CLA Master insert did not return a row.",
            });
        }

        const data =
            mapCla(
                insert.recordset[0]
            );


        console.log(
            "CLA INSERTED:",
            data
        );


        res.status(201).json({

            success: true,

            message:
                "CLA Master saved successfully.",

            data

        });

    } catch (error) {

        console.error(
            "POST /api/cla-master error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to save CLA Master.",

            error:
                error.message

        });
    }
});


// =======================================================
// PUT CLA
// PUT /api/cla-master/:id
// =======================================================

router.put("/:id", async (req, res) => {

    try {

        const id =
            Number(req.params.id);


        if (!Number.isFinite(id)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid CLA Id."

            });
        }


        const actor =
            actorFromBody(req.body);


        const parsed =
            validatePayload(req.body);


        if (parsed.error) {

            return res.status(400).json({

                success: false,

                message:
                    parsed.error

            });
        }


        // -----------------------------------------------
        // Check existing record
        // -----------------------------------------------

        const current =
            await sql.query`

                SELECT TOP 1 *

                FROM dbo.CLAMaster

                WHERE CLAId = ${id}
            `;


        if (!current.recordset[0]) {

            return res.status(404).json({

                success: false,

                message:
                    "CLA Master record not found."

            });
        }


        // -----------------------------------------------
        // Duplicate check
        // -----------------------------------------------

        const duplicate =
            await sql.query`

                SELECT TOP 1
                    CLAId

                FROM dbo.CLAMaster

                WHERE

                    CONVERT(date, EffectiveDate)
                    = CONVERT(date, ${parsed.effectiveDate})

                    AND PayLevelGroup =
                        ${parsed.payLevelGroup}

                    AND CityClass =
                        ${parsed.cityClass}

                    AND CLAId <> ${id}
            `;


        if (duplicate.recordset[0]) {

            return res.status(409).json({

                success: false,

                message:
                    "Another CLA record already exists with the same Effective Date, Pay Level Group and City Class."

            });
        }


        // -----------------------------------------------
        // UPDATE
        // -----------------------------------------------

        const update =
            await sql.query`

                UPDATE dbo.CLAMaster

                SET

                    EffectiveDate =
                        ${parsed.effectiveDate},

                    PayLevelGroup =
                        ${parsed.payLevelGroup},

                    CityClass =
                        ${parsed.cityClass},

                    CLAAmount =
                        ${parsed.claAmount},

                    Description =
                        ${parsed.description},

                    Status =
                        ${parsed.status},

                    PayRevisionId =
                        ${parsed.payRevisionId},

                    CityClassId =
                        ${parsed.cityClassId},

                    EmployeeClass =
                        ${parsed.employeeClass},

                    ModifiedDate =
                        SYSDATETIME(),

                    ModifiedBy =
                        ${actor.fullName}

                OUTPUT INSERTED.*

                WHERE CLAId = ${id}
            `;


        res.json({

            success: true,

            message:
                "CLA Master updated successfully.",

            data:
                mapCla(
                    update.recordset[0]
                )

        });

    } catch (error) {

        console.error(
            "PUT /api/cla-master/:id error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to update CLA Master.",

            error:
                error.message

        });
    }
});


// =======================================================
// DELETE / DEACTIVATE
// DELETE /api/cla-master/:id
// =======================================================

router.delete("/:id", async (req, res) => {

    try {

        const id =
            Number(req.params.id);


        if (!Number.isFinite(id)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid CLA Id."

            });
        }


        const current =
            await sql.query`

                SELECT TOP 1
                    CLAId

                FROM dbo.CLAMaster

                WHERE CLAId = ${id}
            `;


        if (!current.recordset[0]) {

            return res.status(404).json({

                success: false,

                message:
                    "CLA Master record not found."

            });
        }


        const actor =
            actorFromBody(req.body);


        await sql.query`

            UPDATE dbo.CLAMaster

            SET

                Status = N'Inactive',

                ModifiedDate =
                    SYSDATETIME(),

                ModifiedBy =
                    ${actor.fullName}

            WHERE CLAId = ${id}
        `;


        res.json({

            success: true,

            message:
                "CLA Master deactivated successfully."

        });

    } catch (error) {

        console.error(
            "DELETE /api/cla-master/:id error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to delete CLA Master.",

            error:
                error.message

        });
    }
});


module.exports = router;