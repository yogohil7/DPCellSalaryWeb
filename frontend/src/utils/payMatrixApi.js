import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/pay-matrix`;

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

export async function listPayMatrix(payRevisionId, active = true) {
  const params = new URLSearchParams();
  if (payRevisionId) params.set("payRevisionId", String(payRevisionId));
  params.set("active", active ? "1" : "0");
  const response = await apiFetch(`${API_BASE}?${params}`);
  return asList(await parseResponse(response));
}

export async function listPayLevels(payRevisionId) {
  const response = await apiFetch(
    `${API_BASE}/levels?payRevisionId=${encodeURIComponent(payRevisionId)}`
  );
  return asList(await parseResponse(response));
}

export async function listPayCells(payRevisionId, level) {
  const response = await apiFetch(
    `${API_BASE}/cells?payRevisionId=${encodeURIComponent(payRevisionId)}&level=${encodeURIComponent(level)}`
  );
  return asList(await parseResponse(response));
}

export async function getBasicPay(payRevisionId, level, cellNo) {
  const response = await apiFetch(
    `${API_BASE}/basic-pay?payRevisionId=${encodeURIComponent(payRevisionId)}&level=${encodeURIComponent(level)}&cellNo=${encodeURIComponent(cellNo)}`
  );
  const result = await parseResponse(response);
  return result.data;
}

export async function createPayMatrix(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updatePayMatrix(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function deletePayMatrix(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}

export async function downloadPayMatrixTemplate() {
  const response = await apiFetch(`${API_BASE}/template`);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data?.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "PayMatrix_Import_Template.xls";
  link.click();
  URL.revokeObjectURL(url);
}

export async function importPayMatrixExcel(file, user, payRevisionId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("payRevisionId", String(payRevisionId || ""));
  formData.append("userName", user?.userName || user?.username || "SYSTEM");
  formData.append(
    "fullName",
    user?.fullName || user?.name || user?.userName || user?.username || "SYSTEM"
  );

  const response = await apiFetch(`${API_BASE}/import`, {
    method: "POST",
    body: formData,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Import failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
