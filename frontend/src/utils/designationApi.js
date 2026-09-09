import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/designations`;

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
  };
}

/** Active designations for Employee Master dropdown */
export async function listActiveDesignations() {
  const response = await apiFetch(API_BASE);
  const result = await parseResponse(response);
  return asList(result);
}

/** All designations for Designation Master grid */
export async function listAllDesignations() {
  const response = await apiFetch(`${API_BASE}?all=1`);
  const result = await parseResponse(response);
  return asList(result);
}

export async function createDesignation(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updateDesignation(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function deleteDesignation(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}
