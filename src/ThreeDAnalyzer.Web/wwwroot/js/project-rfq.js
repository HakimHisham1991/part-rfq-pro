import { getProject, getPartsForProject } from './data-store.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(v, digits = 2) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

async function render() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const subtitle = document.getElementById('rfq-subtitle');
  const tbody = document.querySelector('#rfq-table tbody');
  const empty = document.getElementById('rfq-empty');
  const backLink = document.getElementById('back-to-projects');

  if (!projectId) {
    if (subtitle) subtitle.textContent = 'Select a project from Project Manager.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'No project selected. Open Project Manager and click a project name.';
    }
    return;
  }

  let project;
  let parts;
  try {
    project = await getProject(projectId);
    parts = project ? await getPartsForProject(projectId) : [];
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
    tr.innerHTML = `
      <td>${escapeHtml(part.aircraft)}</td>
      <td>${part.no}</td>
      <td><a class="link-primary" href="${editUrl}">${escapeHtml(part.partNumber)}</a></td>
      <td>${escapeHtml(part.partDescription)}</td>
      <td>${part.picture ? `<img src="${escapeHtml(part.picture)}" alt="" class="part-thumb" />` : '—'}</td>
      <td>${num(part.qpa, 0)}</td>
      <td>${num(part.firstLaunchQty, 0)}</td>
      <td>${escapeHtml(part.firstDelivery)}</td>
      <td>${escapeHtml(part.materialSpec)}</td>
      <td>${num(part.finishThickness)}</td>
      <td>${num(part.finishWidth)}</td>
      <td>${num(part.finishLength)}</td>
      <td>${num(part.materialRulingDim)}</td>
      <td>${num(part.materialThickness)}</td>
      <td>${num(part.materialWidth)}</td>
      <td>${num(part.materialLength)}</td>
      <td>${num(part.qtyPerBillet, 0)}</td>
      <td>${num(part.setupTimeHour)}</td>
      <td>${num(part.cycleTurnMill)}</td>
      <td>${num(part.cycle3x)}</td>
      <td>${num(part.cycle4x)}</td>
      <td>${num(part.cycle5x)}</td>
      <td>${num(part.cycleTotalHrs)}</td>
      <td><a class="btn-link" href="${editUrl}">Edit</a></td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  render().catch(console.error);
});
