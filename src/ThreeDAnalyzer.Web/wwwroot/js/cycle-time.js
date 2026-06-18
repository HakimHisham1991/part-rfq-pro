import {
  getMachineProfiles,
  getMaterialSpecs,
  getOperationTemplates,
  getPart,
  getPartCycleData,
  savePartCycleData
} from './data-store.js';
import {
  applyMachineProfileToOther,
  buildRawMaterialFromPart,
  calcFinishPartValues,
  findMachineProfileById,
  findMaterialSpecById,
  GENERIC_MACHINE_NAME,
  lookupMachineProfile,
  lookupMaterialSpec,
  materialDisplayLabel,
  normalizeCycleData,
  newOpId,
  sortMachineProfiles
} from './cycle-time-migration.js';
import {
  deletePartModelFile,
  getPartModelFile,
  savePartModelFile
} from './part-model-store.js';
import { analyzeStepFile } from './step-analyzer.js';
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
  QUOTE_HR_STEP,
  recalcOperations,
  roundUpTo
} from './operation-formulas.js?v=1.15.2';
import { bindModal, closeModal, openModal } from './settings-modal.js';

const ADD_MODAL_ID = 'cycle-add-modal';

let state = {
  projectId: null,
  partId: null,
  part: null,
  data: null,
  templates: [],
  materialSpecs: [],
  machineProfiles: [],
  computed: null,
  rawMaterial: null,
  finishComputed: null
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

function activeMaterialSpecs() {
  return [...state.materialSpecs]
    .filter((s) => String(s.status).toLowerCase() === 'active')
    .sort((a, b) => String(a.specification).localeCompare(String(b.specification)));
}

function getSelectedMaterialSpecRow() {
  return findMaterialSpecById(state.materialSpecs, state.data?.rawMaterial?.materialSpecId);
}

function resolveInitialMaterialSpec() {
  if (!state.data?.rawMaterial) return;
  const raw = state.data.rawMaterial;
  if (raw.materialSpecId != null) {
    if (findMaterialSpecById(state.materialSpecs, raw.materialSpecId)) return;
    raw.materialSpecId = null;
  }
  const matched = lookupMaterialSpec(state.materialSpecs, state.part?.materialSpec);
  if (matched) raw.materialSpecId = matched.id;
}

function activeMachineProfiles() {
  return sortMachineProfiles(
    state.machineProfiles.filter((m) => String(m.status ?? m.Status).toLowerCase() === 'active')
  );
}

function findGenericMachineProfile() {
  return lookupMachineProfile(state.machineProfiles, GENERIC_MACHINE_NAME);
}

function applyGenericMachineProfile() {
  if (!state.data?.other) return false;
  const profile = findGenericMachineProfile();
  if (!profile) return false;
  applyMachineProfileToOther(state.data.other, profile);
  state.data.other.loadUnload = 15;
  state.data.other.toolChanges = 10;
  return true;
}

function getSelectedMachineProfile(other) {
  if (!other) return null;
  if (other.machineProfileId != null) {
    const profile = findMachineProfileById(state.machineProfiles, other.machineProfileId);
    if (profile) return profile;
  }
  return lookupMachineProfile(state.machineProfiles, other.machine);
}

function syncOtherFromMachineProfile(other) {
  if (!other) return;
  const profile = getSelectedMachineProfile(other);
  if (profile) {
    applyMachineProfileToOther(other, profile);
    return;
  }
  other.axisTypes = '';
}

function resolveInitialMachineProfile() {
  if (!state.data?.other) return;
  const other = state.data.other;
  if (other.machineProfileId != null) {
    const profile = findMachineProfileById(state.machineProfiles, other.machineProfileId);
    if (profile) {
      syncOtherFromMachineProfile(other);
      return;
    }
    other.machineProfileId = null;
  }
  const matched = lookupMachineProfile(state.machineProfiles, other.machine);
  if (matched) {
    syncOtherFromMachineProfile(other);
    return;
  }
  if (isOtherFactorsEnabled()) {
    applyGenericMachineProfile();
  }
}

function applySelectedMachineProfile(profileIdRaw) {
  if (!state.data?.other) return;
  const profileId = profileIdRaw ? Number(profileIdRaw) : null;
  if (!profileId) {
    state.data.other.machineProfileId = null;
    state.data.other.machine = '';
    state.data.other.axisTypes = '';
    state.data.other.rapidRate = 0;
    state.data.other.spindlePower = 0;
    state.data.other.accel = 0;
    state.data.other.toolChangeSec = 0;
    recalcAll();
    renderOtherFields();
    renderTotals();
    refreshSummary();
    persist().catch(console.error);
    return;
  }

  const profile = findMachineProfileById(state.machineProfiles, profileId);
  if (!profile) return;

  applyMachineProfileToOther(state.data.other, profile);
  recalcAll();
  renderOtherFields();
  renderTotals();
  refreshSummary();
  persist().catch(console.error);
}

function zeroOtherFactors() {
  if (!state.data?.other) return;
  const other = state.data.other;
  other.loadUnload = 0;
  other.toolChanges = 0;
  other.machineProfileId = null;
  other.machine = '';
  other.axisTypes = '';
  other.rapidRate = 0;
  other.spindlePower = 0;
  other.accel = 0;
  other.toolChangeSec = 0;
}

function setOtherFactorsEnabled(enabled) {
  if (!state.data?.other) return;
  state.data.other.enabled = enabled;
  if (!enabled) {
    zeroOtherFactors();
  } else {
    applyGenericMachineProfile();
  }
  recalcAll();
  renderOtherFields();
  renderTotals();
  refreshSummary();
  persist().catch(console.error);
}

function isOtherFactorsEnabled() {
  return state.data?.other?.enabled !== false;
}

function syncRawMaterialFromPart() {
  if (!state.part) return;
  const specRow = getSelectedMaterialSpecRow();
  const savedRaw = state.data?.rawMaterial;
  state.rawMaterial = buildRawMaterialFromPart(state.part, specRow, savedRaw);
  if (state.data) {
    const raw = state.data.rawMaterial;
    raw.length = state.rawMaterial.length;
    raw.width = state.rawMaterial.width;
    raw.thickness = state.rawMaterial.thickness;
    raw.vraw = state.rawMaterial.vraw;
    raw.material = state.rawMaterial.material;
    raw.density = state.rawMaterial.density;
  }
}

function recalcMaterialSize() {
  syncRawMaterialFromPart();
  state.finishComputed = calcFinishPartValues(state.rawMaterial, state.data?.finishPart);
}

function recalcAll() {
  state.data.operations = recalcOperations(state.data.operations);
  state.computed = calcTotals(state.data.operations, state.data.other);
  recalcMaterialSize();
}

function refreshSummary() {
  const partEl = document.getElementById('cycle-part-number');
  const quoteEl = document.getElementById('cycle-quote-hr');
  if (partEl && state.part) partEl.textContent = state.part.partNumber;
  if (quoteEl && state.computed) {
    const quoteHr = roundUpTo(state.computed.overallHr, QUOTE_HR_STEP);
    quoteEl.textContent = formatNum(quoteHr, 1);
  }
}

function analyzerUrl() {
  if (!state.projectId || !state.partId) return '/Analyzer';
  return `/Analyzer?projectId=${encodeURIComponent(state.projectId)}&partId=${encodeURIComponent(state.partId)}`;
}

function hasModel3d() {
  return Boolean(state.data?.model3d?.fileName);
}

function renderModel3d() {
  const nameCell = document.getElementById('cycle-3d-model-name');
  const deleteBtn = document.getElementById('btn-3d-model-delete');
  const editBtn = document.getElementById('btn-3d-model-edit');
  if (!nameCell) return;

  const fileName = state.data?.model3d?.fileName ?? '';
  if (fileName) {
    const url = analyzerUrl();
    nameCell.innerHTML = `<a class="link-primary" href="${url}" data-3d-model-open>${escapeHtml(fileName)}</a>`;
    if (deleteBtn) deleteBtn.disabled = false;
    if (editBtn) editBtn.disabled = false;
  } else {
    nameCell.textContent = '—';
    if (deleteBtn) deleteBtn.disabled = true;
    if (editBtn) editBtn.disabled = true;
  }
}

function clearRawMaterialFrom3d() {
  if (!state.data?.rawMaterial) return;
  state.data.rawMaterial.length = 0;
  state.data.rawMaterial.width = 0;
  state.data.rawMaterial.thickness = 0;
  state.data.rawMaterial.vraw = 0;
}

function clearFinishPartFrom3d() {
  if (!state.data?.finishPart) return;
  state.data.finishPart.vfin = 0;
}

async function getStoredModelAnalysis() {
  const model = state.data?.model3d;
  if (!model?.fileName) return null;
  const stored = await getPartModelFile(state.projectId, state.partId);
  if (!stored?.arrayBuffer?.byteLength) return null;
  const analysis = await analyzeStepFile(stored.arrayBuffer, model.stockOffsets);
  model.analysis = analysis;
  return analysis;
}

function retrieveRawFromRfq() {
  if (!state.part || !state.data?.rawMaterial) return;
  const length = Number(state.part.materialLength) || 0;
  const width = Number(state.part.materialWidth) || 0;
  const thickness = Number(state.part.materialThickness) || 0;
  state.data.rawMaterial.length = length;
  state.data.rawMaterial.width = width;
  state.data.rawMaterial.thickness = thickness;
  state.data.rawMaterial.vraw = length * width * thickness;
  recalcAll();
  renderMaterialSize();
  persist().catch(console.error);
}

async function retrieveRawFrom3d() {
  if (!hasModel3d()) {
    alert('No 3D model available. Add a STEP file in the 3D Model section first.');
    clearRawMaterialFrom3d();
    recalcAll();
    renderMaterialSize();
    persist().catch(console.error);
    return;
  }

  try {
    const analysis = await getStoredModelAnalysis();
    if (!analysis) {
      alert('3D model file not found. Re-add the STEP file in the 3D Model section.');
      clearRawMaterialFrom3d();
      recalcAll();
      renderMaterialSize();
      persist().catch(console.error);
      return;
    }

    state.data.rawMaterial.length = analysis.bboxW;
    state.data.rawMaterial.width = analysis.bboxH;
    state.data.rawMaterial.thickness = analysis.bboxD;
    state.data.rawMaterial.vraw = analysis.stockVolume;
    recalcAll();
    renderMaterialSize();
    await persist();
  } catch (err) {
    console.error(err);
    alert(`Failed to retrieve raw material from 3D model: ${err.message}`);
    clearRawMaterialFrom3d();
    recalcAll();
    renderMaterialSize();
    persist().catch(console.error);
  }
}

async function retrieveFinishFrom3d() {
  if (!hasModel3d()) {
    alert('No 3D model available. Add a STEP file in the 3D Model section first.');
    clearFinishPartFrom3d();
    recalcAll();
    renderMaterialSize();
    persist().catch(console.error);
    return;
  }

  try {
    const analysis = await getStoredModelAnalysis();
    if (!analysis) {
      alert('3D model file not found. Re-add the STEP file in the 3D Model section.');
      clearFinishPartFrom3d();
      recalcAll();
      renderMaterialSize();
      persist().catch(console.error);
      return;
    }

    state.data.finishPart.vfin = analysis.partVolume;
    recalcAll();
    renderMaterialSize();
    await persist();
  } catch (err) {
    console.error(err);
    alert(`Failed to retrieve finish part from 3D model: ${err.message}`);
    clearFinishPartFrom3d();
    recalcAll();
    renderMaterialSize();
    persist().catch(console.error);
  }
}

async function addModel3dFile(file) {
  if (!file || !state.data) return;
  const buffer = await file.arrayBuffer();
  await savePartModelFile(state.projectId, state.partId, file.name, buffer);
  const analysis = await analyzeStepFile(buffer, state.data.model3d.stockOffsets);
  state.data.model3d.fileName = file.name;
  state.data.model3d.analysis = analysis;
  renderModel3d();
  await persist();
}

async function deleteModel3d() {
  if (!state.data?.model3d?.fileName) return;
  if (!confirm('Delete the 3D model for this part?')) return;
  await deletePartModelFile(state.projectId, state.partId);
  state.data.model3d.fileName = '';
  state.data.model3d.analysis = null;
  renderModel3d();
  await persist();
}

function openModelInAnalyzer() {
  if (!hasModel3d()) {
    alert('No 3D model available. Add a STEP file first.');
    return;
  }
  window.location.href = analyzerUrl();
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
  if (!isOtherFactorsEnabled()) return;
  if (['rapidRate', 'spindlePower', 'accel', 'toolChangeSec'].includes(key)) return;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  state.data.other[key] = Number.isFinite(n) ? n : 0;
  recalcAll();
  refreshSummary();
  renderTotals();
  persist().catch(console.error);
}

function updateFinishComputedCells() {
  const fin = state.finishComputed;
  const rows = document.getElementById('cycle-finish-part-tbody')?.querySelectorAll('tr');
  if (!fin || !rows || rows.length < 4) return;
  rows[2].cells[1].innerHTML = `<span class="cell-readonly">${escapeHtml(formatNum(fin.vOffcutUnmachined))}</span>`;
  rows[3].cells[1].innerHTML = `<span class="cell-readonly">${escapeHtml(formatNum(fin.vToMachine))}</span>`;
}

function updateFinishPart(key, raw) {
  if (!state.data?.finishPart) return;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  if (key === 'offcutPct') {
    state.data.finishPart.offcutPct = Number.isFinite(n) ? n / 100 : 0;
  } else {
    state.data.finishPart[key] = Number.isFinite(n) ? n : 0;
  }
  recalcMaterialSize();
  updateFinishComputedCells();
  persist().catch(console.error);
}

function updateRawMaterialComputedCells() {
  const raw = state.rawMaterial;
  const rows = document.getElementById('cycle-raw-material-tbody')?.querySelectorAll('tr');
  if (!raw || !rows || rows.length < 7) return;
  rows[5].cells[1].innerHTML = `<span class="cell-readonly">${escapeHtml(formatNum(raw.density, 0))}</span>`;
  rows[6].cells[1].innerHTML = `<span class="cell-readonly">${escapeHtml(formatNum(raw.weight, 8))}</span>`;
}

function updateRawMaterialMaterial(specIdRaw) {
  if (!state.data?.rawMaterial) return;
  const specId = specIdRaw ? Number(specIdRaw) : null;
  state.data.rawMaterial.materialSpecId = specId;
  syncRawMaterialFromPart();
  updateRawMaterialComputedCells();
  updateFinishComputedCells();
  persist().catch(console.error);
}

function materialRow(label, value, unit, { editable = false, field = null, digits = 2 } = {}) {
  const dataCell = editable
    ? `<input type="number" class="cell-input" step="any" data-finish="${field}" value="${value}" />`
    : `<span class="cell-readonly">${escapeHtml(value)}</span>`;
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td>${dataCell}</td>
    <td>${escapeHtml(unit)}</td>
  </tr>`;
}

function materialSelectRow(label, specs, selectedId, unit) {
  const opts = specs
    .map((s) => {
      const optLabel = materialDisplayLabel(null, s);
      const selected = s.id === selectedId ? ' selected' : '';
      return `<option value="${s.id}"${selected}>${escapeHtml(optLabel)}</option>`;
    })
    .join('');
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td><select class="cell-input cell-select-sm" data-raw-material="materialSpecId">
      <option value="">— Select —</option>${opts}</select></td>
    <td>${escapeHtml(unit)}</td>
  </tr>`;
}

function renderMaterialSize() {
  const rawBody = document.getElementById('cycle-raw-material-tbody');
  const finishBody = document.getElementById('cycle-finish-part-tbody');
  if (!rawBody || !finishBody || !state.rawMaterial || !state.finishComputed) return;

  const raw = state.rawMaterial;
  const selectedId = state.data?.rawMaterial?.materialSpecId ?? null;
  rawBody.innerHTML = [
    materialRow('Lraw', formatNum(raw.length), 'mm'),
    materialRow('Wraw', formatNum(raw.width), 'mm'),
    materialRow('Traw', formatNum(raw.thickness), 'mm'),
    materialRow('Vraw', formatNum(raw.vraw), 'mm3'),
    materialSelectRow('Material', activeMaterialSpecs(), selectedId, '-'),
    materialRow('Density', formatNum(raw.density, 0), 'kg/m3'),
    materialRow('Weight', formatNum(raw.weight, 8), 'kg')
  ].join('');

  const fin = state.finishComputed;
  const offcutDisplay = formatNum(fin.offcutPct * 100, 0);
  finishBody.innerHTML = [
    materialRow('Vfin', fin.vfin, 'mm3', { editable: true, field: 'vfin', digits: 2 }),
    materialRow('Percent Offcut Unmachined', offcutDisplay, '%', {
      editable: true,
      field: 'offcutPct',
      digits: 0
    }),
    materialRow('V offcut unmachined', formatNum(fin.vOffcutUnmachined), 'mm3'),
    materialRow('V to machine', formatNum(fin.vToMachine), 'mm3')
  ].join('');
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
  const panel = document.getElementById('cycle-other-panel');
  const toggle = document.getElementById('cycle-other-enabled');
  const wrap = document.getElementById('cycle-other-fields');
  if (!wrap || !state.data) return;
  const o = state.data.other;
  const enabled = isOtherFactorsEnabled();
  const disabledAttr = enabled ? '' : ' disabled';
  const readonlyAttr = ' readonly';
  const readonlyClass = ' cell-input-readonly';

  if (panel) panel.classList.toggle('is-disabled', !enabled);
  if (toggle) toggle.checked = enabled;
  if (enabled) syncOtherFromMachineProfile(o);

  const show = (value) => (enabled ? value : '');
  const showAxisTypes = enabled ? (o.axisTypes || '—') : '';
  const selectedId = enabled ? (o.machineProfileId ?? '') : '';
  const machineOptions = activeMachineProfiles()
    .map((m) => {
      const id = m.id ?? m.Id;
      const selected = id === selectedId ? ' selected' : '';
      return `<option value="${id}"${selected}>${escapeHtml(m.name ?? m.Name)}</option>`;
    })
    .join('');

  wrap.innerHTML = `
    <label class="op-field">
      <span class="op-field-label">Load/Unload (min)</span>
      <input type="number" class="cell-input" data-other="loadUnload" step="any" value="${show(o.loadUnload)}"${disabledAttr} />
    </label>
    <label class="op-field">
      <span class="op-field-label">Machine Model</span>
      <select class="cell-input cell-select-sm" data-machine-profile${disabledAttr}>
        <option value="">— Select —</option>${machineOptions}</select>
    </label>
    <label class="op-field">
      <span class="op-field-label">Axis Types</span>
      <input type="text" class="cell-input${readonlyClass}" value="${escapeHtml(showAxisTypes)}"${readonlyAttr} tabindex="-1"${disabledAttr} />
    </label>
    <label class="op-field">
      <span class="op-field-label">Rapid Rate (mmpm)</span>
      <input type="number" class="cell-input${readonlyClass}" data-other="rapidRate" step="any" value="${show(o.rapidRate)}"${readonlyAttr}${disabledAttr} />
    </label>
    <label class="op-field">
      <span class="op-field-label">Spindle Power (kW)</span>
      <input type="number" class="cell-input${readonlyClass}" data-other="spindlePower" step="any" value="${show(o.spindlePower)}"${readonlyAttr}${disabledAttr} />
    </label>
    <label class="op-field">
      <span class="op-field-label">Accel/Decel Factor</span>
      <input type="number" class="cell-input${readonlyClass}" data-other="accel" step="any" value="${show(o.accel)}"${readonlyAttr}${disabledAttr} />
    </label>
    <label class="op-field">
      <span class="op-field-label">No. of Tool Changes</span>
      <input type="number" class="cell-input" data-other="toolChanges" step="any" value="${show(o.toolChanges)}"${disabledAttr} />
    </label>
    <label class="op-field">
      <span class="op-field-label">Tool Change Time (sec)</span>
      <input type="number" class="cell-input${readonlyClass}" data-other="toolChangeSec" step="any" value="${show(o.toolChangeSec)}"${readonlyAttr}${disabledAttr} />
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
  renderModel3d();
  renderMaterialSize();
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

  document.getElementById('cycle-other-enabled')?.addEventListener('change', (e) => {
    setOtherFactorsEnabled(e.target.checked);
  });

  document.getElementById('cycle-other-fields')?.addEventListener('input', (e) => {
    if (!isOtherFactorsEnabled()) return;
    const input = e.target.closest('[data-other]');
    if (!input || input.readOnly) return;
    updateOther(input.getAttribute('data-other'), input.value);
  });

  document.getElementById('cycle-other-fields')?.addEventListener('change', (e) => {
    if (!isOtherFactorsEnabled()) return;
    const machineSelect = e.target.closest('[data-machine-profile]');
    if (machineSelect) {
      applySelectedMachineProfile(machineSelect.value);
      return;
    }
    const input = e.target.closest('[data-other]');
    if (!input || input.readOnly) return;
    updateOther(input.getAttribute('data-other'), input.value);
  });

  document.getElementById('cycle-material-size')?.addEventListener('input', (e) => {
    const input = e.target.closest('[data-finish]');
    if (!input) return;
    updateFinishPart(input.getAttribute('data-finish'), input.value);
  });

  document.getElementById('cycle-material-size')?.addEventListener('change', (e) => {
    const select = e.target.closest('[data-raw-material]');
    if (!select) return;
    updateRawMaterialMaterial(select.value);
  });

  document.getElementById('btn-3d-model-add')?.addEventListener('click', () => {
    document.getElementById('cycle-3d-model-input')?.click();
  });

  document.getElementById('cycle-3d-model-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    addModel3dFile(file).catch((err) => {
      console.error(err);
      alert(`Failed to add 3D model: ${err.message}`);
    });
  });

  document.getElementById('btn-3d-model-delete')?.addEventListener('click', () => {
    deleteModel3d().catch((err) => {
      console.error(err);
      alert(`Failed to delete 3D model: ${err.message}`);
    });
  });

  document.getElementById('btn-3d-model-edit')?.addEventListener('click', openModelInAnalyzer);

  document.getElementById('cycle-3d-model-table')?.addEventListener('click', (e) => {
    const link = e.target.closest('[data-3d-model-open]');
    if (!link) return;
    e.preventDefault();
    openModelInAnalyzer();
  });

  document.getElementById('btn-retrieve-raw-rfq')?.addEventListener('click', retrieveRawFromRfq);

  document.getElementById('btn-retrieve-raw-3d')?.addEventListener('click', () => {
    retrieveRawFrom3d().catch(console.error);
  });

  document.getElementById('btn-retrieve-finish-3d')?.addEventListener('click', () => {
    retrieveFinishFrom3d().catch(console.error);
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
    finishPart: state.data.finishPart,
    model3d: state.data.model3d,
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
  let materialSpecs;
  let machineProfiles;
  try {
    [part, saved, templates, materialSpecs, machineProfiles] = await Promise.all([
      getPart(projectId, partId),
      getPart(projectId, partId).then((p) =>
        p ? getPartCycleData(projectId, partId) : null
      ),
      getOperationTemplates(),
      getMaterialSpecs(),
      getMachineProfiles()
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
  state.materialSpecs = materialSpecs ?? [];
  state.machineProfiles = machineProfiles ?? [];
  state.data = normalizeCycleData(saved, part);
  resolveInitialMaterialSpec();
  resolveInitialMachineProfile();
  if (!isOtherFactorsEnabled()) {
    zeroOtherFactors();
  }

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
