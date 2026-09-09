const { sql } = require("../db");

/**
 * Normalize Pay Matrix CellNo from UI labels like "Cell 29" → 29.
 */
function normalizePayMatrixCellNo(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const n = Math.round(value);
    if (Math.abs(value - n) > 1e-9 || n < 1) return null;
    return n;
  }
  const raw = String(value)
    .replace(/,/g, "")
    .replace(/^(cell|cellno|cell\s*no\.?)\s*/i, "")
    .trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > 1e-9 || rounded < 1) return null;
  return rounded;
}

/**
 * Normalize Pay Matrix Level — keep alphanumeric codes (IS-2). Never coerce IS-2 → 2.
 */
function normalizePayMatrixLevel(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) > 1e-9 || rounded < 1) return "";
    return String(rounded);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Reusable Pay Matrix BasicPay lookup.
 * Level is NVARCHAR (e.g. IS-1) — never coerce IS-1 → 1.
 *
 * For Employee Master assignment, call without effectiveDate so DOJ before
 * matrix EffectiveDate does not block a valid Level+Cell combination.
 */
async function getBasicPay({
  payRevisionId,
  level,
  cellNo,
  effectiveDate = null,
  preferActive = true,
}) {
  const revisionId = Number(payRevisionId);
  const lvl = normalizePayMatrixLevel(level);
  const cell = normalizePayMatrixCellNo(cellNo);

  if (!Number.isFinite(revisionId) || !lvl || cell == null) {
    return null;
  }

  const onDate = effectiveDate || null;

  async function queryActive(withDate) {
    if (withDate) {
      return sql.query`
        SELECT TOP 1 PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = ${revisionId}
          AND Level = ${lvl}
          AND CellNo = ${cell}
          AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
          AND (EffectiveDate IS NULL OR EffectiveDate <= ${withDate})
        ORDER BY EffectiveDate DESC, PayMatrixId DESC
      `;
    }
    return sql.query`
      SELECT TOP 1 PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${revisionId}
        AND Level = ${lvl}
        AND CellNo = ${cell}
        AND (UPPER(ISNULL(Status, N'Active')) = N'ACTIVE' OR ISNULL(IsActive, 1) = 1)
      ORDER BY EffectiveDate DESC, PayMatrixId DESC
    `;
  }

  async function queryAny(withDate) {
    if (withDate) {
      return sql.query`
        SELECT TOP 1 PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive
        FROM dbo.PayMatrixMaster
        WHERE PayRevisionId = ${revisionId}
          AND Level = ${lvl}
          AND CellNo = ${cell}
          AND (EffectiveDate IS NULL OR EffectiveDate <= ${withDate})
        ORDER BY EffectiveDate DESC, PayMatrixId DESC
      `;
    }
    return sql.query`
      SELECT TOP 1 PayMatrixId, PayRevisionId, Level, CellNo, BasicPay, EffectiveDate, Status, IsActive
      FROM dbo.PayMatrixMaster
      WHERE PayRevisionId = ${revisionId}
        AND Level = ${lvl}
        AND CellNo = ${cell}
      ORDER BY EffectiveDate DESC, PayMatrixId DESC
    `;
  }

  if (preferActive) {
    let active = await queryActive(onDate);
    if (active.recordset[0]) return mapLookup(active.recordset[0]);
    /* If date filter excluded the only row, fall back without date. */
    if (onDate) {
      active = await queryActive(null);
      if (active.recordset[0]) return mapLookup(active.recordset[0]);
    }
  }

  let any = await queryAny(onDate);
  if (!any.recordset[0] && onDate) {
    any = await queryAny(null);
  }
  if (!any.recordset[0]) return null;
  return mapLookup(any.recordset[0]);
}

function mapLookup(row) {
  return {
    payMatrixId: Number(row.PayMatrixId),
    payRevisionId: Number(row.PayRevisionId),
    level: row.Level == null ? "" : String(row.Level).trim(),
    cellNo: Number(row.CellNo),
    basicPay: Number(row.BasicPay),
    effectiveDate: row.EffectiveDate || null,
    status: row.Status || "",
    isActive: row.IsActive == null ? true : Boolean(row.IsActive),
  };
}

module.exports = {
  getBasicPay,
  normalizePayMatrixCellNo,
  normalizePayMatrixLevel,
};
