import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
/**
 * Employee Increment API client. SQL Server backed; no localStorage.
 */

const API_BASE = `${API_BASE_URL}/api/employee-increment`;

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

export async function listIncrements({ employeeId, instituteCode, status } = {}) {
  const params = new URLSearchParams();
  if (employeeId) params.set("employeeId", String(employeeId));
  if (instituteCode) params.set("instituteCode", instituteCode);
  if (status) params.set("status", status);
  const response = await apiFetch(`${API_BASE}?${params.toString()}`, {
    cache: "no-store",
  });
  return asList(await parseResponse(response));
}

export async function getEmployeeIncrements(employeeId) {
  const response = await apiFetch(`${API_BASE}/employee/${employeeId}`, {
    cache: "no-store",
  });
  return asList(await parseResponse(response));
}

/** Full history including cancelled rows — history is never destroyed. */
export async function getIncrementHistory(employeeId) {
  const response = await apiFetch(`${API_BASE}/history/${employeeId}`, {
    cache: "no-store",
  });
  return parseResponse(response);
}

/** Preview only — writes nothing. */
export async function calculateIncrement(payload, user) {
  const response = await apiFetch(`${API_BASE}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function createIncrement(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updateIncrement(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function cancelIncrement(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}
