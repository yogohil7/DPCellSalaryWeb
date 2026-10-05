/**
 * Natural Institute Code sorting for presentation dropdowns.
 *
 * Institute Codes look like "PREFIX-01", "PREFIX-18" — a text prefix
 * plus a numeric portion. Plain lexicographical sorting happens to work for
 * zero-padded two-digit codes but breaks for unpadded / multi-digit codes
 * ("ABC-2" vs "ABC-10"), so this comparator tokenises each code into
 * alternating non-numeric / numeric runs and compares:
 *   1. prefix (non-numeric tokens, case-insensitive),
 *   2. numeric portion (as numbers, so 9 < 10),
 *   3. the full code as the final deterministic tie-breaker.
 *
 * Nothing is hard-coded about any specific prefix — any future code shape works,
 * including codes with no digits at all (they compare alphabetically).
 *
 * NOTE: InstituteId is deliberately NOT used here. Presentation order for
 * the Salary Entry dropdown is InstituteCode order only.
 */

export function tokeniseInstituteCode(code) {
  const text = String(code || "");
  const runs = text.match(/\d+|\D+/g) || [text];
  return runs.map((run) =>
    /^\d+$/.test(run)
      ? { numeric: true, number: Number(run) }
      : { numeric: false, text: run.toUpperCase() }
  );
}

export function compareInstituteCodes(a, b) {
  const codeA = String(a || "");
  const codeB = String(b || "");
  if (codeA === codeB) return 0;

  const tokensA = tokeniseInstituteCode(codeA);
  const tokensB = tokeniseInstituteCode(codeB);
  const length = Math.max(tokensA.length, tokensB.length);

  for (let index = 0; index < length; index += 1) {
    const tokenA = tokensA[index];
    const tokenB = tokensB[index];
    /* A shorter code sorts first when all shared tokens are equal. */
    if (!tokenA) return -1;
    if (!tokenB) return 1;
    if (tokenA.numeric && tokenB.numeric) {
      if (tokenA.number !== tokenB.number) {
        return tokenA.number - tokenB.number;
      }
    } else if (!tokenA.numeric && !tokenB.numeric) {
      if (tokenA.text !== tokenB.text) {
        return tokenA.text < tokenB.text ? -1 : 1;
      }
    } else {
      /* Numeric run sorts before a non-numeric run at the same position. */
      return tokenA.numeric ? -1 : 1;
    }
  }

  /* All tokens equal (e.g. zero-padded "XX-01" vs unpadded "XX-1") — full code breaks the tie. */
  if (codeA === codeB) return 0;
  return codeA < codeB ? -1 : 1;
}

/**
 * Sort a list of institute-like rows by their code without mutating it.
 * getCode defaults to the common row shapes (instituteCode / code).
 */
export function sortInstitutesByCode(rows, getCode) {
  const readCode =
    typeof getCode === "function"
      ? getCode
      : (row) => row?.instituteCode || row?.code || "";
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    compareInstituteCodes(readCode(a), readCode(b))
  );
}
