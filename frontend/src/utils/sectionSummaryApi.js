import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/section-summary`;

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

/* One place that turns the current filters into query parameters, so the
   screen request and the Excel export can never disagree about scope. */
function buildFilterParams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.month != null && filters.month !== "") {
    params.set("month", String(filters.month));
  }
  if (filters.year != null && filters.year !== "") {
    params.set("year", String(filters.year));
  }
  if (filters.sectionId != null && filters.sectionId !== "") {
    params.set("sectionId", String(filters.sectionId));
  }
  if (filters.table != null && filters.table !== "" && String(filters.table).toUpperCase() !== "ALL") {
    params.set("table", String(filters.table));
  }
  return params;
}

export async function getSectionSummary(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}?${buildFilterParams(filters).toString()}`
  );
  return parseResponse(response);
}

/**
 * Download the Section Summary as a real .xlsx, built by the backend from the SAME
 * report builder the screen uses, so rows, order and total always agree.
 */
export async function downloadSectionSummaryExcel(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}/export.xlsx?${buildFilterParams(filters).toString()}`
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

  let fileName = "Section Summary.xlsx";
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
