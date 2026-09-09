import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/dashboard`;

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

export async function getDashboardSummary() {
  const response = await apiFetch(`${API_BASE}/summary`);
  return parseResponse(response);
}
