import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";

const API_BASE = `${API_BASE_URL}/api/nps-schedule`;

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

function buildFilterParams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.sectionId != null && filters.sectionId !== "") {
    params.set("sectionId", String(filters.sectionId));
  }
  if (filters.instituteCode != null && filters.instituteCode !== "") {
    params.set("instituteCode", String(filters.instituteCode));
  }
  if (filters.allMonths) {
    params.set("allMonths", "1");
  } else {
    if (filters.month != null && filters.month !== "") {
      params.set("month", String(filters.month));
    }
    if (filters.year != null && filters.year !== "") {
      params.set("year", String(filters.year));
    }
  }
  if (filters.billType != null && filters.billType !== "") {
    params.set("billType", String(filters.billType));
  }
  return params;
}

export async function getNpsSchedule(filters = {}) {
  const response = await apiFetch(
    `${API_BASE}?${buildFilterParams(filters).toString()}`
  );
  return parseResponse(response);
}

/**
 * Download the NPS Schedule Summary as a real .xlsx, built by the backend from
 * the SAME report builder the screen uses, through the SAME filter params, so
 * rows and totals always agree.
 */
export async function downloadNpsScheduleExcel(filters = {}) {
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
  let fileName = "NPS Schedule Summary.xlsx";
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

/*
  No save helper: NPS Schedule Summary is a report and never creates or
  updates a schedule. The read helpers below remain for viewing any
  historical schedules the application already holds.
*/

export async function listSavedNpsSchedules(filters = {}) {
  const params = new URLSearchParams();
  if (filters.billType) params.set("billType", String(filters.billType));
  if (filters.salaryMonthKey) {
    params.set("salaryMonthKey", String(filters.salaryMonthKey));
  }
  const response = await apiFetch(`${API_BASE}/saved?${params.toString()}`);
  return parseResponse(response);
}

export async function getSavedNpsSchedule(scheduleId) {
  const response = await apiFetch(`${API_BASE}/saved/${scheduleId}`);
  return parseResponse(response);
}
