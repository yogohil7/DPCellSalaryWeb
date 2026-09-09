import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
/**
 * DA Difference API client.
 * Every call goes to SQL Server through the backend. Nothing is cached in
 * localStorage and no amount is ever calculated in the browser.
 */

const API_BASE = `${API_BASE_URL}/api/da-difference`;

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      data?.message || `Request failed (${response.status})`
    );
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
      user?.fullName || user?.name || user?.userName || user?.username || "SYSTEM",
    userId: user?.userId ?? user?.id ?? null,
  };
}

export async function listDaDifferenceBills() {
  const response = await apiFetch(API_BASE, { cache: "no-store" });
  return asList(await parseResponse(response));
}

export async function getDaDifferenceBill(id) {
  const response = await apiFetch(`${API_BASE}/${id}`, { cache: "no-store" });
  return parseResponse(response);
}

export async function createDaDifferenceBill(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updateDaDifferenceBill(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

/** Preview only — the backend writes nothing for this call. */
export async function calculateDaDifference(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function saveDaDifference(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function submitDaDifference(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

/** The SAVED snapshot, read back exactly as stored. */
export async function getDaDifferenceDetail(id, { instituteCode, instituteId }) {
  const params = new URLSearchParams();
  if (instituteCode) params.set("instituteCode", instituteCode);
  if (instituteId) params.set("instituteId", String(instituteId));
  const response = await apiFetch(`${API_BASE}/${id}/detail?${params.toString()}`, {
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function getDaDifferenceMonthLock({
  year,
  monthNumber,
  month,
}) {
  const params = new URLSearchParams();
  if (year != null) params.set("year", String(year));
  if (monthNumber != null) params.set("monthNumber", String(monthNumber));
  if (month) params.set("month", String(month));
  const response = await apiFetch(
    `${API_BASE}/month-lock?${params.toString()}`,
    { cache: "no-store" }
  );
  const result = await parseResponse(response);
  return result?.data || result;
}

export async function lockDaDifferenceMonth(payload, user) {
  const response = await apiFetch(`${API_BASE}/month-lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}
