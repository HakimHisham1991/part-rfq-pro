import {
  createMaterialSpec,
  deleteMaterialSpec,
  getMaterialSpecs,
  updateMaterialSpec
} from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';

const MODAL_ID = 'material-spec-modal';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDensity(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

function normalizeSpecStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'inactive' ? 'Inactive' : 'Active';
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

function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function defaultCreatedBy() {
  return document.getElementById('material-specs-page')?.dataset.defaultCreatedBy?.trim() ?? '';
}

function isEditMode() {
  return Boolean(document.getElementById('material-spec-id').value);
}

function setSpecificationFieldReadonly(readonly) {
  const el = document.getElementById('material-spec-specification');
  if (!el) return;
  el.readOnly = readonly;
}

let specsCache = [];

function openAddSpec() {
  document.getElementById('material-spec-modal-title').textContent = 'Add Material Specification';
  document.getElementById('material-spec-id').value = '';
  document.getElementById('material-spec-specification').value = '';
  document.getElementById('material-spec-general-name').value = '';
  document.getElementById('material-spec-material-type').value = '';
  document.getElementById('material-spec-density').value = '';
  document.getElementById('material-spec-created-by').value = defaultCreatedBy();
  document.getElementById('material-spec-created-date').value = todayDateInputValue();
  document.getElementById('material-spec-status').value = 'Active';
  document.getElementById('material-spec-status-group').hidden = true;
  setSpecificationFieldReadonly(false);
  showModalError(document.getElementById('material-spec-modal-error'), '');
  openModal(MODAL_ID);
}

function openEditSpec(spec) {
  document.getElementById('material-spec-modal-title').textContent = 'Edit Material Specification';
  document.getElementById('material-spec-id').value = spec.id;
  document.getElementById('material-spec-specification').value = spec.specification ?? '';
  document.getElementById('material-spec-general-name').value = spec.generalName ?? '';
  document.getElementById('material-spec-material-type').value = spec.materialType ?? '';
  document.getElementById('material-spec-density').value =
    Number(spec.density) > 0 ? String(spec.density) : '';
  document.getElementById('material-spec-created-by').value = spec.createdBy ?? '';
  document.getElementById('material-spec-created-date').value = toDateInputValue(spec.createdDate);
  document.getElementById('material-spec-status').value = normalizeSpecStatus(spec.status);
  document.getElementById('material-spec-status-group').hidden = false;
  setSpecificationFieldReadonly(true);
  showModalError(document.getElementById('material-spec-modal-error'), '');
  openModal(MODAL_ID);
}

async function renderMaterialSpecs() {
  const tbody = document.querySelector('#material-specs-table tbody');
  const empty = document.getElementById('material-specs-empty');
  if (!tbody) return;

  let specs;
  try {
    specs = await getMaterialSpecs();
    specsCache = specs;
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Failed to load material specifications: ${err.message}`;
    }
    return;
  }

  tbody.innerHTML = '';

  if (specs.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  specs.forEach((m, index) => {
    const tr = document.createElement('tr');
    const cls = statusClass(m.status);
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(m.specification)}</td>
      <td>${escapeHtml(m.generalName)}</td>
      <td>${escapeHtml(m.materialType)}</td>
      <td>${formatDensity(m.density)}</td>
      <td>${escapeHtml(m.createdBy)}</td>
      <td>${formatDate(m.createdDate)}</td>
      <td class="${cls}">${escapeHtml(m.status)}</td>
      <td>
        <span class="table-action-btns">
          <button type="button" class="btn-link" data-edit-spec="${m.id}">Edit</button>
          <button type="button" class="btn-link btn-link-danger" data-delete-spec="${m.id}">Delete</button>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindModal(MODAL_ID, {
    onClose: () => showModalError(document.getElementById('material-spec-modal-error'), '')
  });

  document.getElementById('btn-add-material-spec')?.addEventListener('click', openAddSpec);

  document.querySelector('#material-specs-table')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-spec]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-spec'));
      const spec = specsCache.find((m) => m.id === id);
      if (spec) openEditSpec(spec);
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-spec]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-delete-spec'));
    const spec = specsCache.find((m) => m.id === id);
    if (!spec) return;
    if (
      !confirm(
        `Delete material specification "${spec.specification}" / "${spec.generalName}"? This cannot be undone.`
      )
    )
      return;

    try {
      await deleteMaterialSpec(id);
      await renderMaterialSpecs();
    } catch (err) {
      alert(err.message || 'Failed to delete material specification.');
    }
  });

  document.getElementById('material-spec-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('material-spec-modal-error');
    const id = document.getElementById('material-spec-id').value;
    const specification = document.getElementById('material-spec-specification').value.trim();
    const generalName = document.getElementById('material-spec-general-name').value.trim();
    const materialType = document.getElementById('material-spec-material-type').value.trim();
    const densityRaw = document.getElementById('material-spec-density').value.trim();
    const createdBy = document.getElementById('material-spec-created-by').value.trim();
    const createdDate = document.getElementById('material-spec-created-date').value;
    const status = document.getElementById('material-spec-status').value;
    const density = densityRaw === '' ? 0 : Number(densityRaw);

    if (!specification || !generalName || !createdBy || !createdDate) {
      showModalError(
        errorEl,
        'Material specification, general name, created by, and created date are required.'
      );
      return;
    }
    if (!Number.isFinite(density) || density < 0) {
      showModalError(errorEl, 'Density must be a valid number (0 or greater).');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    const payload = {
      generalName,
      materialType,
      density,
      createdBy,
      createdDate,
      status: isEditMode() ? status : 'Active'
    };

    try {
      if (isEditMode()) {
        await updateMaterialSpec(Number(id), payload);
      } else {
        await createMaterialSpec({ specification, ...payload });
      }
      closeModal(MODAL_ID);
      await renderMaterialSpecs();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to save material specification.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  renderMaterialSpecs().catch(console.error);
});
