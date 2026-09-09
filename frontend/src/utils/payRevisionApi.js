import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/pay-revisions`;

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

export async function listPayRevisions() {
  const response = await apiFetch(API_BASE);
  return asList(await parseResponse(response));
}

export async function listActivePayRevisions() {
  const response = await apiFetch(`${API_BASE}?active=1`);
  return asList(await parseResponse(response));
}

export async function getPayRevision(id) {
  const response = await apiFetch(`${API_BASE}/${id}`);
  const result = await parseResponse(response);
  return result.data;
}

export async function createPayRevision(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updatePayRevision(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function setPayRevisionStatus(id, status, user) {
  const response = await apiFetch(`${API_BASE}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({ status }, user)),
  });
  return parseResponse(response);
}

export async function deletePayRevision(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}
