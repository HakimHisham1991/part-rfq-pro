import { getUsers } from './data-store.js';

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

async function renderUsers() {
  const tbody = document.querySelector('#users-table tbody');
  const empty = document.getElementById('users-empty');
  if (!tbody) return;

  let users;
  try {
    users = await getUsers();
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
      <td>${escapeHtml(u.displayName)}</td>
      <td>${formatDate(u.createdDate)}</td>
      <td class="${cls}">${escapeHtml(u.status)}</td>
      <td><button type="button" class="btn-link" data-edit-user="${u.id}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderUsers().catch(console.error);
});
