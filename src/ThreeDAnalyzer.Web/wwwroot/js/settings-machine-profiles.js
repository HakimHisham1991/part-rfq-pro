import {
  createMachineProfile,
  deleteMachineProfile,
  getMachineProfiles,
  updateMachineProfile
} from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';

const MODAL_ID = 'machine-profile-modal';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNum(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
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

function normalizeProfileStatus(status) {
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
  return document.getElementById('machine-profiles-page')?.dataset.defaultCreatedBy?.trim() ?? '';
}

function isEditMode() {
  return Boolean(document.getElementById('machine-profile-id').value);
}

function setNameFieldReadonly(readonly) {
  const el = document.getElementById('machine-profile-name');
  if (!el) return;
  el.readOnly = readonly;
}

let profilesCache = [];

function openAddProfile() {
  document.getElementById('machine-profile-modal-title').textContent = 'Add Machine Profile';
  document.getElementById('machine-profile-id').value = '';
  document.getElementById('machine-profile-name').value = '';
  document.getElementById('machine-profile-rapid-rate').value = '';
  document.getElementById('machine-profile-spindle-power').value = '';
  document.getElementById('machine-profile-accel-decel').value = '1.3';
  document.getElementById('machine-profile-tool-change').value = '15';
  document.getElementById('machine-profile-created-by').value = defaultCreatedBy();
  document.getElementById('machine-profile-created-date').value = todayDateInputValue();
  document.getElementById('machine-profile-status').value = 'Active';
  document.getElementById('machine-profile-status-group').hidden = true;
  setNameFieldReadonly(false);
  showModalError(document.getElementById('machine-profile-modal-error'), '');
  openModal(MODAL_ID);
}

function openEditProfile(profile) {
  document.getElementById('machine-profile-modal-title').textContent = 'Edit Machine Profile';
  document.getElementById('machine-profile-id').value = profile.id;
  document.getElementById('machine-profile-name').value = profile.name ?? '';
  document.getElementById('machine-profile-rapid-rate').value = String(profile.rapidRateMmpm ?? '');
  document.getElementById('machine-profile-spindle-power').value = String(profile.spindlePowerKw ?? '');
  document.getElementById('machine-profile-accel-decel').value = String(profile.accelDecelFactor ?? '');
  document.getElementById('machine-profile-tool-change').value = String(profile.toolChangeTimeSec ?? '');
  document.getElementById('machine-profile-created-by').value = profile.createdBy ?? '';
  document.getElementById('machine-profile-created-date').value = toDateInputValue(profile.createdDate);
  document.getElementById('machine-profile-status').value = normalizeProfileStatus(profile.status);
  document.getElementById('machine-profile-status-group').hidden = false;
  setNameFieldReadonly(true);
  showModalError(document.getElementById('machine-profile-modal-error'), '');
  openModal(MODAL_ID);
}

async function renderMachineProfiles() {
  const tbody = document.querySelector('#machine-profiles-table tbody');
  const empty = document.getElementById('machine-profiles-empty');
  if (!tbody) return;

  let profiles;
  try {
    profiles = await getMachineProfiles();
    profilesCache = profiles;
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Failed to load machine profiles: ${err.message}`;
    }
    return;
  }

  tbody.innerHTML = '';

  if (profiles.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  profiles.forEach((m, index) => {
    const tr = document.createElement('tr');
    const cls = statusClass(m.status);
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(m.name)}</td>
      <td>${formatNum(m.rapidRateMmpm, 0)}</td>
      <td>${formatNum(m.spindlePowerKw)}</td>
      <td>${formatNum(m.accelDecelFactor)}</td>
      <td>${formatNum(m.toolChangeTimeSec)}</td>
      <td>${escapeHtml(m.createdBy)}</td>
      <td>${formatDate(m.createdDate)}</td>
      <td class="${cls}">${escapeHtml(m.status)}</td>
      <td>
        <span class="table-action-btns">
          <button type="button" class="btn-link" data-edit-profile="${m.id}">Edit</button>
          <button type="button" class="btn-link btn-link-danger" data-delete-profile="${m.id}">Delete</button>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindModal(MODAL_ID, {
    onClose: () => showModalError(document.getElementById('machine-profile-modal-error'), '')
  });

  document.getElementById('btn-add-machine-profile')?.addEventListener('click', openAddProfile);

  document.querySelector('#machine-profiles-table')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-profile]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-profile'));
      const profile = profilesCache.find((m) => m.id === id);
      if (profile) openEditProfile(profile);
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-profile]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-delete-profile'));
    const profile = profilesCache.find((m) => m.id === id);
    if (!profile) return;
    if (!confirm(`Delete machine profile "${profile.name}"? This cannot be undone.`)) return;

    try {
      await deleteMachineProfile(id);
      await renderMachineProfiles();
    } catch (err) {
      alert(err.message || 'Failed to delete machine profile.');
    }
  });

  document.getElementById('machine-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('machine-profile-modal-error');
    const id = document.getElementById('machine-profile-id').value;
    const name = document.getElementById('machine-profile-name').value.trim();
    const rapidRateMmpm = Number(document.getElementById('machine-profile-rapid-rate').value);
    const spindlePowerKw = Number(document.getElementById('machine-profile-spindle-power').value);
    const accelDecelFactor = Number(document.getElementById('machine-profile-accel-decel').value);
    const toolChangeTimeSec = Number(document.getElementById('machine-profile-tool-change').value);
    const createdBy = document.getElementById('machine-profile-created-by').value.trim();
    const createdDate = document.getElementById('machine-profile-created-date').value;
    const status = document.getElementById('machine-profile-status').value;

    if (!name || !createdBy || !createdDate) {
      showModalError(errorEl, 'Machine name, created by, and created date are required.');
      return;
    }
    if (!Number.isFinite(rapidRateMmpm) || rapidRateMmpm < 0) {
      showModalError(errorEl, 'Rapid rate must be a valid number (0 or greater).');
      return;
    }
    if (!Number.isFinite(spindlePowerKw) || spindlePowerKw < 0) {
      showModalError(errorEl, 'Spindle power must be a valid number (0 or greater).');
      return;
    }
    if (!Number.isFinite(accelDecelFactor) || accelDecelFactor <= 0) {
      showModalError(errorEl, 'Acceleration/deceleration factor must be greater than zero.');
      return;
    }
    if (!Number.isFinite(toolChangeTimeSec) || toolChangeTimeSec < 0) {
      showModalError(errorEl, 'Tool change time must be a valid number (0 or greater).');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    const payload = {
      rapidRateMmpm,
      spindlePowerKw,
      accelDecelFactor,
      toolChangeTimeSec,
      createdBy,
      createdDate,
      status: isEditMode() ? status : 'Active'
    };

    try {
      if (isEditMode()) {
        await updateMachineProfile(Number(id), payload);
      } else {
        await createMachineProfile({ name, ...payload });
      }
      closeModal(MODAL_ID);
      await renderMachineProfiles();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to save machine profile.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  renderMachineProfiles().catch(console.error);
});
