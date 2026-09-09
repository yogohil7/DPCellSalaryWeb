import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/nps-summary`;

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

/* One place that turns the filters into query parameters, so the screen
   request and the Excel export can never disagree about scope. */
function buildFilterParams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.sectionId != null && filters.sectionId !== "") {
    params.set("sectionId", String(filters.sectionId));
  }
  if (filters.month != null && filters.month !== "") {
    params.set("month", String(filters.month));
  }
  if (filters.year != null && filters.year !== "") {
    params.set("year", String(filters.year));
  }
  if (filters.salaryTime != null && filters.salaryTime !== "") {
    params.set("salaryTime", String(filters.salaryTime));
  }
  /* Salary Type is the salary CATEGORY (Regular / Old / DA Difference) —
     a different filter from Salary Time, which it never replaces. */
  if (filters.salaryType != null && filters.salaryType !== "") {
    params.set("salaryType", String(filters.salaryType));
  }
  return params;
}

export async function getNpsInstituteWiseSummary(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}/institute-wise?${buildFilterParams(filters).toString()}`
  );
  return parseResponse(response);
}

/**
 * Download the report as a real .xlsx, built by the backend from the SAME
 * report builder the screen uses, so rows, order and totals always agree.
 */
export async function downloadNpsInstituteWiseExcel(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}/institute-wise/export.xlsx?${buildFilterParams(filters).toString()}`
  );

  if (!response.ok) {
    let message = `Export failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      /* non-JSON error body */
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();

  let fileName = "NPS Institute Wise Summary.xlsx";
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match) fileName = match[1];

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
