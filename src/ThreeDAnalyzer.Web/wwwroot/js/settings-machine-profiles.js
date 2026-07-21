import {
  createMachineProfile,
  deleteMachineProfile,
  getMachineProfiles,
  updateMachineProfile
} from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';
import { onDomReady } from './dom-ready.js';

const MODAL_ID = 'machine-profile-modal';
const AXIS_TYPE_OPTIONS = ['2X', '3X', '4X', '5X'];
const GENERIC_MACHINE_NAME = 'Generic Machine';

function sortMachineProfiles(profiles) {
  return [...profiles].sort((a, b) => {
    const nameA = profileName(a);
    const nameB = profileName(b);
    const rankA = nameA === GENERIC_MACHINE_NAME ? 0 : 1;
    const rankB = nameB === GENERIC_MACHINE_NAME ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return nameA.localeCompare(nameB);
  });
}

/** Single source of truth for table headers and row cells. */
const MACHINE_PROFILE_COLUMNS = [
  {
    label: 'No.',
    render: (_profile, index) => String(index + 1)
  },
  {
    label: 'Machine Model',
    render: (profile) => escapeHtml(profileName(profile))
  },
  {
    label: 'Axis Types',
    render: (profile) => escapeHtml(profileAxisTypes(profile) || '—')
  },
  {
    label: 'Rapid Rate (mmpm)',
    render: (profile) => formatNum(profileRapidRate(profile), 0)
  },
  {
    label: 'Spindle Power (kW)',
    render: (profile) => formatNum(profileSpindlePower(profile))
  },
  {
    label: 'Accel/Decel Factor',
    render: (profile) => formatNum(profileAccelDecel(profile))
  },
  {
    label: 'Tool Change Time (s)',
    render: (profile) => formatNum(profileToolChange(profile))
  },
  {
    label: 'Created By',
    render: (profile) => escapeHtml(profileCreatedBy(profile))
  },
  {
    label: 'Created Date',
    render: (profile) => formatDate(profileCreatedDate(profile))
  },
  {
    label: 'Status',
    cellClass: (profile) => statusClass(profileStatus(profile)),
    render: (profile) => escapeHtml(profileStatus(profile))
  },
  {
    label: 'Action',
    render: (profile) => `
      <span class="table-action-btns">
        <button type="button" class="btn-link" data-edit-profile="${profileId(profile)}">Edit</button>
        <button type="button" class="btn-link btn-link-danger" data-delete-profile="${profileId(profile)}">Delete</button>
      </span>`
  }
];

function profileId(profile) {
  return profile?.id ?? profile?.Id;
}

function profileName(profile) {
  return profile?.name ?? profile?.Name ?? '';
}

function profileAxisTypes(profile) {
  return profile?.axisTypes ?? profile?.AxisTypes ?? '';
}

function profileRapidRate(profile) {
  return profile?.rapidRateMmpm ?? profile?.RapidRateMmpm;
}

function profileSpindlePower(profile) {
  return profile?.spindlePowerKw ?? profile?.SpindlePowerKw;
}

function profileAccelDecel(profile) {
  return profile?.accelDecelFactor ?? profile?.AccelDecelFactor;
}

function profileToolChange(profile) {
  return profile?.toolChangeTimeSec ?? profile?.ToolChangeTimeSec;
}

function profileCreatedBy(profile) {
  return profile?.createdBy ?? profile?.CreatedBy ?? '';
}

function profileCreatedDate(profile) {
  return profile?.createdDate ?? profile?.CreatedDate ?? '';
}

function profileStatus(profile) {
  return profile?.status ?? profile?.Status ?? '';
}

function renderMachineProfileTableHeader() {
  const thead = document.querySelector('#machine-profiles-table thead');
  if (!thead) return;
  thead.innerHTML = `<tr>${MACHINE_PROFILE_COLUMNS.map((col) => `<th>${col.label}</th>`).join('')}</tr>`;
}

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
  document.getElementById('machine-profile-axis-types').value = '';
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
  document.getElementById('machine-profile-id').value = profileId(profile);
  document.getElementById('machine-profile-name').value = profileName(profile);
  document.getElementById('machine-profile-axis-types').value = profileAxisTypes(profile);
  document.getElementById('machine-profile-rapid-rate').value = String(profileRapidRate(profile) ?? '');
  document.getElementById('machine-profile-spindle-power').value = String(profileSpindlePower(profile) ?? '');
  document.getElementById('machine-profile-accel-decel').value = String(profileAccelDecel(profile) ?? '');
  document.getElementById('machine-profile-tool-change').value = String(profileToolChange(profile) ?? '');
  document.getElementById('machine-profile-created-by').value = profileCreatedBy(profile);
  document.getElementById('machine-profile-created-date').value = toDateInputValue(profileCreatedDate(profile));
  document.getElementById('machine-profile-status').value = normalizeProfileStatus(profileStatus(profile));
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
    profiles = sortMachineProfiles(profiles);
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
    tr.innerHTML = MACHINE_PROFILE_COLUMNS.map((col) => {
      const cellClass = col.cellClass ? ` class="${col.cellClass(m)}"` : '';
      return `<td${cellClass}>${col.render(m, index)}</td>`;
    }).join('');
    tbody.appendChild(tr);
  });
}

onDomReady(() => {
  renderMachineProfileTableHeader();

  bindModal(MODAL_ID, {
    onClose: () => showModalError(document.getElementById('machine-profile-modal-error'), '')
  });

  document.getElementById('btn-add-machine-profile')?.addEventListener('click', openAddProfile);

  document.querySelector('#machine-profiles-table')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-profile]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-profile'));
      const profile = profilesCache.find((m) => profileId(m) === id);
      if (profile) openEditProfile(profile);
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-profile]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-delete-profile'));
    const profile = profilesCache.find((m) => profileId(m) === id);
    if (!profile) return;
    if (!confirm(`Delete machine profile "${profileName(profile)}"? This cannot be undone.`)) return;

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
    const axisTypes = document.getElementById('machine-profile-axis-types').value.trim();
    const rapidRateMmpm = Number(document.getElementById('machine-profile-rapid-rate').value);
    const spindlePowerKw = Number(document.getElementById('machine-profile-spindle-power').value);
    const accelDecelFactor = Number(document.getElementById('machine-profile-accel-decel').value);
    const toolChangeTimeSec = Number(document.getElementById('machine-profile-tool-change').value);
    const createdBy = document.getElementById('machine-profile-created-by').value.trim();
    const createdDate = document.getElementById('machine-profile-created-date').value;
    const status = document.getElementById('machine-profile-status').value;

    if (!name || !axisTypes || !createdBy || !createdDate) {
      showModalError(errorEl, 'Machine model, axis types, created by, and created date are required.');
      return;
    }
    if (!AXIS_TYPE_OPTIONS.includes(axisTypes)) {
      showModalError(errorEl, 'Axis types must be one of: 2X, 3X, 4X, 5X.');
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
      axisTypes,
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
