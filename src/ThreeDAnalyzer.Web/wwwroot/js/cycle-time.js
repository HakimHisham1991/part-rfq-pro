import {
  getOperationTemplates,
  getPart,
  getPartCycleData,
  savePartCycleData
} from './data-store.js';
import { normalizeCycleData, newOpId } from './cycle-time-migration.js';
import {
  OPERATION_TYPES,
  TABLE_DATA_COLUMNS,
  getActiveColumns,
  isColumnActive,
  mergeParams
} from './operation-field-schemas.js';
import {
  calcMrr,
  calcOperationCt,
  calcTotals,
  recalcOperations
} from './operation-formulas.js';
import { bindModal, closeModal, openModal } from './settings-modal.js';

const ADD_MODAL_ID = 'cycle-add-modal';

let state = {
  projectId: null,
  partId: null,
  part: null,
  data: null,
  templates: [],
  computed: null
};

function formatNum(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recalcAll() {
  state.data.operations = recalcOperations(state.data.operations);
  state.computed = calcTotals(state.data.operations, state.data.other);
}

function refreshSummary() {
  const partEl = document.getElementById('cycle-part-number');
  const quoteEl = document.getElementById('cycle-quote-hr');
  if (partEl && state.part) partEl.textContent = state.part.partNumber;
  if (quoteEl && state.computed) {
    quoteEl.textContent = formatNum(state.computed.quoteHr);
  }
}

function sortedOperations() {
  return [...(state.data?.operations ?? [])].sort((a, b) => a.order - b.order);
}

function reindexOperations() {
  sortedOperations().forEach((op, i) => {
    op.order = i + 1;
  });
}

function createOperationFromTemplate(template, overrides = {}) {
  const type = template?.operationType ?? overrides.type ?? 'Manual Operation';
  const name = overrides.name ?? template?.name ?? type;
  const params = mergeParams(type, { ...(template?.params ?? {}), ...(overrides.params ?? {}) });
  const op = {
    id: newOpId(),
    order: (state.data.operations?.length ?? 0) + 1,
    name,
    type,
    templateId: template?.id ?? null,
    params
  };
  op.ctMin = calcOperationCt(op);
  return op;
}

function addOperation(template = null, typeOverride = null) {
  if (!state.data) return;
  const type = typeOverride ?? template?.operationType ?? 'Manual Operation';
  const op = template
    ? createOperationFromTemplate(template)
    : createOperationFromTemplate({ operationType: type, name: type, params: {} });
  state.data.operations.push(op);
  reindexOperations();
  recalcAll();
  render();
  persist().catch(console.error);
}

function removeOperation(id) {
  state.data.operations = state.data.operations.filter((o) => o.id !== id);
  reindexOperations();
  recalcAll();
  render();
  persist().catch(console.error);
}

function moveOperation(id, direction) {
  const ops = sortedOperations();
  const idx = ops.findIndex((o) => o.id === id);
  if (idx < 0) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= ops.length) return;
  const tmp = ops[idx].order;
  ops[idx].order = ops[swapIdx].order;
  ops[swapIdx].order = tmp;
  recalcAll();
  render();
  persist().catch(console.error);
}

function updateOperationType(id, newType) {
  const op = state.data.operations.find((o) => o.id === id);
  if (!op || op.type === newType) return;
  op.type = newType;
  op.params = mergeParams(newType, op.params);
  op.ctMin = calcOperationCt(op);
  recalcAll();
  render();
  persist().catch(console.error);
}

function updateOperationName(id, name) {
  const op = state.data.operations.find((o) => o.id === id);
  if (!op) return;
  op.name = name;
}

function updateOperationParam(id, paramKey, raw) {
  const op = state.data.operations.find((o) => o.id === id);
  if (!op) return;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  op.params[paramKey] = Number.isFinite(n) ? n : 0;
  if (op.type === 'Manual Operation' && paramKey === 'minutes') {
    op.ctMin = op.params.minutes;
  } else {
    op.ctMin = calcOperationCt(op);
  }
  recalcAll();
  refreshSummary();
  renderTotals();
  updateRowComputedCells(op);
  persist().catch(console.error);
}

function updateOther(key, raw) {
  if (key === 'machine') {
    state.data.other.machine = String(raw);
  } else {
    const n = parseFloat(String(raw).replace(/,/g, ''));
    state.data.other[key] = Number.isFinite(n) ? n : 0;
  }
  recalcAll();
  refreshSummary();
  renderTotals();
  persist().catch(console.error);
}

function renderCell(op, col) {
  const active = isColumnActive(op.type, col.key);
  if (!active) {
    return '<td class="cell-na">—</td>';
  }

  if (col.key === 'mrr') {
    const mrr = calcMrr(op.type, op.params);
    return `<td class="cell-readonly" data-col="mrr" data-op-id="${op.id}">${formatNum(mrr)}</td>`;
  }

  if (col.key === 'ct') {
    if (op.type === 'Manual Operation') {
      const val = op.params.minutes ?? op.ctMin ?? 0;
      return `<td><input type="number" class="cell-input cell-input-sm" step="any"
        data-op-id="${op.id}" data-param="minutes" value="${val}" title="Minutes" /></td>`;
    }
    return `<td class="cell-readonly cell-ct" data-col="ct" data-op-id="${op.id}">${formatNum(op.ctMin)}</td>`;
  }

  const val = op.params[col.param] ?? 0;
  return `<td><input type="number" class="cell-input cell-input-sm" step="any"
    data-op-id="${op.id}" data-param="${col.param}" value="${val}" /></td>`;
}

function renderOperationRow(op) {
  const typeOptions = OPERATION_TYPES.map(
    (t) =>
      `<option value="${escapeHtml(t)}"${t === op.type ? ' selected' : ''}>${escapeHtml(t)}</option>`
  ).join('');

  const dataCells = TABLE_DATA_COLUMNS.map((col) => renderCell(op, col)).join('');

  return `<tr data-op-row="${op.id}">
    <td class="col-no">${op.order}</td>
    <td class="col-name">
      <input type="text" class="cell-input cell-input-name" data-op-name="${op.id}"
        value="${escapeHtml(op.name)}" />
    </td>
    <td class="col-type">
      <select class="cell-input cell-select-sm" data-op-type="${op.id}">${typeOptions}</select>
    </td>
    ${dataCells}
    <td class="col-actions">
      <button type="button" class="btn-icon" data-move-up="${op.id}" title="Move up">↑</button>
      <button type="button" class="btn-icon" data-move-down="${op.id}" title="Move down">↓</button>
      <button type="button" class="btn-icon btn-icon-danger" data-delete-op="${op.id}" title="Delete">×</button>
    </td>
  </tr>`;
}

function updateRowComputedCells(op) {
  const mrrCell = document.querySelector(`[data-col="mrr"][data-op-id="${op.id}"]`);
  if (mrrCell) mrrCell.textContent = formatNum(calcMrr(op.type, op.params));
  const ctCell = document.querySelector(`[data-col="ct"][data-op-id="${op.id}"]`);
  if (ctCell) ctCell.textContent = formatNum(op.ctMin);
}

function renderOperationsTable() {
  const tbody = document.getElementById('cycle-operations-tbody');
  const empty = document.getElementById('cycle-operations-empty');
  if (!tbody) return;

  const ops = sortedOperations();
  if (ops.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  tbody.innerHTML = ops.map(renderOperationRow).join('');
}

function renderOtherFields() {
  const wrap = document.getElementById('cycle-other-fields');
  if (!wrap || !state.data) return;
  const o = state.data.other;
  wrap.innerHTML = `
    <label class="op-field">
      <span class="op-field-label">Load/Unload (min)</span>
      <input type="number" class="cell-input" data-other="loadUnload" step="any" value="${o.loadUnload}" />
    </label>
    <label class="op-field">
      <span class="op-field-label">Machine</span>
      <input type="text" class="cell-input" data-other="machine" value="${escapeHtml(o.machine)}" />
    </label>
    <label class="op-field">
      <span class="op-field-label">Accel/Decel Factor</span>
      <input type="number" class="cell-input" data-other="accel" step="any" value="${o.accel}" />
    </label>
    <label class="op-field">
      <span class="op-field-label">No. of Tool Changes</span>
      <input type="number" class="cell-input" data-other="toolChanges" step="any" value="${o.toolChanges}" />
    </label>
    <label class="op-field">
      <span class="op-field-label">Tool Change Time (sec)</span>
      <input type="number" class="cell-input" data-other="toolChangeSec" step="any" value="${o.toolChangeSec}" />
    </label>`;
}

function renderTotals() {
  const el = document.getElementById('cycle-totals');
  if (!el || !state.computed) return;
  const c = state.computed;
  el.innerHTML = `
    <div class="cycle-totals-row"><span>Total Machining CT</span><strong>${formatNum(c.machiningMin)} min</strong></div>
    <div class="cycle-totals-row"><span>Total Other Factor CT</span><strong>${formatNum(c.otherMin)} min</strong></div>
    <div class="cycle-totals-row cycle-totals-overall"><span>Total Overall CT</span><strong>${formatNum(c.overallMin)} min (${formatNum(c.overallHr)} hr)</strong></div>`;
}

function render() {
  recalcAll();
  renderOperationsTable();
  renderOtherFields();
  renderTotals();
  refreshSummary();
}

function populateAddModal(typeFilter = null) {
  const typeSelect = document.getElementById('cycle-add-type');
  const templateSelect = document.getElementById('cycle-add-template');
  if (!typeSelect || !templateSelect) return;

  typeSelect.innerHTML = OPERATION_TYPES.map(
    (t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`
  ).join('');

  if (typeFilter) typeSelect.value = typeFilter;

  function refreshTemplates() {
    const type = typeSelect.value;
    const active = state.templates.filter(
      (t) => t.status === 'Active' && t.operationType === type
    );
    templateSelect.innerHTML =
      '<option value="">— Blank defaults —</option>' +
      active.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  }

  typeSelect.onchange = refreshTemplates;
  refreshTemplates();
}

function openAddModal(typeFilter = null) {
  populateAddModal(typeFilter);
  openModal(ADD_MODAL_ID);
}

function quickAddByType(type) {
  const active = state.templates.filter(
    (t) => t.status === 'Active' && t.operationType === type
  );
  if (active.length === 1) {
    addOperation(active[0]);
    return;
  }
  if (active.length > 1) {
    openAddModal(type);
    const templateSelect = document.getElementById('cycle-add-template');
    if (templateSelect && active[0]) templateSelect.value = String(active[0].id);
    return;
  }
  addOperation(null, type);
}

function bindEvents() {
  bindModal(ADD_MODAL_ID);

  document.getElementById('btn-add-operation')?.addEventListener('click', () => openAddModal());

  document.getElementById('cycle-quick-add')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick-add]');
    if (!btn) return;
    quickAddByType(btn.getAttribute('data-quick-add'));
  });

  document.getElementById('cycle-add-confirm')?.addEventListener('click', () => {
    const type = document.getElementById('cycle-add-type')?.value;
    const templateId = document.getElementById('cycle-add-template')?.value;
    const template = templateId
      ? state.templates.find((t) => t.id === Number(templateId))
      : null;
    if (template) addOperation(template);
    else addOperation(null, type);
    closeModal(ADD_MODAL_ID);
  });

  const table = document.getElementById('cycle-operations-table');
  table?.addEventListener('input', (e) => {
    const nameInput = e.target.closest('[data-op-name]');
    if (nameInput) {
      updateOperationName(nameInput.getAttribute('data-op-name'), nameInput.value);
      return;
    }
    const paramInput = e.target.closest('[data-param]');
    if (paramInput) {
      updateOperationParam(
        paramInput.getAttribute('data-op-id'),
        paramInput.getAttribute('data-param'),
        paramInput.value
      );
    }
  });

  table?.addEventListener('change', (e) => {
    const nameInput = e.target.closest('[data-op-name]');
    if (nameInput) {
      persist().catch(console.error);
      return;
    }
    const typeSelect = e.target.closest('[data-op-type]');
    if (typeSelect) {
      updateOperationType(typeSelect.getAttribute('data-op-type'), typeSelect.value);
    }
  });

  table?.addEventListener('click', (e) => {
    const up = e.target.closest('[data-move-up]');
    if (up) {
      moveOperation(up.getAttribute('data-move-up'), -1);
      return;
    }
    const down = e.target.closest('[data-move-down]');
    if (down) {
      moveOperation(down.getAttribute('data-move-down'), 1);
      return;
    }
    const del = e.target.closest('[data-delete-op]');
    if (del && confirm('Delete this operation?')) {
      removeOperation(del.getAttribute('data-delete-op'));
    }
  });

  document.getElementById('cycle-other-fields')?.addEventListener('change', (e) => {
    const input = e.target.closest('[data-other]');
    if (!input) return;
    updateOther(input.getAttribute('data-other'), input.value);
  });

  document.getElementById('btn-save-cycle')?.addEventListener('click', () => {
    const saveBtn = document.getElementById('btn-save-cycle');
    persist()
      .then(() => {
        if (saveBtn) {
          saveBtn.textContent = 'Saved';
          setTimeout(() => {
            saveBtn.textContent = 'Save';
          }, 1500);
        }
      })
      .catch((err) => {
        console.error(err);
        if (saveBtn) saveBtn.textContent = 'Error';
      });
  });
}

async function persist() {
  if (!state.projectId || !state.partId || !state.data) return;
  recalcAll();
  await savePartCycleData(state.projectId, state.partId, {
    version: 2,
    operations: state.data.operations,
    other: state.data.other,
    rawMaterial: state.data.rawMaterial,
    computed: state.computed,
    updatedAt: new Date().toISOString()
  });
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const partId = params.get('partId');
  const subtitle = document.getElementById('cycle-subtitle');
  const wrap = document.getElementById('cycle-editor-wrap');
  const empty = document.getElementById('cycle-empty');
  const quickAdd = document.getElementById('cycle-quick-add');

  if (!projectId || !partId) {
    if (subtitle) subtitle.textContent = 'Select a part from Project RFQ.';
    if (wrap) wrap.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  let part;
  let saved;
  let templates;
  try {
    [part, saved, templates] = await Promise.all([
      getPart(projectId, partId),
      getPart(projectId, partId).then((p) =>
        p ? getPartCycleData(projectId, partId) : null
      ),
      getOperationTemplates()
    ]);
  } catch (err) {
    if (subtitle) subtitle.textContent = 'Error loading part.';
    if (empty) {
      empty.hidden = false;
      empty.textContent = err.message;
    }
    return;
  }

  if (!part) {
    if (subtitle) subtitle.textContent = 'Part not found.';
    if (wrap) wrap.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  state.projectId = projectId;
  state.partId = partId;
  state.part = part;
  state.templates = templates ?? [];
  state.data = normalizeCycleData(saved, part);

  if (subtitle) {
    subtitle.textContent = `Project ID ${projectId} · ${part.partDescription}`;
  }
  if (wrap) wrap.hidden = false;
  if (empty) empty.hidden = true;
  if (quickAdd) quickAdd.hidden = false;

  const back = document.getElementById('back-to-rfq');
  if (back) back.href = `/ProjectRfq?projectId=${encodeURIComponent(projectId)}`;

  bindEvents();
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});
