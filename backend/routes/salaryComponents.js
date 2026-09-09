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

function mapComponent(row) {
  return {
    salaryComponentId: Number(row.SalaryComponentId),
    id: Number(row.SalaryComponentId),
    componentCode: row.ComponentCode || "",
    componentName: row.ComponentName || "",
    componentType: row.ComponentType || "",
    calculationType: row.CalculationType || "",
    isEarning: Boolean(row.IsEarning),
    isDeduction: Boolean(row.IsDeduction),
    isActive: Boolean(row.IsActive),
    displayOrder: row.DisplayOrder != null ? Number(row.DisplayOrder) : null,
    ruleSource: row.RuleSource || "",
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

function mapRule(row) {
  return {
    salaryComponentRuleId: Number(row.SalaryComponentRuleId),
    id: Number(row.SalaryComponentRuleId),
    salaryComponentId: Number(row.SalaryComponentId),
    componentCode: row.ComponentCode || "",
    componentName: row.ComponentName || "",
    payRevisionId: row.PayRevisionId != null ? Number(row.PayRevisionId) : null,
    revisionCode: row.RevisionCode || "",
    cityClassId: row.CityClassId != null ? Number(row.CityClassId) : null,
    cityClassName: row.CityClassName || "",
    designationId: row.DesignationId != null ? Number(row.DesignationId) : null,
    designationName: row.DesignationName || "",
    employeeClass: row.EmployeeClass || "",
    employeeId: row.EmployeeId != null ? Number(row.EmployeeId) : null,
    employeeCode: row.EmployeeCode || "",
    employeeName: row.EmployeeName || "",
    effectiveFrom: row.EffectiveFrom,
    effectiveTo: row.EffectiveTo,
    percentage: row.Percentage != null ? Number(row.Percentage) : null,
    fixedAmount: row.FixedAmount != null ? Number(row.FixedAmount) : null,
    formula: row.Formula || "",
    isActive: Boolean(row.IsActive),
    createdDate: row.CreatedDate,
    createdBy: row.CreatedBy,
    modifiedDate: row.ModifiedDate,
    modifiedBy: row.ModifiedBy,
  };
}

router.get("/", async (req, res) => {
  try {
    const activeOnly =
      String(req.query.active || "").toLowerCase() === "1" ||
      String(req.query.active || "").toLowerCase() === "true";
    const result = activeOnly
      ? await sql.query`
          SELECT * FROM dbo.SalaryComponentMaster
          WHERE IsActive = 1
          ORDER BY ISNULL(DisplayOrder, 9999), ComponentCode
        `
      : await sql.query`
          SELECT * FROM dbo.SalaryComponentMaster
          ORDER BY ISNULL(DisplayOrder, 9999), ComponentCode
        `;
    res.json({ message: "OK", data: result.recordset.map(mapComponent) });
  } catch (error) {
    console.error("GET /api/salary-components error:", error);
    res.status(500).json({ message: "Unable to load salary components.", error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const componentName = String(req.body?.componentName || "").trim();
    const componentType = String(req.body?.componentType || "").trim().toUpperCase();
    const calculationType = String(req.body?.calculationType || "").trim().toUpperCase();
    const ruleSource = String(req.body?.ruleSource || "").trim() || null;
    const displayOrder =
      req.body?.displayOrder != null && req.body.displayOrder !== ""
        ? Number(req.body.displayOrder)
        : null;
    const isActive =
      req.body?.isActive === false || req.body?.isActive === 0 || req.body?.isActive === "0"
        ? 0
        : 1;

    if (!componentName) {
      return res.status(400).json({ message: "Component Name is required." });
    }

    const updated = await sql.query`
      UPDATE dbo.SalaryComponentMaster
      SET
        ComponentName = ${componentName},
        ComponentType = ${componentType},
        CalculationType = ${calculationType || "MANUAL"},
        RuleSource = ${ruleSource},
        DisplayOrder = ${displayOrder},
        IsActive = ${isActive},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE SalaryComponentId = ${id}
    `;
    if (!updated.recordset[0]) {
      return res.status(404).json({ message: "Salary component not found." });
    }
    res.json({
      message: "Salary component updated successfully.",
      data: mapComponent(updated.recordset[0]),
    });
  } catch (error) {
    console.error("PUT /api/salary-components/:id error:", error);
    res.status(500).json({ message: "Unable to update salary component.", error: error.message });
  }
});

/* ---- Rules nested under /api/salary-components/rules ---- */
router.get("/rules/list", async (req, res) => {
  try {
    const componentId = Number(req.query.salaryComponentId);
    const result =
      Number.isFinite(componentId) && componentId > 0
        ? await sql.query`
            SELECT r.*, c.ComponentCode, c.ComponentName,
                   pr.RevisionCode, cc.CityClassName, d.DesignationName,
                   e.EmployeeCode, e.EmployeeName
            FROM dbo.SalaryComponentRule r
            INNER JOIN dbo.SalaryComponentMaster c ON c.SalaryComponentId = r.SalaryComponentId
            LEFT JOIN dbo.PayRevisionMaster pr ON pr.PayRevisionId = r.PayRevisionId
            LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = r.CityClassId
            LEFT JOIN dbo.Designations d ON d.DesignationId = r.DesignationId
            LEFT JOIN dbo.EmployeeMaster e ON e.EmployeeId = r.EmployeeId
            WHERE r.SalaryComponentId = ${componentId}
            ORDER BY r.EffectiveFrom DESC, r.SalaryComponentRuleId DESC
          `
        : await sql.query`
            SELECT r.*, c.ComponentCode, c.ComponentName,
                   pr.RevisionCode, cc.CityClassName, d.DesignationName,
                   e.EmployeeCode, e.EmployeeName
            FROM dbo.SalaryComponentRule r
            INNER JOIN dbo.SalaryComponentMaster c ON c.SalaryComponentId = r.SalaryComponentId
            LEFT JOIN dbo.PayRevisionMaster pr ON pr.PayRevisionId = r.PayRevisionId
            LEFT JOIN dbo.CityClasses cc ON cc.CityClassId = r.CityClassId
            LEFT JOIN dbo.Designations d ON d.DesignationId = r.DesignationId
            LEFT JOIN dbo.EmployeeMaster e ON e.EmployeeId = r.EmployeeId
            ORDER BY c.DisplayOrder, r.EffectiveFrom DESC
          `;
    res.json({ message: "OK", data: result.recordset.map(mapRule) });
  } catch (error) {
    console.error("GET /api/salary-components/rules/list error:", error);
    res.status(500).json({ message: "Unable to load rules.", error: error.message });
  }
});

router.post("/rules", async (req, res) => {
  try {
    const actor = actorFromBody(req.body);
    const salaryComponentId = Number(req.body?.salaryComponentId);
    const payRevisionId =
      req.body?.payRevisionId != null && req.body.payRevisionId !== ""
        ? Number(req.body.payRevisionId)
        : null;
    const cityClassId =
      req.body?.cityClassId != null && req.body.cityClassId !== ""
        ? Number(req.body.cityClassId)
        : null;
    const designationId =
      req.body?.designationId != null && req.body.designationId !== ""
        ? Number(req.body.designationId)
        : null;
    const employeeClass = String(req.body?.employeeClass || "").trim() || null;
    const employeeId = req.body?.employeeId ? Number(req.body.employeeId) : null;
    const effectiveFrom = req.body?.effectiveFrom || null;
    const effectiveTo = req.body?.effectiveTo || null;
    const percentage =
      req.body?.percentage != null && req.body.percentage !== ""
        ? Number(req.body.percentage)
        : null;
    const fixedAmount =
      req.body?.fixedAmount != null && req.body.fixedAmount !== ""
        ? Number(req.body.fixedAmount)
        : null;
    const formula = String(req.body?.formula || "").trim() || null;
    const isActive =
      req.body?.isActive === false || req.body?.isActive === 0 ? 0 : 1;

    if (!Number.isFinite(salaryComponentId)) {
      return res.status(400).json({ message: "Salary Component is required." });
    }
    if (employeeId != null && (!Number.isInteger(employeeId) || employeeId <= 0)) {
      return res.status(400).json({ message: "Select a valid employee." });
    }
    if (!effectiveFrom) {
      return res.status(400).json({ message: "Effective From is required." });
    }
    if (effectiveTo && String(effectiveTo) < String(effectiveFrom)) {
      return res.status(400).json({ message: "Effective To cannot be earlier than Effective From." });
    }
    if (percentage == null && fixedAmount == null && !formula) {
      return res.status(400).json({
        message: "Provide Percentage, Fixed Amount, or Formula.",
      });
    }

    const overlap = await sql.query`
      SELECT TOP 1 SalaryComponentRuleId
      FROM dbo.SalaryComponentRule
      WHERE SalaryComponentId = ${salaryComponentId}
        AND IsActive = 1
        AND ${isActive} = 1
        AND ISNULL(PayRevisionId, -1) = ISNULL(${payRevisionId}, -1)
        AND ISNULL(CityClassId, -1) = ISNULL(${cityClassId}, -1)
        AND ISNULL(DesignationId, -1) = ISNULL(${designationId}, -1)
        AND ISNULL(EmployeeClass, N'') = ISNULL(${employeeClass}, N'')
        AND ISNULL(EmployeeId, -1) = ISNULL(${employeeId}, -1)
        AND EffectiveFrom <= ISNULL(${effectiveTo}, CONVERT(DATE, '9999-12-31'))
        AND ISNULL(EffectiveTo, CONVERT(DATE, '9999-12-31')) >= ${effectiveFrom}
    `;
    if (overlap.recordset[0]) {
      return res.status(409).json({
        message: "Overlapping active rule exists for the same applicability.",
      });
    }

    const insert = await sql.query`
      INSERT INTO dbo.SalaryComponentRule
        (SalaryComponentId, PayRevisionId, CityClassId, DesignationId, EmployeeClass, EmployeeId,
         EffectiveFrom, EffectiveTo, Percentage, FixedAmount, Formula, IsActive, CreatedBy)
      OUTPUT INSERTED.*
      VALUES
        (${salaryComponentId}, ${payRevisionId}, ${cityClassId}, ${designationId}, ${employeeClass}, ${employeeId},
         ${effectiveFrom}, ${effectiveTo}, ${percentage}, ${fixedAmount}, ${formula}, ${isActive},
         ${actor.fullName})
    `;

    res.status(201).json({
      message: "Rule saved successfully.",
      data: mapRule({ ...insert.recordset[0], ComponentCode: "", ComponentName: "" }),
    });
  } catch (error) {
    console.error("POST /api/salary-components/rules error:", error);
    res.status(500).json({ message: "Unable to save rule.", error: error.message });
  }
});

router.put("/rules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const salaryComponentId = Number(req.body?.salaryComponentId);
    const payRevisionId =
      req.body?.payRevisionId != null && req.body.payRevisionId !== ""
        ? Number(req.body.payRevisionId)
        : null;
    const cityClassId =
      req.body?.cityClassId != null && req.body.cityClassId !== ""
        ? Number(req.body.cityClassId)
        : null;
    const designationId =
      req.body?.designationId != null && req.body.designationId !== ""
        ? Number(req.body.designationId)
        : null;
    const employeeClass = String(req.body?.employeeClass || "").trim() || null;
    const employeeId = req.body?.employeeId ? Number(req.body.employeeId) : null;
    const effectiveFrom = req.body?.effectiveFrom || null;
    const effectiveTo = req.body?.effectiveTo || null;
    const percentage =
      req.body?.percentage != null && req.body.percentage !== ""
        ? Number(req.body.percentage)
        : null;
    const fixedAmount =
      req.body?.fixedAmount != null && req.body.fixedAmount !== ""
        ? Number(req.body.fixedAmount)
        : null;
    const formula = String(req.body?.formula || "").trim() || null;
    const isActive =
      req.body?.isActive === false || req.body?.isActive === 0 ? 0 : 1;

    if (!effectiveFrom) {
      return res.status(400).json({ message: "Effective From is required." });
    }
    if (employeeId != null && (!Number.isInteger(employeeId) || employeeId <= 0)) {
      return res.status(400).json({ message: "Select a valid employee." });
    }
    if (effectiveTo && String(effectiveTo) < String(effectiveFrom)) {
      return res.status(400).json({ message: "Effective To cannot be earlier than Effective From." });
    }

    const overlap = await sql.query`
      SELECT TOP 1 SalaryComponentRuleId
      FROM dbo.SalaryComponentRule
      WHERE SalaryComponentId = ${salaryComponentId}
        AND IsActive = 1
        AND ${isActive} = 1
        AND SalaryComponentRuleId <> ${id}
        AND ISNULL(PayRevisionId, -1) = ISNULL(${payRevisionId}, -1)
        AND ISNULL(CityClassId, -1) = ISNULL(${cityClassId}, -1)
        AND ISNULL(DesignationId, -1) = ISNULL(${designationId}, -1)
        AND ISNULL(EmployeeClass, N'') = ISNULL(${employeeClass}, N'')
        AND ISNULL(EmployeeId, -1) = ISNULL(${employeeId}, -1)
        AND EffectiveFrom <= ISNULL(${effectiveTo}, CONVERT(DATE, '9999-12-31'))
        AND ISNULL(EffectiveTo, CONVERT(DATE, '9999-12-31')) >= ${effectiveFrom}
    `;
    if (overlap.recordset[0]) {
      return res.status(409).json({
        message: "Overlapping active rule exists for the same applicability.",
      });
    }

    const updated = await sql.query`
      UPDATE dbo.SalaryComponentRule
      SET
        SalaryComponentId = ${salaryComponentId},
        PayRevisionId = ${payRevisionId},
        CityClassId = ${cityClassId},
        DesignationId = ${designationId},
        EmployeeClass = ${employeeClass},
        EmployeeId = ${employeeId},
        EffectiveFrom = ${effectiveFrom},
        EffectiveTo = ${effectiveTo},
        Percentage = ${percentage},
        FixedAmount = ${fixedAmount},
        Formula = ${formula},
        IsActive = ${isActive},
        ModifiedDate = SYSDATETIME(),
        ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE SalaryComponentRuleId = ${id}
    `;
    if (!updated.recordset[0]) {
      return res.status(404).json({ message: "Rule not found." });
    }
    res.json({
      message: "Rule updated successfully.",
      data: mapRule({ ...updated.recordset[0], ComponentCode: "", ComponentName: "" }),
    });
  } catch (error) {
    console.error("PUT /api/salary-components/rules/:id error:", error);
    res.status(500).json({ message: "Unable to update rule.", error: error.message });
  }
});

router.delete("/rules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const actor = actorFromBody(req.body);
    const updated = await sql.query`
      UPDATE dbo.SalaryComponentRule
      SET IsActive = 0, ModifiedDate = SYSDATETIME(), ModifiedBy = ${actor.fullName}
      OUTPUT INSERTED.*
      WHERE SalaryComponentRuleId = ${id}
    `;
    if (!updated.recordset[0]) {
      return res.status(404).json({ message: "Rule not found." });
    }
    res.json({ message: "Rule deactivated successfully." });
  } catch (error) {
    console.error("DELETE /api/salary-components/rules/:id error:", error);
    res.status(500).json({ message: "Unable to delete rule.", error: error.message });
  }
});

module.exports = router;
