import { getProjects } from './data-store.js';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderTable() {
  const tbody = document.querySelector('#projects-table tbody');
  const empty = document.getElementById('projects-empty');
  if (!tbody) return;

  let projects;
  try {
    projects = await getProjects();
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Failed to load projects: ${err.message}`;
    }
    return;
  }

  tbody.innerHTML = '';

  if (projects.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  projects.forEach((p, index) => {
    const tr = document.createElement('tr');
    const statusClass = p.status === 'Closed' ? 'status-closed' : 'status-open';
    const rfqUrl = `/ProjectRfq?projectId=${encodeURIComponent(p.id)}`;
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><a class="link-primary" href="${rfqUrl}">${escapeHtml(p.name)}</a></td>
      <td>${formatDate(p.dateRegistered)}</td>
      <td>${escapeHtml(p.owner)}</td>
      <td class="${statusClass}">${escapeHtml(p.status)}</td>
      <td><a class="btn-link" href="${rfqUrl}">Edit</a></td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderTable().catch(console.error);
});
