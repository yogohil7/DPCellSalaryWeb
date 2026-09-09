import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/salary-entry`;

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function asList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function withActor(payload, user) {
  return {
    ...payload,
    userName: user?.userName || user?.username || "SYSTEM",
    fullName:
      user?.fullName ||
      user?.name ||
      user?.userName ||
      user?.username ||
      "SYSTEM",
    userId: user?.userId ?? user?.id ?? null,
    roleName: user?.roleName || user?.role || "",
  };
}

/**
 * Bill Code dropdown source for Salary Entry.
 * Always fetched fresh from SQL Server; the API returns ONLY Status = 'OPEN'.
 * Never cache this in localStorage - stale codes must not appear.
 */
export async function listOpenSalaryEntryBillCodes() {
  const response = await apiFetch(`${API_BASE}/bill-codes`, {
    cache: "no-store",
  });
  const result = await parseResponse(response);
  return asList(result);
}

export async function getSalaryEntryEmployees({
  billCode,
  instituteId,
  instituteCode,
  sectionId,
  billMonth,
  salaryMonth,
}) {
  const params = new URLSearchParams();
  params.set("billCode", billCode);
  if (instituteId) params.set("instituteId", String(instituteId));
  if (instituteCode) params.set("instituteCode", String(instituteCode));
  if (sectionId) params.set("sectionId", String(sectionId));
  if (billMonth) params.set("billMonth", String(billMonth));
  if (salaryMonth) params.set("salaryMonth", String(salaryMonth));
  const response = await apiFetch(`${API_BASE}/employees?${params}`);
  return parseResponse(response);
}

export async function calculateSalaryEntry(payload, user) {
  const response = await apiFetch(`${API_BASE}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function saveSalaryEntryDraft(payload, user) {
  const response = await apiFetch(`${API_BASE}/save-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function submitSalaryEntry(payload, user) {
  const response = await apiFetch(`${API_BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function recalculateTransportAllowance(payload, user) {
  const response = await apiFetch(`${API_BASE}/transport-allowance`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

/** Read-only, institute-scoped comparison of the saved Salary Entry snapshot. */
export async function getSalaryEntryVariationReport({
  billCode,
  instituteCode,
  salaryMonth,
  previousBillCode,
  compareMode,
}) {
  const params = new URLSearchParams();
  params.set("billCode", billCode);
  params.set("instituteCode", instituteCode);
  if (salaryMonth) params.set("salaryMonth", salaryMonth);
  if (previousBillCode) params.set("previousBillCode", previousBillCode);
  if (compareMode) params.set("compareMode", compareMode);
  const response = await apiFetch(`${API_BASE}/variation-report?${params}`);
  return parseResponse(response);
}

export { asList };
