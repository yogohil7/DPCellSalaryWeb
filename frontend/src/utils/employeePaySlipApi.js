import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/employee-pay-slip`;

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

/* One place that turns the current selection into query parameters, so the
   option lookup and the Pay Slip request can never disagree about scope. */
function buildFilterParams(filters = {}) {
  const params = new URLSearchParams();
  const set = (key) => {
    const value = filters[key];
    if (value != null && value !== "") params.set(key, String(value));
  };
  ["month", "year", "sectionId", "instituteCode", "billCodeId", "employeeId"]
    .forEach(set);
  return params;
}

/** Cascading filter options, built from the same approved rows as the slips. */
export async function getPaySlipOptions(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}/options?${buildFilterParams(filters).toString()}`
  );
  return parseResponse(response);
}

/**
 * The Pay Slip(s) for a selection.
 * Omitting employeeId returns every employee of the bill — the bulk print.
 */
export async function getPaySlips(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}?${buildFilterParams(filters).toString()}`
  );
  return parseResponse(response);
}
