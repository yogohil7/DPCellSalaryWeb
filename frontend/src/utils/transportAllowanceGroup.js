/**
 * Pay Level Group resolution for allowance lookups (frontend mirror).
 * Salary Entry TA amounts/groups come from the backend; this mirror keeps
 * client-side helpers consistent when a PayMatrix threshold is supplied.
 */

export const TA_GROUPS = Object.freeze({
  LEVEL_2_AND_BELOW: "Level 2 and Below",
  LEVEL_3_TO_8: "Level 3-8",
  LEVEL_9_AND_ABOVE: "Level 9 and Above",
});

export const TA_UPGRADE_MATRIX_LEVEL = "1";
export const TA_UPGRADE_MATRIX_CELL = 11;

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

export function isIsPayLevel(payLevel) {
  const raw = normalizePayLevelRaw(payLevel);
  return /^IS-?[123]$/.test(raw);
}

export function parsePayLevelNumber(payLevel) {
  const raw = String(payLevel == null ? "" : payLevel).trim();
  if (!raw) return null;
  const match = raw.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function getPayLevelGroupFromPayLevel(payLevel) {
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
 * @param {number|string} currentBasicPay
 * @param {string|null} payLevel
 * @param {{ basicUpgradeThreshold?: number|null }} [options]
 *        Pass PayMatrix Level-1 Cell-11 BasicPay from API/config — do not hard-code.
 */
export function getTransportAllowanceGroup(currentBasicPay, payLevel, options = {}) {
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

/** CLA uses existing CLAMaster labels; Basic Pay upgrade does not apply. */
export function getClaPayLevelGroup(payLevel) {
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
