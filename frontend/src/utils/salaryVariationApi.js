import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/salary-variation`;

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

export async function getSalaryVariationReport({
  previousBillCode,
  currentBillCode,
  instituteId,
  instituteCode,
}) {
  const params = new URLSearchParams();
  params.set("previousBillCode", previousBillCode);
  params.set("currentBillCode", currentBillCode);
  if (instituteId) params.set("instituteId", String(instituteId));
  if (instituteCode) params.set("instituteCode", String(instituteCode));

  const response = await apiFetch(`${API_BASE}?${params}`);
  return parseResponse(response);
}
