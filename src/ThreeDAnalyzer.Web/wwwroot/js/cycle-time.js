import { getMaterialSpecs, getPart, getPartCycleData, savePartCycleData } from './data-store.js';

function materialLabel(spec) {
  return `${spec.generalName} (${spec.specification})`;
}

function findSpecByMaterialValue(specs, value) {
  if (!value || !specs?.length) return null;
  const v = String(value);
  return (
    specs.find((s) => materialLabel(s) === v) ??
    specs.find((s) => v.includes(s.specification)) ??
    specs.find((s) => v.includes(s.generalName)) ??
    null
  );
}

function applyMaterialSelection(spec) {
  if (!spec) {
    state.values['raw.Material'] = '';
    state.values['raw.Density'] = 0;
    return;
  }
  state.values['raw.Material'] = materialLabel(spec);
  state.values['raw.Density'] = Number(spec.density) || 0;
}

function syncDensityFromMaterial() {
  const spec = findSpecByMaterialValue(state.materialSpecs, state.values['raw.Material']);
  if (spec) state.values['raw.Density'] = Number(spec.density) || 0;
}

function ceilingTo(value, step) {
  if (!Number.isFinite(value) || step <= 0) return 0;
  return Math.ceil(value / step) * step;
}

function defaultValues(part, specs) {
  const activeSpecs = (specs ?? []).filter((s) => s.status === 'Active');
  const matched =
    activeSpecs.find((s) => s.specification === part?.materialSpec) ?? activeSpecs[0] ?? null;

  const values = {
    'raw.Lraw': part?.materialLength ?? 2032,
    'raw.Wraw': part?.materialWidth ?? 266.7,
    'raw.Traw': part?.materialThickness ?? 50.8,
    'raw.Material': '',
    'raw.Density': 0,
    'finish.Vfin': 1227661.58,
    'finish.OffcutPct': 0.3,
    'tooling.Large': 0.05,
    'tooling.Medium': 0.95,
    'tooling.Small': 0,
    'large.D': 63,
    'large.ap': 2,
    'large.F': 4000,
    'medium.D': 16,
    'medium.ap': 50,
    'medium.ae': 1.5,
    'medium.F': 2500,
    'small.D': 6,
    'small.ap': 0.3,
    'small.ae': 0.3,
    'small.F': 400,
    'ball.ap': 0.3,
    'ball.ae': 0.3,
    'ball.F': 5000,
    'ball.Area': 180435,
    'ball.StockLeft': 0.5,
    'profile.F': 400,
    'profile.Length': 20000,
    'drill.ap': 5,
    'drill.F': 300,
    'drill.Holes': 132,
    'other.LoadUnload': 15,
    'other.Machine': 'Hartford Aero-426',
    'other.Accel': 1.3,
    'other.ToolChanges': 50,
    'other.ToolChangeSec': 15
  };

  if (matched) {
    values['raw.Material'] = materialLabel(matched);
    values['raw.Density'] = Number(matched.density) || 0;
  }
  return values;
}

/** @param {Record<string, number|string>} v */
function recalcValues(v) {
  const n = (key) => {
    const x = v[key];
    return typeof x === 'number' ? x : parseFloat(x);
  };

  v['raw.Vraw'] = n('raw.Lraw') * n('raw.Wraw') * n('raw.Traw');
  v['raw.Weight'] = (n('raw.Density') * n('raw.Vraw')) / 1e9;

  const vraw = n('raw.Vraw');
  const offcutPct = n('finish.OffcutPct');
  v['finish.VOffcut'] = offcutPct * vraw;
  v['finish.VToMachine'] = vraw - v['finish.VOffcut'] - n('finish.Vfin');

  const vToMachine = n('finish.VToMachine');
  v['materialUtil.Utilized'] = vraw > 0 ? vToMachine / vraw : 0;
  v['materialUtil.Waste'] = 1 - n('materialUtil.Utilized');

  v['tooling.All'] = n('tooling.Large') + n('tooling.Medium') + n('tooling.Small');

  v['large.ae'] = 0.5 * n('large.D');
  v['large.MRR'] = n('large.ap') * n('large.ae') * n('large.F');
  v['large.V1'] = n('tooling.Large') * vToMachine;
  v['large.CT'] = v['large.MRR'] > 0 ? v['large.V1'] / v['large.MRR'] : 0;

  v['medium.MRR'] = n('medium.ap') * n('medium.ae') * n('medium.F');
  v['medium.V2'] = n('tooling.Medium') * vToMachine;
  v['medium.CT'] = v['medium.MRR'] > 0 ? v['medium.V2'] / v['medium.MRR'] : 0;

  v['small.MRR'] = n('small.ap') * n('small.ae') * n('small.F');
  v['small.V3'] = n('tooling.Small') * vToMachine;
  v['small.CT'] =
    v['small.MRR'] > 0 && v['small.V3'] > 0 ? v['small.V3'] / v['small.MRR'] : 0;

  v['ball.MRR'] = n('ball.ap') * n('ball.ae') * n('ball.F');
  v['ball.V3'] = n('ball.Area') * n('ball.StockLeft');
  v['ball.CT'] = v['ball.MRR'] > 0 ? v['ball.V3'] / v['ball.MRR'] : 0;

  v['profile.CT'] = n('profile.F') > 0 ? n('profile.Length') / n('profile.F') : 0;

  v['drill.CT'] =
    n('drill.F') > 0 ? (n('drill.ap') * n('drill.Holes')) / n('drill.F') : 0;

  v['machining.TotalMin'] =
    n('large.CT') +
    n('medium.CT') +
    n('small.CT') +
    n('ball.CT') +
    n('profile.CT') +
    n('drill.CT');
  v['machining.TotalHr'] = n('machining.TotalMin') / 60;

  v['other.TotalToolChangeMin'] = (n('other.ToolChangeSec') / 60) * n('other.ToolChanges');
  v['other.TotalOtherMin'] = n('other.LoadUnload') + n('other.TotalToolChangeMin');

  v['total.overallMin'] =
    n('machining.TotalMin') * n('other.Accel') + n('other.TotalOtherMin');
  v['total.overallHr'] = n('total.overallMin') / 60;
  v['quote.hr'] = ceilingTo(n('total.overallHr'), 0.5);

  return v;
}

const ROWS = [
  { type: 'header', category: 'Raw Material' },
  { key: 'raw.Lraw', category: 'Raw Material', property: 'Lraw', unit: 'mm', input: true },
  { key: 'raw.Wraw', category: 'Raw Material', property: 'Wraw', unit: 'mm', input: true },
  { key: 'raw.Traw', category: 'Raw Material', property: 'Traw', unit: 'mm', input: true },
  {
    key: 'raw.Vraw',
    category: 'Raw Material',
    property: 'Vraw',
    unit: 'mm3',
    formula: '=(Lraw)*(Wraw)*(Traw)'
  },
  { key: 'raw.Material', category: 'Raw Material', property: 'Material', unit: 'N/A', materialSelect: true },
  { key: 'raw.Density', category: 'Raw Material', property: 'Density', unit: 'kg/m3' },
  {
    key: 'raw.Weight',
    category: 'Raw Material',
    property: 'Weight',
    unit: 'kg',
    formula: '=(Density)*(Vraw)/1000^3'
  },
  { type: 'header', category: 'Finish Part' },
  { key: 'finish.Vfin', category: 'Finish Part', property: 'Vfin', unit: 'mm3', input: true },
  {
    key: 'finish.OffcutPct',
    category: 'Finish Part',
    property: 'Offcut unmachined',
    unit: 'N/A',
    input: true,
    percent: true
  },
  {
    key: 'finish.VOffcut',
    category: 'Finish Part',
    property: 'V offcut unmachined',
    unit: 'mm3',
    formula: '=(Offcut unmachined)*(Vraw)'
  },
  {
    key: 'finish.VToMachine',
    category: 'Finish Part',
    property: 'V to machine',
    unit: 'mm3',
    formula: '=(Vraw)-(V offcut unmachined)-(Vfin)'
  },
  { type: 'header', category: 'Material Utilization' },
  {
    key: 'materialUtil.Utilized',
    category: 'Material Utilization',
    property: 'Material Utilized',
    unit: 'N/A',
    percent: true,
    formula: '=(V to machine)/(Vraw)'
  },
  {
    key: 'materialUtil.Waste',
    category: 'Material Utilization',
    property: 'Material Waste',
    unit: 'N/A',
    percent: true,
    formula: '=1-(Material Utilized)'
  },
  { type: 'header', category: 'Tooling Utilization' },
  {
    key: 'tooling.Large',
    category: 'Tooling Utilization',
    property: 'Large Facemill',
    unit: 'N/A',
    input: true,
    percent: true
  },
  {
    key: 'tooling.Medium',
    category: 'Tooling Utilization',
    property: 'Medium Endmill',
    unit: 'N/A',
    input: true,
    percent: true
  },
  {
    key: 'tooling.Small',
    category: 'Tooling Utilization',
    property: 'Small Endmill',
    unit: 'N/A',
    input: true,
    percent: true
  },
  {
    key: 'tooling.All',
    category: 'Tooling Utilization',
    property: 'All tooling',
    unit: 'N/A',
    percent: true,
    formula: '=(Large Facemill)+(Medium Endmill)+(Small Endmill)'
  },
  { type: 'header', category: 'Large Facemill' },
  { key: 'large.D', category: 'Large Facemill', property: 'Ø', unit: 'mm', input: true },
  { key: 'large.ap', category: 'Large Facemill', property: 'ap', unit: 'mm', input: true },
  {
    key: 'large.ae',
    category: 'Large Facemill',
    property: 'ae',
    unit: 'mm',
    formula: '=0.5*(Ø)'
  },
  { key: 'large.F', category: 'Large Facemill', property: 'F', unit: 'mmpm', input: true },
  {
    key: 'large.MRR',
    category: 'Large Facemill',
    property: 'MRR',
    unit: 'mm3/min',
    formula: '=(ap)*(ae)*(F)'
  },
  {
    key: 'large.V1',
    category: 'Large Facemill',
    property: 'V1 to machine',
    unit: 'mm3',
    formula: '=(Large Facemill %)*(V to machine)'
  },
  {
    key: 'large.CT',
    category: 'Large Facemill',
    property: 'CTlarge',
    unit: 'min',
    formula: '=(V1 to machine)/(MRR)'
  },
  { type: 'header', category: 'Medium Endmill' },
  { key: 'medium.D', category: 'Medium Endmill', property: 'Ø', unit: 'mm', input: true },
  { key: 'medium.ap', category: 'Medium Endmill', property: 'ap', unit: 'mm', input: true },
  { key: 'medium.ae', category: 'Medium Endmill', property: 'ae', unit: 'mm', input: true },
  { key: 'medium.F', category: 'Medium Endmill', property: 'F', unit: 'mmpm', input: true },
  {
    key: 'medium.MRR',
    category: 'Medium Endmill',
    property: 'MRR',
    unit: 'mm3/min',
    formula: '=(ap)*(ae)*(F)'
  },
  {
    key: 'medium.V2',
    category: 'Medium Endmill',
    property: 'V2 to machine',
    unit: 'mm3',
    formula: '=(Medium Endmill %)*(V to machine)'
  },
  {
    key: 'medium.CT',
    category: 'Medium Endmill',
    property: 'CTmedium',
    unit: 'min',
    formula: '=(V2 to machine)/(MRR)'
  },
  { type: 'header', category: 'Small Endmill' },
  { key: 'small.D', category: 'Small Endmill', property: 'Ø', unit: 'mm', input: true },
  { key: 'small.ap', category: 'Small Endmill', property: 'ap', unit: 'mm', input: true },
  { key: 'small.ae', category: 'Small Endmill', property: 'ae', unit: 'mm', input: true },
  { key: 'small.F', category: 'Small Endmill', property: 'F', unit: 'mmpm', input: true },
  {
    key: 'small.MRR',
    category: 'Small Endmill',
    property: 'MRR',
    unit: 'mm3/min',
    formula: '=(ap)*(ae)*(F)'
  },
  {
    key: 'small.V3',
    category: 'Small Endmill',
    property: 'V3 to machine',
    unit: 'mm3',
    formula: '=(Small Endmill %)*(V to machine)'
  },
  {
    key: 'small.CT',
    category: 'Small Endmill',
    property: 'CTsmall',
    unit: 'min',
    formula: '=(V3 to machine)/(MRR)'
  },
  { type: 'header', category: 'Ballnose Scanning / Contouring' },
  { key: 'ball.ap', category: 'Ballnose Scanning / Contouring', property: 'ap', unit: 'mm', input: true },
  { key: 'ball.ae', category: 'Ballnose Scanning / Contouring', property: 'ae', unit: 'mm', input: true },
  { key: 'ball.F', category: 'Ballnose Scanning / Contouring', property: 'F', unit: 'mmpm', input: true },
  {
    key: 'ball.MRR',
    category: 'Ballnose Scanning / Contouring',
    property: 'MRR',
    unit: 'mm3/min',
    formula: '=(ap)*(ae)*(F)'
  },
  {
    key: 'ball.Area',
    category: 'Ballnose Scanning / Contouring',
    property: 'Area to scan',
    unit: 'mm2',
    input: true
  },
  {
    key: 'ball.StockLeft',
    category: 'Ballnose Scanning / Contouring',
    property: 'Stock left',
    unit: 'mm',
    input: true
  },
  {
    key: 'ball.V3',
    category: 'Ballnose Scanning / Contouring',
    property: 'V3 to machine',
    unit: 'mm3',
    formula: '=(Area to scan)*(Stock left)'
  },
  {
    key: 'ball.CT',
    category: 'Ballnose Scanning / Contouring',
    property: 'CTscan',
    unit: 'min',
    formula: '=(V3 to machine)/(MRR)'
  },
  { type: 'header', category: 'Profile Surface Finish Control' },
  { key: 'profile.F', category: 'Profile Surface Finish Control', property: 'F', unit: 'mmpm', input: true },
  {
    key: 'profile.Length',
    category: 'Profile Surface Finish Control',
    property: 'Profile Length',
    unit: 'mm',
    input: true
  },
  {
    key: 'profile.CT',
    category: 'Profile Surface Finish Control',
    property: 'CTprofile',
    unit: 'min',
    formula: '=(Profile Length)/(F)'
  },
  { type: 'header', category: 'Drills' },
  { key: 'drill.ap', category: 'Drills', property: 'ap', unit: 'mm', input: true },
  { key: 'drill.F', category: 'Drills', property: 'F', unit: 'mmpm', input: true },
  { key: 'drill.Holes', category: 'Drills', property: 'No. of Holes', unit: 'N/A', input: true },
  {
    key: 'drill.CT',
    category: 'Drills',
    property: 'CThole',
    unit: 'min',
    formula: '=(ap)*(No. of Holes)/(F)'
  },
  { type: 'header', category: 'Machining Time' },
  {
    key: 'machining.TotalMin',
    category: 'Machining Time',
    property: 'Total Machining CT',
    unit: 'min',
    formula: '=(CTlarge)+(CTmedium)+(CTsmall)+(CTscan)+(CTprofile)+(CThole)'
  },
  {
    key: 'machining.TotalHr',
    category: 'Machining Time',
    property: 'Total Machining CT',
    unit: 'hr',
    formula: '=(Total Machining CT min)/60'
  },
  { type: 'header', category: 'Other Time Factor' },
  { key: 'other.LoadUnload', category: 'Other Time Factor', property: 'Load/Unload', unit: 'min', input: true },
  { key: 'other.Machine', category: 'Other Time Factor', property: 'Machine', unit: 'N/A', text: true },
  { key: 'other.Accel', category: 'Other Time Factor', property: 'Accel/Decel Factor', unit: 'N/A', input: true },
  {
    key: 'other.ToolChanges',
    category: 'Other Time Factor',
    property: 'No. of Tool Changes',
    unit: 'N/A',
    input: true
  },
  {
    key: 'other.ToolChangeSec',
    category: 'Other Time Factor',
    property: 'Tool Change Time',
    unit: 'sec',
    input: true
  },
  {
    key: 'other.TotalToolChangeMin',
    category: 'Other Time Factor',
    property: 'Total Tool Change Time',
    unit: 'min',
    formula: '=(Tool Change Time)/60*(No. of Tool Changes)'
  },
  {
    key: 'other.TotalOtherMin',
    category: 'Other Time Factor',
    property: 'Total Other Factor CT',
    unit: 'min',
    formula: '=(Load/Unload)+(Total Tool Change Time)'
  },
  { type: 'header', category: 'Total Overall' },
  {
    key: 'total.overallMin',
    category: 'Total Overall',
    property: 'Total Overall CT',
    unit: 'min',
    formula: '=(Total Machining CT min)*(Accel/Decel Factor)+(Total Other Factor CT)'
  },
  {
    key: 'total.overallHr',
    category: 'Total Overall',
    property: 'Total Overall CT',
    unit: 'hr',
    formula: '=(Total Overall CT min)/60'
  }
];

function formatCell(key, value, row) {
  if (row.text) return String(value ?? '');
  if (row.percent) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(1)}%`;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.01 && n !== 0)) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function parseInput(key, raw, row) {
  if (row.text) return raw;
  if (row.percent) {
    const s = String(raw).replace('%', '').trim();
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return n > 1 ? n / 100 : n;
  }
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

let state = { values: {}, projectId: null, partId: null, part: null, materialSpecs: [] };

function refreshSummary() {
  recalcValues(state.values);
  const partEl = document.getElementById('cycle-part-number');
  const quoteEl = document.getElementById('cycle-quote-hr');
  if (partEl && state.part) partEl.textContent = state.part.partNumber;
  if (quoteEl) {
    const hr = state.values['quote.hr'];
    quoteEl.textContent = Number.isFinite(hr) ? hr.toFixed(2) : '—';
  }
}

function renderTable() {
  const tbody = document.getElementById('cycle-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  recalcValues(state.values);

  ROWS.forEach((row) => {
    if (row.type === 'header') {
      const tr = document.createElement('tr');
      tr.className = 'category-header';
      tr.innerHTML = `<td colspan="5">${row.category}</td>`;
      tbody.appendChild(tr);
      return;
    }

    const tr = document.createElement('tr');
    const val = state.values[row.key];
    const display = formatCell(row.key, val, row);
    let dataCell;

    if (row.materialSelect) {
      const select = document.createElement('select');
      select.className = 'cell-input cell-select';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— Select material —';
      select.appendChild(placeholder);

      state.materialSpecs
        .filter((s) => s.status === 'Active')
        .forEach((spec) => {
          const opt = document.createElement('option');
          const label = materialLabel(spec);
          opt.value = label;
          opt.textContent = label;
          select.appendChild(opt);
        });

      select.value = String(val ?? '');
      select.addEventListener('change', () => {
        const spec = findSpecByMaterialValue(state.materialSpecs, select.value);
        applyMaterialSelection(spec);
        recalcValues(state.values);
        renderTable();
        persist().catch(console.error);
      });
      dataCell = select;
    } else if (row.input || row.text) {
      const input = document.createElement('input');
      input.className = 'cell-input';
      input.dataset.key = row.key;
      if (row.text) {
        input.value = String(val ?? '');
      } else if (row.percent) {
        input.value = `${(Number(val) * 100).toFixed(1)}`;
      } else {
        input.value = Number(val).toLocaleString(undefined, { maximumFractionDigits: 4 });
      }
      input.addEventListener('change', () => {
        state.values[row.key] = parseInput(row.key, input.value, row);
        recalcValues(state.values);
        renderTable();
        persist().catch(console.error);
      });
      dataCell = input;
    } else {
      const span = document.createElement('span');
      span.className = 'cell-readonly';
      span.textContent = display;
      dataCell = span;
    }

    tr.innerHTML = `
      <td class="col-category">${row.category}</td>
      <td class="col-property">${row.property}</td>
      <td class="col-data"></td>
      <td>${row.unit}</td>
      <td class="col-formula">${row.formula ?? ''}</td>
    `;
    tr.querySelector('.col-data').appendChild(dataCell);
    tbody.appendChild(tr);
  });

  refreshSummary();
}

async function persist() {
  if (!state.projectId || !state.partId) return;
  recalcValues(state.values);
  await savePartCycleData(state.projectId, state.partId, {
    values: { ...state.values },
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

  if (!projectId || !partId) {
    if (subtitle) subtitle.textContent = 'Select a part from Project RFQ.';
    if (wrap) wrap.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  let part;
  let saved;
  let materialSpecs;
  try {
    [part, saved, materialSpecs] = await Promise.all([
      getPart(projectId, partId),
      getPart(projectId, partId).then((p) =>
        p ? getPartCycleData(projectId, partId) : null
      ),
      getMaterialSpecs()
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
  state.materialSpecs = materialSpecs ?? [];
  state.values = { ...defaultValues(part, state.materialSpecs), ...(saved?.values ?? {}) };
  syncDensityFromMaterial();
  recalcValues(state.values);

  if (subtitle) {
    subtitle.textContent = `Project ID ${projectId} · ${part.partDescription}`;
  }
  if (wrap) wrap.hidden = false;
  if (empty) empty.hidden = true;

  const back = document.getElementById('back-to-rfq');
  if (back) back.href = `/ProjectRfq?projectId=${encodeURIComponent(projectId)}`;

  const saveBtn = document.getElementById('btn-save-cycle');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      persist()
        .then(() => {
          saveBtn.textContent = 'Saved';
          setTimeout(() => {
            saveBtn.textContent = 'Save';
          }, 1500);
        })
        .catch((err) => {
          console.error(err);
          saveBtn.textContent = 'Error';
        });
    });
  }

  renderTable();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});
