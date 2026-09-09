/**
 * Pay Level Group resolution for allowance lookups (TA / CLA).
 *
 * TA Master PayLevelGroup values:
 *   "Level 2 and Below" | "Level 3-8" | "Level 9 and Above"
 *
 * CLA Master historically uses:
 *   "Level 1 to Below" | "Level 1 to 3" | "Level 4 and Above"
 *
 * TA upgrade rule (7th CPC / Gujarat practice):
 *   Employees whose Pay Level maps to "Level 2 and Below" (incl. IS-1..IS-3)
 *   receive "Level 3-8" TA rates when Basic Pay is >= the Pay Matrix Level-1
 *   Cell 11 BasicPay (configuration-driven threshold from dbo.PayMatrixMaster).
 */

const TA_GROUPS = Object.freeze({
  LEVEL_2_AND_BELOW: "Level 2 and Below",
  LEVEL_3_TO_8: "Level 3-8",
  LEVEL_9_AND_ABOVE: "Level 9 and Above",
});

/** Pay Matrix Level "1" CellNo that holds the TA upgrade BasicPay threshold. */
const TA_UPGRADE_MATRIX_LEVEL = "1";
const TA_UPGRADE_MATRIX_CELL = 11;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePayLevelRaw(payLevel) {
  return String(payLevel == null ? "" : payLevel)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** True for Gujarat IS-1 / IS-2 / IS-3 pay levels. */
function isIsPayLevel(payLevel) {
  const raw = normalizePayLevelRaw(payLevel);
  return /^IS-?[123]$/.test(raw);
}

/**
 * Extract numeric pay level from values like "4", "Level 4", "IS-2".
 * For IS-* levels, returns the IS number (1/2/3).
 */
function parsePayLevelNumber(payLevel) {
  const raw = String(payLevel == null ? "" : payLevel).trim();
  if (!raw) return null;
  const match = raw.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map employee Pay Level → TA Master PayLevelGroup (3 allowed values).
 * Does NOT apply the Basic Pay upgrade threshold.
 */
function getPayLevelGroupFromPayLevel(payLevel) {
  if (isIsPayLevel(payLevel)) {
    return TA_GROUPS.LEVEL_2_AND_BELOW;
  }
  const levelNo = parsePayLevelNumber(payLevel);
  if (levelNo == null) {
    return TA_GROUPS.LEVEL_2_AND_BELOW;
  }
  if (levelNo <= 2) {
    return TA_GROUPS.LEVEL_2_AND_BELOW;
  }
  if (levelNo <= 8) {
    return TA_GROUPS.LEVEL_3_TO_8;
  }
  return TA_GROUPS.LEVEL_9_AND_ABOVE;
}

/**
 * Load TA Basic Pay upgrade threshold from PayMatrixMaster.
 * Source: Level "1", CellNo 11 BasicPay (same revision when available).
 */
async function loadTaBasicUpgradeThreshold(sql, payRevisionId = null) {
  if (!sql) return null;
  const revisionId =
    payRevisionId != null && Number.isFinite(Number(payRevisionId))
      ? Number(payRevisionId)
      : null;

  try {
    const preferred = await sql.query`
      SELECT TOP 1 BasicPay
      FROM dbo.PayMatrixMaster
      WHERE LTRIM(RTRIM(CAST([Level] AS NVARCHAR(50)))) = ${TA_UPGRADE_MATRIX_LEVEL}
        AND CellNo = ${TA_UPGRADE_MATRIX_CELL}
        AND (
          ${revisionId} IS NULL
          OR PayRevisionId = ${revisionId}
          OR PayRevisionId IS NULL
        )
      ORDER BY
        CASE WHEN ${revisionId} IS NOT NULL AND PayRevisionId = ${revisionId} THEN 0 ELSE 1 END,
        PayMatrixId ASC
    `;
    if (preferred.recordset[0] && preferred.recordset[0].BasicPay != null) {
      return toNum(preferred.recordset[0].BasicPay);
    }
  } catch (err) {
    console.warn("loadTaBasicUpgradeThreshold:", err.message);
  }
  return null;
}

/**
 * Transport Allowance group for Salary Entry / TA lookup / warnings.
 *
 * @param {number|string} currentBasicPay
 * @param {string|null} payLevel
 * @param {{ basicUpgradeThreshold?: number|null }} [options]
 *
 * When payLevel is provided:
 *   - Level 9+ / Level 3-8 come from Pay Level
 *   - Level 2 and Below upgrades to Level 3-8 when Basic >= PayMatrix threshold
 *
 * When payLevel is omitted (legacy callers):
 *   - Basic >= threshold → Level 3-8, else Level 2 and Below
 *   - If threshold missing, returns Level 2 and Below (no silent upgrade)
 */
function getTransportAllowanceGroup(currentBasicPay, payLevel, options = {}) {
  const basic = toNum(currentBasicPay);
  const thresholdRaw = options?.basicUpgradeThreshold;
  const threshold =
    thresholdRaw != null && Number.isFinite(Number(thresholdRaw))
      ? Number(thresholdRaw)
      : null;
  const canUpgrade = threshold != null && threshold > 0 && basic >= threshold;

  if (payLevel != null && String(payLevel).trim() !== "") {
    const fromLevel = getPayLevelGroupFromPayLevel(payLevel);
    if (fromLevel === TA_GROUPS.LEVEL_2_AND_BELOW && canUpgrade) {
      return TA_GROUPS.LEVEL_3_TO_8;
    }
    return fromLevel;
  }

  if (canUpgrade) {
    return TA_GROUPS.LEVEL_3_TO_8;
  }
  return TA_GROUPS.LEVEL_2_AND_BELOW;
}

/**
 * One common async resolver used by Salary Entry / calculation / warnings.
 * Loads PayMatrix threshold then classifies.
 */
async function resolveTransportAllowancePayLevelGroup({
  sql,
  basicPay,
  payLevel,
  payRevisionId = null,
  basicUpgradeThreshold = null,
} = {}) {
  let threshold = basicUpgradeThreshold;
  if (threshold == null && sql) {
    threshold = await loadTaBasicUpgradeThreshold(sql, payRevisionId);
  }
  return {
    payLevelGroup: getTransportAllowanceGroup(basicPay, payLevel, {
      basicUpgradeThreshold: threshold,
    }),
    basicUpgradeThreshold:
      threshold != null && Number.isFinite(Number(threshold))
        ? Number(threshold)
        : null,
  };
}

/**
 * CLA Master PayLevelGroup labels used in dbo.CLAMaster.
 * Basic Pay upgrade threshold does NOT apply to CLA.
 *
 * IS-1..IS-3 → "Level 1 to Below"
 * Level 1..3 → "Level 1 to 3"
 * Level 4+   → "Level 4 and Above"
 */
function getClaPayLevelGroup(payLevel) {
  if (isIsPayLevel(payLevel)) {
    return "Level 1 to Below";
  }
  const levelNo = parsePayLevelNumber(payLevel);
  if (levelNo == null) {
    return "Level 1 to Below";
  }
  if (levelNo <= 3) {
    return "Level 1 to 3";
  }
  return "Level 4 and Above";
}

module.exports = {
  TA_GROUPS,
  TA_UPGRADE_MATRIX_LEVEL,
  TA_UPGRADE_MATRIX_CELL,
  parsePayLevelNumber,
  isIsPayLevel,
  getPayLevelGroupFromPayLevel,
  getTransportAllowanceGroup,
  loadTaBasicUpgradeThreshold,
  resolveTransportAllowancePayLevelGroup,
  getClaPayLevelGroup,
};
