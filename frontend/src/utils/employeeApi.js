import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/employees`;

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
      user?.fullName || user?.name || user?.userName || user?.username || "SYSTEM",
  };
}

export async function listEmployees() {
  const response = await apiFetch(API_BASE);
  return asList(await parseResponse(response));
}

export async function getNextEmployeeId() {
  const response = await apiFetch(`${API_BASE}/next-id`);
  const result = await parseResponse(response);
  return (
    result?.employeeId ??
    result?.data?.employeeId ??
    null
  );
}

export async function createEmployee(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updateEmployee(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function getEmployeePayHistory(id) {
  const response = await apiFetch(`${API_BASE}/${id}/pay-history`);
  return asList(await parseResponse(response));
}
