import { createProject, getProjects, renameProject } from './data-store.js';
import { bindModal, closeModal, openModal, showModalError } from './settings-modal.js';
import { onDomReady } from './dom-ready.js';

const ADD_PROJECT_MODAL_ID = 'project-add-modal';
const RENAME_PROJECT_MODAL_ID = 'project-rename-modal';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function todayIsoDate() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getDefaultOwner() {
  return document.getElementById('projects-page')?.dataset.currentOwner?.trim() ?? '';
}

let projectsCache = [];

function openAddProjectModal() {
  document.getElementById('project-name').value = '';
  document.getElementById('project-owner').value = getDefaultOwner();
  document.getElementById('project-date-registered').value = todayIsoDate();
  document.getElementById('project-status').value = 'Open';
  showModalError(document.getElementById('project-add-modal-error'), '');
  openModal(ADD_PROJECT_MODAL_ID);
}

function openRenameProjectModal(project) {
  document.getElementById('project-rename-id').value = String(project.id);
  document.getElementById('project-rename-name').value = project.name ?? '';
  showModalError(document.getElementById('project-rename-modal-error'), '');
  openModal(RENAME_PROJECT_MODAL_ID);
  document.getElementById('project-rename-name')?.focus();
  document.getElementById('project-rename-name')?.select();
}

async function renderTable() {
  const tbody = document.querySelector('#projects-table tbody');
  const empty = document.getElementById('projects-empty');
  if (!tbody) return;

  let projects;
  try {
    projects = await getProjects();
    projectsCache = projects;
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
      <td>
        <span class="table-action-btns">
          <a class="btn-link" href="${rfqUrl}">Edit</a>
          <button type="button" class="btn-link" data-rename-project="${p.id}">Rename</button>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

onDomReady(() => {
  bindModal(ADD_PROJECT_MODAL_ID, {
    onClose: () => showModalError(document.getElementById('project-add-modal-error'), '')
  });

  bindModal(RENAME_PROJECT_MODAL_ID, {
    onClose: () => showModalError(document.getElementById('project-rename-modal-error'), '')
  });

  document.getElementById('btn-add-project')?.addEventListener('click', openAddProjectModal);

  document.querySelector('#projects-table tbody')?.addEventListener('click', (e) => {
    const renameBtn = e.target.closest('[data-rename-project]');
    if (!renameBtn) return;

    const projectId = Number(renameBtn.getAttribute('data-rename-project'));
    const project = projectsCache.find((p) => p.id === projectId);
    if (!project) return;

    openRenameProjectModal(project);
  });

  document.getElementById('project-add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errorEl = document.getElementById('project-add-modal-error');
    const name = document.getElementById('project-name').value.trim();
    const owner = document.getElementById('project-owner').value.trim();
    const dateRegistered = document.getElementById('project-date-registered').value;
    const status = document.getElementById('project-status').value;

    if (!name) {
      showModalError(errorEl, 'Project name is required.');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      await createProject({ name, owner, dateRegistered, status });
      closeModal(ADD_PROJECT_MODAL_ID);
      await renderTable();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to add project.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  document.getElementById('project-rename-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errorEl = document.getElementById('project-rename-modal-error');
    const projectId = Number(document.getElementById('project-rename-id').value);
    const name = document.getElementById('project-rename-name').value.trim();

    if (!projectId) return;

    if (!name) {
      showModalError(errorEl, 'Project name is required.');
      return;
    }

    const saveBtn = e.submitter ?? e.target.querySelector('[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      await renameProject(projectId, name);
      closeModal(RENAME_PROJECT_MODAL_ID);
      await renderTable();
    } catch (err) {
      showModalError(errorEl, err.message || 'Failed to rename project.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  renderTable().catch(console.error);
});
