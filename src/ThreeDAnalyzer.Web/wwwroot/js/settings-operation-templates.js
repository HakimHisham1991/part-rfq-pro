import {
  createOperationTemplate,
  deleteOperationTemplate,
  getOperationTemplates,
  updateOperationTemplate
} from './data-store.js';
import { FIELD_SCHEMAS, OPERATION_TYPES } from './operation-field-schemas.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';
import { onDomReady } from './dom-ready.js';

const MODAL_ID = 'operation-template-modal';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusClass(status) {
  const s = String(status).toLowerCase();
  if (s === 'active' || s === 'open') return 'status-open';
  return 'status-closed';
}

function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }
  return d.toISOString().slice(0, 10);
}

function defaultCreatedBy() {
  return document.getElementById('operation-templates-page')?.dataset.defaultCreatedBy?.trim() ?? '';
}

function isEditMode() {
  return Boolean(document.getElementById('operation-template-id').value);
}

let templatesCache = [];

function populateTypeSelect(selected = '') {
  const sel = document.getElementById('operation-template-type');
  if (!sel) return;
  sel.innerHTML = OPERATION_TYPES.map(
    (t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`
  ).join('');
  if (selected) sel.value = selected;
}

function renderParamFields(type, params = {}) {
  const wrap = document.getElementById('operation-template-params');
  if (!wrap) return;
  const schema = FIELD_SCHEMAS[type] ?? [];
  if (schema.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML =
    '<h4 class="params-heading">Default Parameters</h4>' +
    schema
      .map((f) => {
        const val = params[f.key] ?? '';
        return `
        <div class="form-group">
          <label for="op-param-${f.key}">${escapeHtml(f.label)}${f.unit ? ` (${escapeHtml(f.unit)})` : ''}</label>
          <input type="number" id="op-param-${f.key}" class="form-control op-template-param"
            data-param-key="${f.key}" step="any" value="${val}" />
        </div>`;
      })
      .join('');
}

function collectParams() {
  /** @type {Record<string, number>} */
  const params = {};
  document.querySelectorAll('.op-template-param').forEach((input) => {
    const key = input.getAttribute('data-param-key');
    const n = parseFloat(input.value);
    if (key) params[key] = Number.isFinite(n) ? n : 0;
  });
  return params;
}

function formatParamsSummary(params) {
  if (!params || typeof params !== 'object') return '—';
  const entries = Object.entries(params).filter(([, v]) => v !== 0 && v !== '');
  if (entries.length === 0) return '—';
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

function openAddTemplate() {
  document.getElementById('operation-template-modal-title').textContent = 'Add Operation Template';
  document.getElementById('operation-template-id').value = '';
  document.getElementById('operation-template-name').value = '';
  populateTypeSelect(OPERATION_TYPES[0]);
  renderParamFields(OPERATION_TYPES[0]);
  document.getElementById('operation-template-created-by').value = defaultCreatedBy();
  document.getElementById('operation-template-created-date').value = todayDateInputValue();
  document.getElementById('operation-template-status').value = 'Active';
  document.getElementById('operation-template-status-group').hidden = true;
  showModalError(document.getElementById('operation-template-modal-error'), '');
  openModal(MODAL_ID);
}

function openEditTemplate(template) {
  document.getElementById('operation-template-modal-title').textContent = 'Edit Operation Template';
  document.getElementById('operation-template-id').value = template.id;
  document.getElementById('operation-template-name').value = template.name ?? '';
  populateTypeSelect(template.operationType);
  renderParamFields(template.operationType, template.params ?? {});
  document.getElementById('operation-template-created-by').value = template.createdBy ?? '';
  document.getElementById('operation-template-created-date').value = toDateInputValue(template.createdDate);
  document.getElementById('operation-template-status').value = template.status ?? 'Active';
  document.getElementById('operation-template-status-group').hidden = false;
  showModalError(document.getElementById('operation-template-modal-error'), '');
  openModal(MODAL_ID);
}

async function renderTemplates() {
  const tbody = document.querySelector('#operation-templates-table tbody');
  const empty = document.getElementById('operation-templates-empty');
  if (!tbody) return;

  let templates;
  try {
    templates = await getOperationTemplates();
    templatesCache = templates;
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Failed to load operation templates: ${err.message}`;
    }
    return;
  }

  tbody.innerHTML = '';

  if (templates.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  templates.forEach((t, index) => {
    const tr = document.createElement('tr');
    const cls = statusClass(t.status);
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.operationType)}</td>
      <td class="params-summary">${escapeHtml(formatParamsSummary(t.params))}</td>
      <td>${escapeHtml(t.createdBy)}</td>
      <td>${formatDate(t.createdDate)}</td>
      <td class="${cls}">${escapeHtml(t.status)}</td>
      <td>
        <span class="table-action-btns">
          <button type="button" class="btn-link" data-edit-template="${t.id}">Edit</button>
          <button type="button" class="btn-link btn-link-danger" data-delete-template="${t.id}">Delete</button>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

onDomReady(() => {
  bindModal(MODAL_ID, {
    onClose: () => showModalError(document.getElementById('operation-template-modal-error'), '')
  });

  document.getElementById('btn-add-operation-template')?.addEventListener('click', openAddTemplate);

  document.getElementById('operation-template-type')?.addEventListener('change', (e) => {
    renderParamFields(e.target.value, collectParams());
  });

  document.querySelector('#operation-templates-table')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-template]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-template'));
      const template = templatesCache.find((t) => t.id === id);
      if (template) openEditTemplate(template);
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-template]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-delete-template'));
    const template = templatesCache.find((t) => t.id === id);
    if (!template) return;
    if (!confirm(`Delete operation template "${template.name}"? This cannot be undone.`)) return;

    try {
      await deleteOperationTemplate(id);
      await renderTemplates();
    } catch (err) {
      alert(err.message || 'Failed to delete operation template.');
    }
  });

  document.getElementById('operation-template-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('operation-template-modal-error');
    const id = document.getElementById('operation-template-id').value;
    const name = document.getElementById('operation-template-name').value.trim();
    const operationType = document.getElementById('operation-template-type').value;
    const createdBy = document.getElementById('operation-template-created-by').value.trim();
    const createdDate = document.getElementById('operation-template-created-date').value;
    const status = document.getElementById('operation-template-status').value;
    const params = collectParams();

    if (!name || !operationType || !createdBy || !createdDate) {
      showModalError(errorEl, 'Template name, operation type, created by, and created date are required.');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    const payload = {
      name,
      operationType,
      params,
      createdBy,
      createdDate,
      status: isEditMode() ? status : 'Active'
    };

    try {
      if (isEditMode()) {
        await updateOperationTemplate(Number(id), payload);
      } else {
        await createOperationTemplate(payload);
      }
      closeModal(MODAL_ID);
      await renderTemplates();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to save operation template.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  renderTemplates().catch(console.error);
});
