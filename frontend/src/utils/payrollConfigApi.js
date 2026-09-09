import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/employee-payroll-config`;

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
    userId: user?.userId || user?.id || null,
    userName: user?.userName || user?.username || "SYSTEM",
    fullName:
      user?.fullName || user?.name || user?.userName || user?.username || "SYSTEM",
    roleName: user?.roleName || user?.role || "",
  };
}

export async function searchEmployeesForPayroll(q) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const response = await apiFetch(`${API_BASE}/search-employees?${params}`);
  return asList(await parseResponse(response));
}

export async function getPayrollConfigByEmployee(employeeId, asOf) {
  const params = new URLSearchParams();
  if (asOf) params.set("asOf", asOf);
  const qs = params.toString();
  const response = await apiFetch(
    `${API_BASE}/by-employee/${employeeId}${qs ? `?${qs}` : ""}`
  );
  const result = await parseResponse(response);
  return result.data;
}

export async function listPayrollConfigs(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== "") {
      params.set(key, value);
    }
  });
  const response = await apiFetch(`${API_BASE}?${params}`);
  return asList(await parseResponse(response));
}

export async function getPayrollConfig(id) {
  const response = await apiFetch(`${API_BASE}/${id}`);
  const result = await parseResponse(response);
  return result.data;
}

export async function savePayrollConfig(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updatePayrollConfig(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function deactivatePayrollConfig(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}/deactivate`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}
