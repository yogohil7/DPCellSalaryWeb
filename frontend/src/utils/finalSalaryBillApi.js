import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/salary-bill`;

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

/* Distinct institutes holding salary rows in a salary month (read-only). */
export async function listFinalBillInstitutes({ salaryYear, salaryMonthNumber }) {
  const params = new URLSearchParams();
  if (salaryYear) params.set("salaryYear", String(salaryYear));
  if (salaryMonthNumber != null && salaryMonthNumber !== "") {
    params.set("salaryMonthNumber", String(salaryMonthNumber));
  }
  const response = await apiFetch(`${API_BASE}/institutes?${params}`);
  const result = await parseResponse(response);
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

export async function getFinalSalaryBill(
  { billCode, instituteId, instituteCode },
  user
) {
  const params = new URLSearchParams();
  if (instituteId) params.set("instituteId", String(instituteId));
  if (instituteCode) params.set("instituteCode", String(instituteCode));
  if (user?.userName || user?.username) {
    params.set("userName", user.userName || user.username);
  }
  if (user?.fullName || user?.name) {
    params.set("fullName", user.fullName || user.name);
  }

  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(billCode)}?${params}`
  );
  return parseResponse(response);
}
