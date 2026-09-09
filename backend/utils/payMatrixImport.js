const XLSX = require("xlsx");

/** Preferred template columns (PayRevision comes from UI selection). */
const PREFERRED_HEADERS = ["Level", "CellNo", "BasicPay", "EffectiveDate"];

/** Still accepted for backward compatibility. */
const OPTIONAL_HEADERS = ["PayRevisionCode"];

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

const HEADER_MAP = {
  payrevisioncode: "PayRevisionCode",
  revisioncode: "PayRevisionCode",
  payrevision: "PayRevisionCode",
  payrevisionid: "PayRevisionCode",
  level: "Level",
  paylevel: "Level",
  cellno: "CellNo",
  cell: "CellNo",
  cellnumber: "CellNo",
  paymatrixcell: "CellNo",
  paymatrixcellno: "CellNo",
  basicpay: "BasicPay",
  basic: "BasicPay",
  effectivedate: "EffectiveDate",
  effectivedt: "EffectiveDate",
  date: "EffectiveDate",
};

function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const utc = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize Excel Level values to a trimmed string.
 * Preserves alphanumeric codes exactly (e.g. IS-1, IS-2).
 * Does NOT convert "IS-1" → "1".
 *
 * Accepts:
 *   "IS-1", " IS-1 ", "IS-2"
 *   1, 1.0, "1", "1.0"  (legacy numeric → string "1")
 */
function parsePayMatrixLevel(value) {
  if (value == null || value === "") {
    return { error: "Level is required.", original: value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { error: "Level is invalid.", original: value };
    }
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) > 1e-9) {
      return {
        error: `Level is invalid (got ${value}).`,
        original: value,
      };
    }
    if (rounded < 1) {
      return { error: "Level is invalid.", original: value };
    }
    return { value: String(rounded), original: value };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      error: "Level is invalid (date value).",
      original: value,
    };
  }

  /* Collapse internal whitespace; trim ends. Preserve IS- prefix and hyphens. */
  let raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw) {
    return { error: "Level is required.", original: value };
  }

  /* Pure numeric string (incl. "1.0") → canonical integer string */
  if (/^\d+(\.0+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      return { error: "Level is invalid.", original: value };
    }
    return { value: String(Math.round(n)), original: value };
  }

  /* Alphanumeric Level codes: IS-1, IS-2, L1, etc. Keep as-is (trimmed). */
  if (raw.length > 50) {
    return {
      error: "Level exceeds maximum length (50).",
      original: value,
    };
  }

  return { value: raw, original: value };
}

/**
 * Normalize Excel CellNo to a positive integer.
 */
function parsePayMatrixCellNo(value) {
  if (value == null || value === "") {
    return { error: "CellNo is required.", original: value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { error: "CellNo is invalid.", original: value };
    }
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) > 1e-9) {
      return { error: `CellNo is invalid (got ${value}).`, original: value };
    }
    if (rounded < 1) {
      return { error: "CellNo must be a positive integer.", original: value };
    }
    return { value: rounded, original: value };
  }

  let raw = String(value).trim();
  if (!raw) {
    return { error: "CellNo is required.", original: value };
  }
  raw = raw.replace(/^(cell|cellno|cell\s*no\.?)\s*/i, "").trim();
  raw = raw.replace(/,/g, "");

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return {
      error: `CellNo is invalid (got "${String(value).trim()}").`,
      original: value,
    };
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { error: "CellNo is invalid.", original: value };
  }
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > 1e-9 || rounded < 1) {
    return {
      error: `CellNo is invalid (got "${String(value).trim()}").`,
      original: value,
    };
  }
  return { value: rounded, original: value };
}

/**
 * Normalize BasicPay to decimal.
 * Accepts: 18000, 18000.00, "18,000", "18000", "18,000.00"
 */
function parseBasicPay(value) {
  if (value == null || value === "") {
    return { error: "BasicPay is required.", original: value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { error: "BasicPay is invalid.", original: value };
    }
    return { value: Number(value.toFixed(2)), original: value };
  }

  let raw = String(value).trim();
  if (!raw) {
    return { error: "BasicPay is required.", original: value };
  }
  /* Remove currency symbols and spaces, keep digits/dot/comma */
  raw = raw.replace(/[₹$€£\s]/g, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return {
      error: `BasicPay must be numeric (got "${String(value).trim()}").`,
      original: value,
    };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { error: "BasicPay is invalid.", original: value };
  }
  return { value: Number(n.toFixed(2)), original: value };
}

function parseEffectiveDate(value) {
  if (value == null || value === "") {
    return { error: "EffectiveDate is required.", original: value };
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { value: value.toISOString().slice(0, 10), original: value };
  }
  if (typeof value === "number") {
    const iso = excelSerialToDate(value);
    if (!iso) return { error: "EffectiveDate is invalid.", original: value };
    return { value: iso, original: value };
  }

  const raw = String(value).trim();
  if (!raw) return { error: "EffectiveDate is required.", original: value };

  /* YYYY-MM-DD or YYYY/MM/DD */
  let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (
      d.getUTCFullYear() !== yyyy ||
      d.getUTCMonth() !== mm - 1 ||
      d.getUTCDate() !== dd
    ) {
      return { error: "EffectiveDate is invalid.", original: value };
    }
    return {
      value: `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
      original: value,
    };
  }

  /* DD-MM-YYYY or DD/MM/YYYY */
  m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy = Number(m[3]);
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (
      d.getUTCFullYear() !== yyyy ||
      d.getUTCMonth() !== mm - 1 ||
      d.getUTCDate() !== dd
    ) {
      return { error: "EffectiveDate is invalid.", original: value };
    }
    return {
      value: `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
      original: value,
    };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return { value: parsed.toISOString().slice(0, 10), original: value };
  }
  return { error: "EffectiveDate is invalid.", original: value };
}

function readWorkbookRows(buffer, { debug = false } = {}) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw Object.assign(new Error("Excel file has no worksheets."), {
      status: 400,
    });
  }
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  if (!rawRows.length) {
    throw Object.assign(new Error("Excel file is empty."), { status: 400 });
  }

  const headerRow = rawRows[0].map((h) => normalizeHeader(h));
  const mappedIndexes = {};
  for (let i = 0; i < headerRow.length; i += 1) {
    const key = HEADER_MAP[headerRow[i]];
    if (key) mappedIndexes[key] = i;
  }

  const missingPreferred = PREFERRED_HEADERS.filter(
    (h) => mappedIndexes[h] == null
  );
  if (missingPreferred.length) {
    throw Object.assign(
      new Error(
        `Missing required columns: ${missingPreferred.join(", ")}. Expected: ${PREFERRED_HEADERS.join(", ")}`
      ),
      { status: 400 }
    );
  }

  if (debug) {
    console.log("[PayMatrixImport] Sheet:", sheetName);
    console.log("[PayMatrixImport] Headers:", rawRows[0]);
    console.log("[PayMatrixImport] Mapped indexes:", mappedIndexes);
    for (let i = 1; i <= Math.min(10, rawRows.length - 1); i += 1) {
      const line = rawRows[i] || [];
      const levelRaw = line[mappedIndexes.Level];
      const cellRaw = line[mappedIndexes.CellNo];
      const basicRaw = line[mappedIndexes.BasicPay];
      console.log("[PayMatrixImport] Sample row", i + 1, {
        levelRaw,
        levelType: typeof levelRaw,
        levelParsed: parsePayMatrixLevel(levelRaw),
        cellRaw,
        cellType: typeof cellRaw,
        cellParsed: parsePayMatrixCellNo(cellRaw),
        basicRaw,
        basicType: typeof basicRaw,
        basicParsed: parseBasicPay(basicRaw),
        effectiveRaw: line[mappedIndexes.EffectiveDate],
      });
    }
  }

  const rows = [];
  for (let r = 1; r < rawRows.length; r += 1) {
    const line = rawRows[r] || [];
    const isEmpty = line.every((cell) => String(cell ?? "").trim() === "");
    if (isEmpty) continue;
    rows.push({
      excelRow: r + 1,
      PayRevisionCode:
        mappedIndexes.PayRevisionCode != null
          ? line[mappedIndexes.PayRevisionCode]
          : "",
      Level: line[mappedIndexes.Level],
      CellNo: line[mappedIndexes.CellNo],
      BasicPay: line[mappedIndexes.BasicPay],
      EffectiveDate: line[mappedIndexes.EffectiveDate],
    });
  }
  return { sheetName, rows, headers: rawRows[0] };
}

/**
 * @param {Array} rawRows
 * @param {object} options
 * @param {number} options.selectedPayRevisionId - authoritative PayRevisionId from UI
 * @param {Map} [options.revisionByCode] - optional map for Excel PayRevisionCode fallback
 */
function validateImportRows(rawRows, options = {}) {
  const {
    selectedPayRevisionId = null,
    revisionByCode = new Map(),
  } = options;

  const errors = [];
  const valid = [];
  const seen = new Set();
  const selectedId = Number(selectedPayRevisionId);

  for (const row of rawRows) {
    const excelRow = row.excelRow;

    let payRevisionId = null;
    let payRevisionCode = "";

    if (Number.isFinite(selectedId) && selectedId > 0) {
      payRevisionId = selectedId;
      payRevisionCode =
        String(row.PayRevisionCode || "").trim().toUpperCase() || "";
    } else {
      const code = String(row.PayRevisionCode || "").trim().toUpperCase();
      if (!code) {
        errors.push({
          row: excelRow,
          field: "PayRevision",
          value: row.PayRevisionCode,
          message:
            "Pay Revision must be selected on the import screen (or provide PayRevisionCode in Excel).",
        });
        continue;
      }
      const revision = revisionByCode.get(code);
      if (!revision) {
        errors.push({
          row: excelRow,
          field: "PayRevisionCode",
          value: code,
          message: `Pay Revision ${code} does not exist.`,
        });
        continue;
      }
      payRevisionId = Number(revision.PayRevisionId);
      payRevisionCode = code;
    }

    const levelResult = parsePayMatrixLevel(row.Level);
    if (levelResult.error) {
      errors.push({
        row: excelRow,
        field: "Level",
        value: levelResult.original,
        message: levelResult.error,
      });
      continue;
    }

    const cellResult = parsePayMatrixCellNo(row.CellNo);
    if (cellResult.error) {
      errors.push({
        row: excelRow,
        field: "CellNo",
        value: cellResult.original,
        message: cellResult.error,
      });
      continue;
    }

    const basicResult = parseBasicPay(row.BasicPay);
    if (basicResult.error) {
      errors.push({
        row: excelRow,
        field: "BasicPay",
        value: basicResult.original,
        message: basicResult.error,
      });
      continue;
    }

    const dateResult = parseEffectiveDate(row.EffectiveDate);
    if (dateResult.error) {
      errors.push({
        row: excelRow,
        field: "EffectiveDate",
        value: dateResult.original,
        message: dateResult.error,
      });
      continue;
    }

    const level = levelResult.value;
    const cellNo = cellResult.value;
    const key = `${payRevisionId}|${level}|${cellNo}`;
    if (seen.has(key)) {
      errors.push({
        row: excelRow,
        field: "Level/CellNo",
        value: `${level}/${cellNo}`,
        message: `Duplicate Level + CellNo (${level}/${cellNo}) inside Excel.`,
      });
      continue;
    }
    seen.add(key);

    valid.push({
      excelRow,
      payRevisionId,
      payRevisionCode,
      level,
      cellNo,
      basicPay: basicResult.value,
      effectiveDate: dateResult.value,
      status: "VALID",
    });
  }

  return { errors, valid };
}

function buildTemplateWorkbook() {
  const rows = [
    ["Level", "CellNo", "BasicPay", "EffectiveDate"],
    ["IS-1", 1, 18000, "2016-01-01"],
    ["IS-1", 2, 18500, "2016-01-01"],
    ["IS-1", 3, 19100, "2016-01-01"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "PayMatrix");
  return workbook;
}

module.exports = {
  PREFERRED_HEADERS,
  OPTIONAL_HEADERS,
  REQUIRED_HEADERS: PREFERRED_HEADERS,
  parsePayMatrixLevel,
  parsePayMatrixCellNo,
  parseBasicPay,
  parseEffectiveDate,
  readWorkbookRows,
  validateImportRows,
  buildTemplateWorkbook,
};
