import { createUser, deleteUser, getUsers, updateUser } from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';
import { onDomReady } from './dom-ready.js';

const MODAL_ID = 'user-modal';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusClass(status) {
  const s = String(status).toLowerCase();
  if (s === 'active') return 'status-open';
  return 'status-closed';
}

function normalizeUserStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'inactive' ? 'INACTIVE' : 'ACTIVE';
}

function isEditMode() {
  return Boolean(document.getElementById('user-id').value);
}

function setUsernameFieldReadonly(readonly) {
  const el = document.getElementById('user-username');
  if (!el) return;
  el.readOnly = readonly;
  if (readonly) {
    el.setAttribute('aria-readonly', 'true');
  } else {
    el.removeAttribute('aria-readonly');
  }
}

let usersCache = [];

function openAddUser() {
  document.getElementById('user-modal-title').textContent = 'Add User';
  document.getElementById('user-id').value = '';
  document.getElementById('user-username').value = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-display-name').value = '';
  document.getElementById('user-status').value = 'ACTIVE';
  document.getElementById('user-status-group').hidden = true;
  setUsernameFieldReadonly(false);
  showModalError(document.getElementById('user-modal-error'), '');
  openModal(MODAL_ID);
}

function openEditUser(user) {
  document.getElementById('user-modal-title').textContent = 'Edit User';
  document.getElementById('user-id').value = user.id;
  document.getElementById('user-username').value = user.username ?? '';
  document.getElementById('user-password').value = user.password ?? '';
  document.getElementById('user-display-name').value = user.displayName ?? '';
  document.getElementById('user-status').value = normalizeUserStatus(user.status);
  document.getElementById('user-status-group').hidden = false;
  setUsernameFieldReadonly(true);
  showModalError(document.getElementById('user-modal-error'), '');
  openModal(MODAL_ID);
}

async function renderUsers() {
  const tbody = document.querySelector('#users-table tbody');
  const empty = document.getElementById('users-empty');
  if (!tbody) return;

  let users;
  try {
    users = await getUsers();
    usersCache = users;
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Failed to load users: ${err.message}`;
    }
    return;
  }

  tbody.innerHTML = '';

  if (users.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  users.forEach((u, index) => {
    const tr = document.createElement('tr');
    const cls = statusClass(u.status);
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.password)}</td>
      <td>${escapeHtml(u.displayName)}</td>
      <td class="${cls}">${escapeHtml(u.status)}</td>
      <td>
        <span class="table-action-btns">
          <button type="button" class="btn-link" data-edit-user="${u.id}">Edit</button>
          <button type="button" class="btn-link btn-link-danger" data-delete-user="${u.id}">Delete</button>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

onDomReady(() => {
  bindModal(MODAL_ID, {
    onClose: () => showModalError(document.getElementById('user-modal-error'), '')
  });

  document.getElementById('btn-add-user')?.addEventListener('click', openAddUser);

  document.querySelector('#users-table')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-user]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-edit-user'));
      const user = usersCache.find((u) => u.id === id);
      if (user) openEditUser(user);
      return;
    }

    const deleteBtn = e.target.closest('[data-delete-user]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-delete-user'));
    const user = usersCache.find((u) => u.id === id);
    if (!user) return;
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;

    try {
      await deleteUser(id);
      await renderUsers();
    } catch (err) {
      alert(err.message || 'Failed to delete user.');
    }
  });

  document.getElementById('user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('user-modal-error');
    const id = document.getElementById('user-id').value;
    const username = document.getElementById('user-username').value.trim();
    const password = document.getElementById('user-password').value.trim();
    const displayName = document.getElementById('user-display-name').value.trim();
    const status = document.getElementById('user-status').value;

    if (!username || !password || !displayName) {
      showModalError(errorEl, 'Username, password, and display name are required.');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      if (isEditMode()) {
        await updateUser(Number(id), { password, displayName, status });
      } else {
        await createUser({ username, password, displayName, status: 'ACTIVE' });
      }
      closeModal(MODAL_ID);
      await renderUsers();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to save user.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  renderUsers().catch(console.error);
});
