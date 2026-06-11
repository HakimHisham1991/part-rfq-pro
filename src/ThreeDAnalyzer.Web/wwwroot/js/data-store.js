/**
 * Data access via REST API (SQLite backend).
 */

async function apiGet(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
}

export async function getProjects() {
  return apiGet('/api/projects');
}

export async function getProject(id) {
  try {
    return await apiGet(`/api/projects/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function getPartsForProject(projectId) {
  return apiGet(`/api/projects/${encodeURIComponent(projectId)}/parts`);
}

export async function getPart(projectId, partId) {
  try {
    return await apiGet(
      `/api/projects/${encodeURIComponent(projectId)}/parts/${encodeURIComponent(partId)}`
    );
  } catch {
    return null;
  }
}

export async function savePartCycleData(projectId, partId, cycleTimeData) {
  const body =
    cycleTimeData.version === 2
      ? {
          version: 2,
          operations: cycleTimeData.operations,
          other: cycleTimeData.other,
          rawMaterial: cycleTimeData.rawMaterial,
          finishPart: cycleTimeData.finishPart,
          model3d: cycleTimeData.model3d,
          computed: cycleTimeData.computed,
          updatedAt: cycleTimeData.updatedAt
        }
      : {
          values: cycleTimeData.values,
          updatedAt: cycleTimeData.updatedAt
        };

  await apiPut(
    `/api/projects/${encodeURIComponent(projectId)}/parts/${encodeURIComponent(partId)}/cycle-time`,
    body
  );
  return true;
}

export async function getPartCycleData(projectId, partId) {
  const res = await apiGet(
    `/api/projects/${encodeURIComponent(projectId)}/parts/${encodeURIComponent(partId)}/cycle-time`
  );
  return res.cycleTimeData ?? null;
}

export async function getUsers() {
  return apiGet('/api/users');
}

export async function createUser(payload) {
  return apiPost('/api/users', payload);
}

export async function updateUser(id, payload) {
  await apiPut(`/api/users/${encodeURIComponent(id)}`, payload);
}

export async function deleteUser(id) {
  await apiDelete(`/api/users/${encodeURIComponent(id)}`);
}

export async function getMaterialSpecs() {
  return apiGet('/api/material-specs');
}

export async function createMaterialSpec(payload) {
  return apiPost('/api/material-specs', payload);
}

export async function updateMaterialSpec(id, payload) {
  await apiPut(`/api/material-specs/${encodeURIComponent(id)}`, payload);
}

export async function deleteMaterialSpec(id) {
  await apiDelete(`/api/material-specs/${encodeURIComponent(id)}`);
}

export async function getOperationTemplates() {
  return apiGet('/api/operation-templates');
}

export async function createOperationTemplate(payload) {
  return apiPost('/api/operation-templates', payload);
}

export async function updateOperationTemplate(id, payload) {
  await apiPut(`/api/operation-templates/${encodeURIComponent(id)}`, payload);
}

export async function deleteOperationTemplate(id) {
  await apiDelete(`/api/operation-templates/${encodeURIComponent(id)}`);
}

export async function getMachineProfiles() {
  return apiGet('/api/machine-profiles');
}

export async function createMachineProfile(payload) {
  return apiPost('/api/machine-profiles', payload);
}

export async function updateMachineProfile(id, payload) {
  await apiPut(`/api/machine-profiles/${encodeURIComponent(id)}`, payload);
}

export async function deleteMachineProfile(id) {
  await apiDelete(`/api/machine-profiles/${encodeURIComponent(id)}`);
}
