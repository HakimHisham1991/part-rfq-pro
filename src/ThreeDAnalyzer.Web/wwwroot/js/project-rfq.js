import {
  createPart,
  deletePart,
  getPartsForProject,
  getProject,
  importPartsFromExcel,
  updatePart
} from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';

const ADD_PART_MODAL_ID = 'rfq-add-part-modal';

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
  { key: 'cycleTotalHrs', type: 'number' }
];

let currentProjectId = null;
let partsCache = [];
const savingRows = new Set();

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
  const { key, type } = field;
  const inputType = type === 'text' ? 'text' : 'number';
  const step = type === 'int' ? '1' : 'any';
  const min = type === 'int' ? ' min="0"' : '';
  return `<input type="${inputType}" class="cell-input rfq-cell-input" data-field="${key}" data-type="${type}" value="${escapeAttr(inputValue(part, key, type))}" step="${step}"${min} />`;
}

function renderPictureCell(part) {
  const url = String(part.picture ?? '').trim();
  const preview = url
    ? `<img src="${escapeHtml(url)}" alt="" class="part-thumb rfq-picture-preview" data-rfq-picture-preview />`
    : '<img alt="" class="part-thumb rfq-picture-preview" data-rfq-picture-preview hidden />';
  return `<div class="rfq-picture-cell">${rfqInput(part, { key: 'picture', type: 'text' })}${preview}</div>`;
}

function buildPartPayload(tr) {
  /** @type {Record<string, string|number>} */
  const payload = {};
  tr.querySelectorAll('[data-field]').forEach((el) => {
    payload[el.dataset.field] = parseFieldValue(el.value, el.dataset.type);
  });
  return payload;
}

function updatePicturePreview(tr, url) {
  const img = tr.querySelector('[data-rfq-picture-preview]');
  if (!img) return;
  const value = String(url ?? '').trim();
  if (value) {
    img.src = value;
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
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

    const cells = RFQ_EDIT_FIELDS.map((field) => {
      if (field.picture) {
        return `<td class="rfq-editable-cell">${renderPictureCell(part)}</td>`;
      }
      return `<td class="rfq-editable-cell">${rfqInput(part, field)}</td>`;
    }).join('');

    tr.innerHTML = `
      ${cells}
      <td>
        <span class="table-action-btns">
          <a class="btn-link" href="${editUrl}">Edit</a>
          <button type="button" class="btn-link btn-link-danger" data-delete-part="${part.id}">Delete</button>
        </span>
      </td>
    `;
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
  const addBtn = document.getElementById('btn-add-part');
  const importBtn = document.getElementById('btn-import-excel');

  if (!projectId) {
    if (subtitle) subtitle.textContent = 'Select a project from Project Manager.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'No project selected. Open Project Manager and click a project name.';
    }
    if (addBtn) addBtn.disabled = true;
    if (importBtn) importBtn.disabled = true;
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
    if (subtitle) subtitle.textContent = 'Project not found.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Project ID "${projectId}" was not found.`;
    }
    return;
  }

  if (subtitle) subtitle.textContent = `Project: ${project.name} · ${project.status}`;
  if (backLink) backLink.href = '/Projects';
  if (addBtn) addBtn.disabled = false;
  if (importBtn) importBtn.disabled = false;

  renderPartRows(projectId, parts);
}

document.addEventListener('DOMContentLoaded', () => {
  bindModal(ADD_PART_MODAL_ID, {
    onClose: () => showModalError(document.getElementById('rfq-add-part-modal-error'), '')
  });

  document.getElementById('btn-add-part')?.addEventListener('click', () => {
    if (!currentProjectId) return;
    openAddPartModal();
  });

  document.getElementById('btn-import-excel')?.addEventListener('click', () => {
    if (!currentProjectId) return;
    document.getElementById('rfq-import-input')?.click();
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

  document.querySelector('#rfq-table')?.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-field]');
    if (input) {
      const tr = input.closest('tr');
      if (tr) await savePartFromRow(tr, input);
      return;
    }
  });

  document.querySelector('#rfq-table')?.addEventListener('click', async (e) => {
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
