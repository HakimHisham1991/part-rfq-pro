import { mergeParams } from './operation-field-schemas.js';
import { calcOperationCt } from './operation-formulas.js';

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Match part material spec to a master material specification row. */
export function lookupMaterialSpec(specs, partSpec) {
  if (!partSpec || !specs?.length) return null;
  const norm = String(partSpec).trim().toLowerCase();
  return (
    specs.find((s) => {
      const spec = String(s.specification ?? '').trim().toLowerCase();
      const name = String(s.generalName ?? '').trim().toLowerCase();
      return spec === norm || name === norm || norm.includes(spec) || spec.includes(norm);
    }) ?? null
  );
}

export function findMaterialSpecById(specs, id) {
  if (id == null || !specs?.length) return null;
  return specs.find((s) => s.id === id) ?? null;
}

export function findMachineProfileById(profiles, id) {
  if (id == null || !profiles?.length) return null;
  return profiles.find((m) => m.id === id) ?? null;
}

export function lookupMachineProfile(profiles, machineName) {
  if (!machineName || !profiles?.length) return null;
  const norm = String(machineName).trim().toLowerCase();
  return (
    profiles.find((m) => String(m.name ?? m.Name ?? '').trim().toLowerCase() === norm) ?? null
  );
}

export const GENERIC_MACHINE_NAME = 'Generic Machine';

export function sortMachineProfiles(profiles) {
  return [...(profiles ?? [])].sort((a, b) => {
    const nameA = String(a.name ?? a.Name ?? '');
    const nameB = String(b.name ?? b.Name ?? '');
    const rankA = nameA === GENERIC_MACHINE_NAME ? 0 : 1;
    const rankB = nameB === GENERIC_MACHINE_NAME ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return nameA.localeCompare(nameB);
  });
}

export function applyMachineProfileToOther(other, profile) {
  if (!other || !profile) return other;
  const profileId = profile.id ?? profile.Id;
  other.machineProfileId = profileId;
  other.machine = String(profile.name ?? profile.Name ?? '');
  other.axisTypes = String(profile.axisTypes ?? profile.AxisTypes ?? '');
  other.rapidRate = n(profile.rapidRateMmpm ?? profile.RapidRateMmpm);
  other.spindlePower = n(profile.spindlePowerKw ?? profile.SpindlePowerKw);
  other.accel = n(profile.accelDecelFactor ?? profile.AccelDecelFactor) || 1;
  other.toolChangeSec = n(profile.toolChangeTimeSec ?? profile.ToolChangeTimeSec);
  return other;
}

function defaultOther() {
  return {
    enabled: true,
    loadUnload: 15,
    machineProfileId: null,
    machine: GENERIC_MACHINE_NAME,
    axisTypes: '5X',
    rapidRate: 60000,
    spindlePower: 30,
    accel: 1.2,
    toolChanges: 0,
    toolChangeSec: 10
  };
}

export function materialDisplayLabel(part, specRow) {
  const partSpec = String(part?.materialSpec ?? '').trim();
  if (specRow) {
    const generalName = String(specRow.generalName ?? '').trim();
    const specification = String(specRow.specification ?? '').trim();
    if (generalName && specification) return `${generalName} (${specification})`;
    return generalName || specification || partSpec || '—';
  }
  return partSpec || '—';
}

function defaultStockOffsets() {
  return { px: 0, nx: 0, py: 0, ny: 0, pz: 0, nz: 0 };
}

export function buildRawMaterialFromPart(part, specRow, savedRaw = null) {
  const length = savedRaw?.length != null ? n(savedRaw.length) : n(part?.materialLength);
  const width = savedRaw?.width != null ? n(savedRaw.width) : n(part?.materialWidth);
  const thickness =
    savedRaw?.thickness != null ? n(savedRaw.thickness) : n(part?.materialThickness);
  const vraw =
    savedRaw?.vraw != null && savedRaw.vraw > 0 ? n(savedRaw.vraw) : length * width * thickness;
  const density = n(specRow?.density);
  const weight = density > 0 ? (vraw * density) / 1e9 : 0;
  return {
    length,
    width,
    thickness,
    vraw,
    materialSpecId: specRow?.id ?? null,
    material: materialDisplayLabel(part, specRow),
    density,
    weight
  };
}

export function calcFinishPartValues(raw, finishPart) {
  const vraw = n(raw?.vraw);
  const vfin = n(finishPart?.vfin);
  const offcutPct = n(finishPart?.offcutPct);
  const vOffcutUnmachined = offcutPct * vraw;
  const vToMachine = vraw - vOffcutUnmachined - vfin;
  return { vfin, offcutPct, vOffcutUnmachined, vToMachine };
}

function defaultFinishPart() {
  return { vfin: 0, offcutPct: 0.3 };
}

function defaultModel3d() {
  return {
    fileName: '',
    stockOffsets: defaultStockOffsets(),
    analysis: null
  };
}

export function normalizeModel3d(saved) {
  if (!saved || typeof saved !== 'object') return defaultModel3d();
  const offsets = saved.stockOffsets ?? {};
  return {
    fileName: String(saved.fileName ?? ''),
    stockOffsets: {
      px: n(offsets.px),
      nx: n(offsets.nx),
      py: n(offsets.py),
      ny: n(offsets.ny),
      pz: n(offsets.pz),
      nz: n(offsets.nz)
    },
    analysis: saved.analysis ?? null
  };
}

function newOpId() {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeOp(order, name, type, params, templateId = null) {
  const operation = {
    id: newOpId(),
    order,
    name,
    type,
    templateId,
    params: mergeParams(type, params)
  };
  operation.ctMin = calcOperationCt(operation);
  return operation;
}

/** Migrate legacy flat values (v1) to operation-based model (v2). */
export function migrateV1ToV2(values, part) {
  const v = values ?? {};
  const vraw = n(v['raw.Lraw']) * n(v['raw.Wraw']) * n(v['raw.Traw']);
  const vToMachine =
    vraw - n(v['finish.OffcutPct']) * vraw - n(v['finish.Vfin']);

  /** @type {Array<object>} */
  const operations = [];
  let order = 1;

  if (n(v['tooling.Large']) > 0) {
    operations.push(
      makeOp(order++, 'Face Milling', 'Face Milling', {
        diameter: v['large.D'],
        ap: v['large.ap'],
        ae: v['large.ae'],
        feed: v['large.F'],
        volume: n(v['tooling.Large']) * vToMachine
      })
    );
  }

  if (n(v['tooling.Medium']) > 0) {
    operations.push(
      makeOp(order++, 'Adaptive Roughing', 'Roughing', {
        diameter: v['medium.D'],
        ap: v['medium.ap'],
        ae: v['medium.ae'],
        feed: v['medium.F'],
        volume: n(v['tooling.Medium']) * vToMachine
      })
    );
  }

  if (n(v['tooling.Small']) > 0) {
    operations.push(
      makeOp(order++, 'Corner Cleanup', 'Profiling', {
        diameter: v['small.D'],
        feed: v['small.F'],
        length:
          n(v['small.MRR']) > 0
            ? (n(v['tooling.Small']) * vToMachine) / n(v['small.MRR']) * n(v['small.F'])
            : 5000
      })
    );
  }

  if (n(v['ball.CT']) > 0 || n(v['ball.Area']) > 0) {
    operations.push(
      makeOp(order++, 'Ballnose Surface', 'Ballnose Finishing', {
        ap: v['ball.ap'],
        ae: v['ball.ae'],
        feed: v['ball.F'],
        area: v['ball.Area'],
        stockLeft: v['ball.StockLeft']
      })
    );
  }

  if (n(v['profile.Length']) > 0) {
    operations.push(
      makeOp(order++, 'Finish Profile', 'Profiling', {
        feed: v['profile.F'],
        length: v['profile.Length']
      })
    );
  }

  if (n(v['drill.Holes']) > 0) {
    operations.push(
      makeOp(order++, 'Drill', 'Drilling', {
        ap: v['drill.ap'],
        feed: v['drill.F'],
        holeCount: v['drill.Holes']
      })
    );
  }

  return {
    version: 2,
    operations,
    other: {
      enabled: true,
      loadUnload: n(v['other.LoadUnload']),
      machineProfileId: null,
      machine: String(v['other.Machine'] ?? 'Hartford Aero-426'),
      axisTypes: '',
      rapidRate: 0,
      spindlePower: 0,
      accel: n(v['other.Accel']) || 1.3,
      toolChanges: n(v['other.ToolChanges']),
      toolChangeSec: n(v['other.ToolChangeSec'])
    },
    rawMaterial: {
      length: n(v['raw.Lraw']) || part?.materialLength || 2032,
      width: n(v['raw.Wraw']) || part?.materialWidth || 266.7,
      thickness: n(v['raw.Traw']) || part?.materialThickness || 50.8,
      vraw:
        n(v['raw.Lraw']) * n(v['raw.Wraw']) * n(v['raw.Traw']) ||
        (part?.materialLength ?? 2032) * (part?.materialWidth ?? 266.7) * (part?.materialThickness ?? 50.8),
      materialSpecId: null,
      material: String(v['raw.Material'] ?? ''),
      density: n(v['raw.Density'])
    },
    model3d: defaultModel3d(),
    finishPart: {
      vfin: n(v['finish.Vfin']),
      offcutPct: n(v['finish.OffcutPct']) || 0.3
    }
  };
}

export function defaultV2(part) {
  return {
    version: 2,
    operations: [],
    other: defaultOther(),
    rawMaterial: {
      length: part?.materialLength ?? 2032,
      width: part?.materialWidth ?? 266.7,
      thickness: part?.materialThickness ?? 50.8,
      vraw:
        (part?.materialLength ?? 2032) *
        (part?.materialWidth ?? 266.7) *
        (part?.materialThickness ?? 50.8),
      materialSpecId: null,
      material: '',
      density: 0
    },
    finishPart: defaultFinishPart(),
    model3d: defaultModel3d()
  };
}

export function normalizeCycleData(saved, part) {
  if (saved?.version === 2) {
    return {
      version: 2,
      operations: (saved.operations ?? []).map((op, i) => ({
        ...op,
        order: op.order ?? i + 1,
        params: mergeParams(op.type, op.params),
        ctMin: calcOperationCt({ type: op.type, params: mergeParams(op.type, op.params) })
      })),
      other: {
        ...defaultOther(),
        enabled: saved.other?.enabled !== false,
        loadUnload: n(saved.other?.loadUnload ?? 15),
        machineProfileId: saved.other?.machineProfileId ?? null,
        machine: String(saved.other?.machine ?? 'Hartford Aero-426'),
        axisTypes: String(saved.other?.axisTypes ?? ''),
        rapidRate: n(saved.other?.rapidRate),
        spindlePower: n(saved.other?.spindlePower),
        accel: n(saved.other?.accel) || 1.3,
        toolChanges: n(saved.other?.toolChanges),
        toolChangeSec: n(saved.other?.toolChangeSec ?? 15)
      },
      rawMaterial: {
        ...(saved.rawMaterial ?? defaultV2(part).rawMaterial),
        materialSpecId: saved.rawMaterial?.materialSpecId ?? null,
        vraw: n(saved.rawMaterial?.vraw)
      },
      finishPart: {
        vfin: n(saved.finishPart?.vfin),
        offcutPct:
          saved.finishPart?.offcutPct != null ? n(saved.finishPart.offcutPct) : 0.3
      },
      model3d: normalizeModel3d(saved.model3d)
    };
  }

  if (saved?.values) return migrateV1ToV2(saved.values, part);
  return defaultV2(part);
}

export { newOpId };
