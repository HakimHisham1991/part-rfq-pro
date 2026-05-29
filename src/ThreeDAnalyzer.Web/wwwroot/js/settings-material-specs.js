import { getMaterialSpecs } from './data-store.js';

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
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/m³`;
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

async function renderMaterialSpecs() {
  const tbody = document.querySelector('#material-specs-table tbody');
  const empty = document.getElementById('material-specs-empty');
  if (!tbody) return;

  let specs;
  try {
    specs = await getMaterialSpecs();
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
      <td><button type="button" class="btn-link" data-edit-spec="${m.id}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderMaterialSpecs().catch(console.error);
});
