import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/salary-components`;
const SALARY_API = `${API_BASE_URL}/api/salary`;

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

export async function listSalaryComponents(activeOnly = false) {
  const q = activeOnly ? "?active=1" : "";
  const response = await apiFetch(`${API_BASE}${q}`);
  return asList(await parseResponse(response));
}

export async function updateSalaryComponent(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function listSalaryComponentRules(salaryComponentId) {
  const q = salaryComponentId
    ? `?salaryComponentId=${encodeURIComponent(salaryComponentId)}`
    : "";
  const response = await apiFetch(`${API_BASE}/rules/list${q}`);
  return asList(await parseResponse(response));
}

export async function createSalaryComponentRule(payload, user) {
  const response = await apiFetch(`${API_BASE}/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updateSalaryComponentRule(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function deleteSalaryComponentRule(id, user) {
  const response = await apiFetch(`${API_BASE}/rules/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}

export async function calculateSalary(payload, user) {
  const response = await apiFetch(`${SALARY_API}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function saveCalculatedSalary(payload, user) {
  const response = await apiFetch(`${SALARY_API}/save-calculated`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}
