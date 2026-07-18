import {
  createPart,
  deletePart,
  deletePartPicture,
  exportPartsToCsv,
  exportPartsToExcel,
  exportPartsToTxt,
  getPartsForProject,
  getProject,
  importPartsFromExcel,
  updatePart,
  updateProjectStatus,
  uploadPartPicture
} from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';

const ADD_PART_MODAL_ID = 'rfq-add-part-modal';
const PICTURE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.wmf', '.tif', '.tiff']);

const RFQ_EDIT_FIELDS = [
  { key: 'aircraft', type: 'text' },
  { key: 'no', type: 'int' },
  { key: 'partNumber', type: 'text' },
  { key: 'partDescription', type: 'text' },
  { key: 'picture', type: 'text', picture: true },
  { key: 'qpa', type: 'int' },
  { key: 'firstLaunchQty', type: 'int' },
  { key: 'firstDelivery', type: 'text' },
  { key: 'materialSpec', type: 'text' },
  { key: 'finishThickness', type: 'number' },
  { key: 'finishWidth', type: 'number' },
  { key: 'finishLength', type: 'number' },
  { key: 'materialRulingDim', type: 'number' },
  { key: 'materialThickness', type: 'number' },
  { key: 'materialWidth', type: 'number' },
  { key: 'materialLength', type: 'number' },
  { key: 'qtyPerBillet', type: 'int' },
  { key: 'setupTimeHour', type: 'number' },
  { key: 'cycleTurnMill', type: 'number' },
  { key: 'cycle3x', type: 'number' },
  { key: 'cycle4x', type: 'number' },
  { key: 'cycle5x', type: 'number' },
  { key: 'cycleTotalHrs', type: 'number', readonly: true }
];

const CYCLE_TOTAL_SOURCE_KEYS = [
  'setupTimeHour',
  'cycleTurnMill',
  'cycle3x',
  'cycle4x',
  'cycle5x'
];

/** TOTAL HRS REQUIRE = Setup + TurnMill + 3X + 4X + 5X */
function computeCycleTotalHrs(values) {
  return CYCLE_TOTAL_SOURCE_KEYS.reduce((sum, key) => {
    const n = Number(values?.[key]);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

let currentProjectId = null;
let currentProject = null;
let partsCache = [];
let pendingPicturePartId = null;
const savingRows = new Set();

function normalizeProjectStatus(status) {
  return String(status ?? '').trim().toLowerCase() === 'closed' ? 'Closed' : 'Open';
}

function updateProjectHeader() {
  const subtitle = document.getElementById('rfq-subtitle');
  if (!subtitle || !currentProject) return;
  subtitle.textContent = `Project: ${currentProject.name} · ${currentProject.status}`;
}

function updateStatusToggleButton() {
  const btn = document.getElementById('btn-toggle-project-status');
  if (!btn || !currentProject) return;
  btn.textContent = currentProject.status === 'Closed' ? 'Set as Open' : 'Set as Closed';
}

function setCurrentProject(project) {
  currentProject = project
    ? {
        id: project.id,
        name: project.name,
        status: normalizeProjectStatus(project.status)
      }
    : null;
  updateProjectHeader();
  updateStatusToggleButton();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

function inputValue(part, key, type) {
  const v = part?.[key];
  if (v == null || v === '') return '';
  if (type === 'int') {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.trunc(n)) : '';
  }
  if (type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : '';
  }
  return String(v);
}

function parseFieldValue(raw, type) {
  if (type === 'text') return String(raw ?? '').trim();
  if (type === 'int') {
    const n = parseInt(String(raw).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function rfqInput(part, field) {
  const { key, type, readonly } = field;
  const inputType = type === 'text' ? 'text' : 'number';
  const step = type === 'int' ? '1' : 'any';
  const min = type === 'int' ? ' min="0"' : '';
  const value =
    key === 'cycleTotalHrs'
      ? computeCycleTotalHrs(part)
      : inputValue(part, key, type);
  const readonlyAttr = readonly
    ? ' readonly tabindex="-1" title="Auto-calculated: Setup + TurnMill + 3X + 4X + 5X"'
    : '';
  const readonlyClass = readonly ? ' rfq-cell-readonly' : '';
  return `<input type="${inputType}" class="cell-input rfq-cell-input${readonlyClass}" data-field="${key}" data-type="${type}" value="${escapeAttr(value)}" step="${step}"${min}${readonlyAttr} />`;
}

function refreshCycleTotalHrsCell(tr) {
  const totalInput = tr?.querySelector('[data-field="cycleTotalHrs"]');
  if (!totalInput) return;
  const values = {};
  for (const key of CYCLE_TOTAL_SOURCE_KEYS) {
    const el = tr.querySelector(`[data-field="${key}"]`);
    values[key] = parseFieldValue(el?.value, 'number');
  }
  totalInput.value = String(computeCycleTotalHrs(values));
}

function renderPictureCell(part) {
  const url = String(part.picture ?? '').trim();
  const preview = url
    ? `<img src="${escapeHtml(url)}" alt="" class="part-thumb rfq-picture-preview" data-rfq-picture-preview />`
    : '<span class="rfq-picture-placeholder" data-rfq-picture-placeholder>No image</span>';
  return `<div class="rfq-picture-cell">
    <input type="hidden" data-field="picture" data-type="text" value="${escapeAttr(url)}" />
    ${preview}
  </div>`;
}

function renderPictureActionsCell(part) {
  return `<div class="rfq-picture-actions">
    <button type="button" class="btn-link" data-upload-picture="${part.id}" title="Upload image">Upload</button>
    <button type="button" class="btn-link btn-link-danger" data-delete-picture="${part.id}" title="Delete image">Delete</button>
  </div>`;
}

function isAllowedPictureFile(file) {
  if (!file?.name) return false;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  return PICTURE_EXTENSIONS.has(ext);
}

function buildPartPayload(tr) {
  /** @type {Record<string, string|number>} */
  const payload = {};
  tr.querySelectorAll('[data-field]').forEach((el) => {
    payload[el.dataset.field] = parseFieldValue(el.value, el.dataset.type);
  });
  payload.cycleTotalHrs = computeCycleTotalHrs(payload);
  return payload;
}

function updatePicturePreview(tr, url) {
  const hidden = tr.querySelector('[data-field="picture"]');
  if (hidden) hidden.value = String(url ?? '').trim();

  const cell = tr.querySelector('.rfq-picture-cell');
  if (!cell) return;

  cell.querySelectorAll('[data-rfq-picture-preview], [data-rfq-picture-placeholder]').forEach((el) => el.remove());

  const value = String(url ?? '').trim();
  if (value) {
    const img = document.createElement('img');
    img.src = value;
    img.alt = '';
    img.className = 'part-thumb rfq-picture-preview';
    img.dataset.rfqPicturePreview = '';
    cell.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'rfq-picture-placeholder';
    span.dataset.rfqPicturePlaceholder = '';
    span.textContent = 'No image';
    cell.appendChild(span);
  }
}

async function savePartFromRow(tr, changedInput) {
  const partId = Number(tr.dataset.partId);
  if (!partId || !currentProjectId || savingRows.has(partId)) return;

  savingRows.add(partId);
  const payload = buildPartPayload(tr);

  try {
    const updated = await updatePart(currentProjectId, partId, payload);
    const idx = partsCache.findIndex((p) => p.id === partId);
    if (idx >= 0) partsCache[idx] = updated;
    updatePicturePreview(tr, updated.picture);
  } catch (err) {
    alert(err.message || 'Failed to save part.');
    const part = partsCache.find((p) => p.id === partId);
    if (part && changedInput) {
      changedInput.value = inputValue(part, changedInput.dataset.field, changedInput.dataset.type);
      if (changedInput.dataset.field === 'picture') {
        updatePicturePreview(tr, part.picture);
      }
    }
  } finally {
    savingRows.delete(partId);
  }
}

function openAddPartModal() {
  document.getElementById('rfq-part-number').value = '';
  document.getElementById('rfq-part-description').value = '';
  showModalError(document.getElementById('rfq-add-part-modal-error'), '');
  openModal(ADD_PART_MODAL_ID);
}

async function saveAllParts() {
  const rows = [...document.querySelectorAll('#rfq-table tbody tr')];
  if (rows.length === 0) return { saved: 0, failed: 0 };

  let saved = 0;
  let failed = 0;

  for (const tr of rows) {
    const partId = Number(tr.dataset.partId);
    if (!partId || savingRows.has(partId)) continue;

    savingRows.add(partId);
    const payload = buildPartPayload(tr);

    try {
      const updated = await updatePart(currentProjectId, partId, payload);
      const idx = partsCache.findIndex((p) => p.id === partId);
      if (idx >= 0) partsCache[idx] = updated;
      updatePicturePreview(tr, updated.picture);
      saved++;
    } catch {
      failed++;
    } finally {
      savingRows.delete(partId);
    }
  }

  return { saved, failed };
}

function renderPartRows(projectId, parts) {
  const tbody = document.querySelector('#rfq-table tbody');
  const empty = document.getElementById('rfq-empty');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (parts.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  parts.forEach((part) => {
    const editUrl = `/CycleTime/Edit?projectId=${encodeURIComponent(projectId)}&partId=${encodeURIComponent(part.id)}`;
    const tr = document.createElement('tr');
    tr.dataset.partId = String(part.id);

    const actionCell = `
      <td class="rfq-action-col">
        <span class="table-action-btns">
          <a class="btn-link" href="${editUrl}">Edit</a>
          <button type="button" class="btn-link btn-link-danger" data-delete-part="${part.id}">Delete</button>
        </span>
      </td>`;

    const cells = RFQ_EDIT_FIELDS.map((field) => {
      if (field.picture) {
        return `<td class="rfq-picture-col rfq-editable-cell">${renderPictureCell(part)}</td>
          <td class="rfq-picture-actions-col">${renderPictureActionsCell(part)}</td>`;
      }
      return `<td class="rfq-editable-cell">${rfqInput(part, field)}</td>`;
    }).join('');

    tr.innerHTML = `${actionCell}${cells}`;
    tbody.appendChild(tr);
  });
}

async function render() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  currentProjectId = projectId;
  const subtitle = document.getElementById('rfq-subtitle');
  const empty = document.getElementById('rfq-empty');
  const backLink = document.getElementById('back-to-projects');
  const saveBtn = document.getElementById('btn-save-rfq');
  const statusBtn = document.getElementById('btn-toggle-project-status');
  const addBtn = document.getElementById('btn-add-part');
  const importBtn = document.getElementById('btn-import-excel');
  const exportExcelBtn = document.getElementById('btn-export-excel');
  const exportCsvBtn = document.getElementById('btn-export-csv');
  const exportTxtBtn = document.getElementById('btn-export-txt');

  if (!projectId) {
    if (subtitle) subtitle.textContent = 'Select a project from Project Manager.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'No project selected. Open Project Manager and click a project name.';
    }
    currentProject = null;
    if (saveBtn) saveBtn.disabled = true;
    if (statusBtn) statusBtn.disabled = true;
    if (addBtn) addBtn.disabled = true;
    if (importBtn) importBtn.disabled = true;
    if (exportExcelBtn) exportExcelBtn.disabled = true;
    if (exportCsvBtn) exportCsvBtn.disabled = true;
    if (exportTxtBtn) exportTxtBtn.disabled = true;
    return;
  }

  let project;
  let parts;
  try {
    project = await getProject(projectId);
    parts = project ? await getPartsForProject(projectId) : [];
    partsCache = parts;
  } catch (err) {
    if (subtitle) subtitle.textContent = 'Error loading project.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = err.message;
    }
    return;
  }

  if (!project) {
    setCurrentProject(null);
    if (subtitle) subtitle.textContent = 'Project not found.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Project ID "${projectId}" was not found.`;
    }
    return;
  }

  setCurrentProject(project);
  if (backLink) backLink.href = '/Projects';
  if (saveBtn) saveBtn.disabled = false;
  if (statusBtn) statusBtn.disabled = false;
  if (addBtn) addBtn.disabled = false;
  if (importBtn) importBtn.disabled = false;
  if (exportExcelBtn) exportExcelBtn.disabled = false;
  if (exportCsvBtn) exportCsvBtn.disabled = false;
  if (exportTxtBtn) exportTxtBtn.disabled = false;

  renderPartRows(projectId, parts);
}

async function runPartsExport(exportFn, buttonId, errorMessage) {
  if (!currentProjectId) return;

  const btn = document.getElementById(buttonId);
  if (btn) btn.disabled = true;

  try {
    await saveAllParts();
    await exportFn(currentProjectId);
  } catch (err) {
    alert(err.message || errorMessage);
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindModal(ADD_PART_MODAL_ID, {
    onClose: () => showModalError(document.getElementById('rfq-add-part-modal-error'), '')
  });

  document.getElementById('btn-save-rfq')?.addEventListener('click', async () => {
    if (!currentProjectId) return;

    const btn = document.getElementById('btn-save-rfq');
    if (btn) btn.disabled = true;

    try {
      const { saved, failed } = await saveAllParts();
      if (failed > 0) {
        alert(`Saved ${saved} part(s). ${failed} part(s) failed to save.`);
      } else if (saved > 0) {
        alert(`Saved ${saved} part(s).`);
      } else {
        alert('No parts to save.');
      }
    } catch (err) {
      alert(err.message || 'Failed to save parts.');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-toggle-project-status')?.addEventListener('click', async () => {
    if (!currentProjectId || !currentProject) return;

    const nextStatus = currentProject.status === 'Closed' ? 'Open' : 'Closed';
    const projectName = currentProject.name;
    const message =
      nextStatus === 'Closed'
        ? `Set project "${projectName}" as Closed?`
        : `Set project "${projectName}" as Open?`;
    if (!confirm(message)) return;

    const btn = document.getElementById('btn-toggle-project-status');
    if (btn) btn.disabled = true;

    try {
      const updated = await updateProjectStatus(currentProjectId, nextStatus);
      setCurrentProject(updated);
    } catch (err) {
      alert(err.message || 'Failed to update project status.');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-add-part')?.addEventListener('click', () => {
    if (!currentProjectId) return;
    openAddPartModal();
  });

  document.getElementById('btn-import-excel')?.addEventListener('click', () => {
    if (!currentProjectId) return;
    document.getElementById('rfq-import-input')?.click();
  });

  document.getElementById('btn-export-excel')?.addEventListener('click', () => {
    runPartsExport(exportPartsToExcel, 'btn-export-excel', 'Failed to export Excel file.').catch(console.error);
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    runPartsExport(exportPartsToCsv, 'btn-export-csv', 'Failed to export CSV file.').catch(console.error);
  });

  document.getElementById('btn-export-txt')?.addEventListener('click', () => {
    runPartsExport(exportPartsToTxt, 'btn-export-txt', 'Failed to export TXT file.').catch(console.error);
  });

  document.getElementById('rfq-picture-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const partId = pendingPicturePartId;
    pendingPicturePartId = null;
    if (!file || !partId || !currentProjectId) return;

    if (!isAllowedPictureFile(file)) {
      alert('Allowed formats: jpeg, jpg, png, gif, bmp, wmf, tif.');
      return;
    }

    const tr = document.querySelector(`#rfq-table tbody tr[data-part-id="${partId}"]`);

    try {
      const updated = await uploadPartPicture(currentProjectId, partId, file);
      const idx = partsCache.findIndex((p) => p.id === partId);
      if (idx >= 0) partsCache[idx] = updated;
      if (tr) updatePicturePreview(tr, updated.picture);
    } catch (err) {
      alert(err.message || 'Failed to upload picture.');
    }
  });

  document.getElementById('rfq-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentProjectId) return;

    try {
      const result = await importPartsFromExcel(currentProjectId, file);
      const skipped = result?.skipped ?? 0;
      const imported = result?.imported ?? 0;
      const warnings = Array.isArray(result?.errors) ? result.errors.filter(Boolean) : [];
      let message = `Imported ${imported} part(s).`;
      if (skipped > 0) message += ` Skipped ${skipped} row(s).`;
      if (warnings.length > 0) message += `\n\n${warnings.join('\n')}`;
      alert(message);
      await render();
    } catch (err) {
      alert(err.message || 'Failed to import Excel file.');
    }
  });

  document.getElementById('rfq-add-part-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentProjectId) return;

    const errorEl = document.getElementById('rfq-add-part-modal-error');
    const partNumber = document.getElementById('rfq-part-number').value.trim();
    const partDescription = document.getElementById('rfq-part-description').value.trim();

    if (!partNumber) {
      showModalError(errorEl, 'Part number is required.');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      await createPart(currentProjectId, { partNumber, partDescription });
      closeModal(ADD_PART_MODAL_ID);
      await render();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to add part.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  document.querySelector('#rfq-table')?.addEventListener('input', (e) => {
    const input = e.target.closest('[data-field]');
    if (!input || input.dataset.field === 'cycleTotalHrs') return;
    if (!CYCLE_TOTAL_SOURCE_KEYS.includes(input.dataset.field)) return;
    const tr = input.closest('tr');
    if (tr) refreshCycleTotalHrsCell(tr);
  });

  document.querySelector('#rfq-table')?.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-field]');
    if (input) {
      if (input.dataset.field === 'cycleTotalHrs') return;
      const tr = input.closest('tr');
      if (tr) {
        if (CYCLE_TOTAL_SOURCE_KEYS.includes(input.dataset.field)) {
          refreshCycleTotalHrsCell(tr);
        }
        await savePartFromRow(tr, input);
      }
      return;
    }
  });

  document.querySelector('#rfq-table')?.addEventListener('click', async (e) => {
    const uploadBtn = e.target.closest('[data-upload-picture]');
    if (uploadBtn && currentProjectId) {
      pendingPicturePartId = Number(uploadBtn.getAttribute('data-upload-picture'));
      document.getElementById('rfq-picture-input')?.click();
      return;
    }

    const deletePictureBtn = e.target.closest('[data-delete-picture]');
    if (deletePictureBtn && currentProjectId) {
      const partId = Number(deletePictureBtn.getAttribute('data-delete-picture'));
      const part = partsCache.find((p) => p.id === partId);
      if (!part) return;

      if (!confirm(`Delete picture for part "${part.partNumber}"?`)) return;

      const tr = deletePictureBtn.closest('tr');
      try {
        const updated = await deletePartPicture(currentProjectId, partId);
        const idx = partsCache.findIndex((p) => p.id === partId);
        if (idx >= 0) partsCache[idx] = updated;
        if (tr) updatePicturePreview(tr, updated.picture);
      } catch (err) {
        alert(err.message || 'Failed to delete picture.');
      }
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-part]');
    if (!deleteBtn || !currentProjectId) return;

    const partId = Number(deleteBtn.getAttribute('data-delete-part'));
    const part = partsCache.find((p) => p.id === partId);
    if (!part) return;

    if (!confirm(`Delete part "${part.partNumber}"? This cannot be undone.`)) return;

    try {
      await deletePart(currentProjectId, partId);
      await render();
    } catch (err) {
      alert(err.message || 'Failed to delete part.');
    }
  });

  render().catch(console.error);
});
