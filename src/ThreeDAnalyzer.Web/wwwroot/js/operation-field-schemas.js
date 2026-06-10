/** Operation types, table columns, and per-type active column rules. */

export const OPERATION_TYPES = [
  'Face Milling',
  'Roughing',
  'Pocketing',
  'Profiling',
  'Slotting',
  'Drilling',
  'Reaming',
  'Tapping',
  'Ballnose Finishing',
  'Engraving',
  'Manual Operation'
];

/** Fixed table data columns (after No., Name, Type). */
export const TABLE_DATA_COLUMNS = [
  { key: 'diameter', label: 'Ø', param: 'diameter' },
  { key: 'ap', label: 'ap', param: 'ap' },
  { key: 'ae', label: 'ae', param: 'ae' },
  { key: 'feed', label: 'F', param: 'feed' },
  { key: 'mrr', label: 'MRR', computed: true },
  { key: 'volume', label: 'V', param: 'volume' },
  { key: 'area', label: 'Area to scan', param: 'area' },
  { key: 'length', label: 'Profile Length', param: 'length' },
  { key: 'holeCount', label: 'No. of Holes', param: 'holeCount' },
  { key: 'ct', label: 'CT', computed: true }
];

/** Which columns are active (editable or computed) per operation type. */
export const ACTIVE_COLUMNS_BY_TYPE = {
  'Face Milling': ['diameter', 'ap', 'ae', 'feed', 'mrr', 'volume', 'ct'],
  Roughing: ['diameter', 'ap', 'ae', 'feed', 'mrr', 'volume', 'ct'],
  Pocketing: ['diameter', 'ap', 'ae', 'feed', 'mrr', 'volume', 'ct'],
  Slotting: ['diameter', 'ap', 'ae', 'feed', 'mrr', 'volume', 'ct'],
  'Ballnose Finishing': ['diameter', 'ap', 'ae', 'feed', 'mrr', 'area', 'ct'],
  Profiling: ['diameter', 'feed', 'length', 'ct'],
  Engraving: ['feed', 'length', 'ct'],
  Drilling: ['ap', 'feed', 'holeCount', 'ct'],
  Reaming: ['ap', 'feed', 'holeCount', 'ct'],
  Tapping: ['ap', 'feed', 'holeCount', 'ct'],
  'Manual Operation': ['ct']
};

const ALL_PARAM_KEYS = [
  'diameter',
  'ap',
  'ae',
  'feed',
  'volume',
  'area',
  'length',
  'holeCount',
  'stockLeft',
  'minutes'
];

/** @deprecated Use TABLE_DATA_COLUMNS — kept for settings template forms. */
export const FIELD_SCHEMAS = {
  'Face Milling': [
    { key: 'diameter', label: 'Ø', unit: 'mm' },
    { key: 'ap', label: 'ap', unit: 'mm' },
    { key: 'ae', label: 'ae', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'volume', label: 'V', unit: 'mm³' }
  ],
  Roughing: [
    { key: 'diameter', label: 'Ø', unit: 'mm' },
    { key: 'ap', label: 'ap', unit: 'mm' },
    { key: 'ae', label: 'ae', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'volume', label: 'V', unit: 'mm³' }
  ],
  Pocketing: [
    { key: 'diameter', label: 'Ø', unit: 'mm' },
    { key: 'ap', label: 'ap', unit: 'mm' },
    { key: 'ae', label: 'ae', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'volume', label: 'V', unit: 'mm³' }
  ],
  Profiling: [
    { key: 'diameter', label: 'Ø', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'length', label: 'Profile Length', unit: 'mm' }
  ],
  Slotting: [
    { key: 'diameter', label: 'Ø', unit: 'mm' },
    { key: 'ap', label: 'ap', unit: 'mm' },
    { key: 'ae', label: 'ae', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'volume', label: 'V', unit: 'mm³' }
  ],
  Drilling: [
    { key: 'ap', label: 'ap (depth)', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'holeCount', label: 'No. of Holes', unit: '' }
  ],
  Reaming: [
    { key: 'ap', label: 'ap (depth)', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'holeCount', label: 'No. of Holes', unit: '' }
  ],
  Tapping: [
    { key: 'ap', label: 'ap (depth)', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'holeCount', label: 'No. of Holes', unit: '' }
  ],
  'Ballnose Finishing': [
    { key: 'diameter', label: 'Ø', unit: 'mm' },
    { key: 'ap', label: 'ap', unit: 'mm' },
    { key: 'ae', label: 'ae', unit: 'mm' },
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'area', label: 'Area to scan', unit: 'mm²' }
  ],
  Engraving: [
    { key: 'feed', label: 'F', unit: 'mmpm' },
    { key: 'length', label: 'Profile Length', unit: 'mm' }
  ],
  'Manual Operation': [{ key: 'minutes', label: 'Minutes', unit: 'min' }]
};

export function getActiveColumns(type) {
  return new Set(ACTIVE_COLUMNS_BY_TYPE[type] ?? ['ct']);
}

export function isColumnActive(type, columnKey) {
  return getActiveColumns(type).has(columnKey);
}

function migrateLegacyParams(source) {
  if (!source || typeof source !== 'object') return {};
  const p = { ...source };
  if (p.stepover !== undefined && p.ae === undefined) {
    p.ae = p.stepover;
    delete p.stepover;
  }
  if (p.depth !== undefined && p.ap === undefined) {
    p.ap = p.depth;
    delete p.depth;
  }
  if (p.area !== undefined && p.volume === undefined && p.ap) {
    // legacy face mill area-only rows
  }
  return p;
}

export function defaultParamsForType(type) {
  /** @type {Record<string, number>} */
  const params = {};
  ALL_PARAM_KEYS.forEach((k) => {
    params[k] = 0;
  });
  if (type === 'Ballnose Finishing') params.stockLeft = 0.5;
  return params;
}

export function mergeParams(type, source) {
  const base = defaultParamsForType(type);
  const migrated = migrateLegacyParams(source);
  ALL_PARAM_KEYS.forEach((k) => {
    const v = migrated[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      base[k] = Number.isFinite(n) ? n : 0;
    }
  });
  return base;
}
