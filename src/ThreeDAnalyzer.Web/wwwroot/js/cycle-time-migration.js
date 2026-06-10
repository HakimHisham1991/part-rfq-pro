import { mergeParams } from './operation-field-schemas.js';
import { calcOperationCt } from './operation-formulas.js';

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
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
      loadUnload: n(v['other.LoadUnload']),
      machine: String(v['other.Machine'] ?? 'Hartford Aero-426'),
      accel: n(v['other.Accel']) || 1.3,
      toolChanges: n(v['other.ToolChanges']),
      toolChangeSec: n(v['other.ToolChangeSec'])
    },
    rawMaterial: {
      length: n(v['raw.Lraw']) || part?.materialLength || 2032,
      width: n(v['raw.Wraw']) || part?.materialWidth || 266.7,
      thickness: n(v['raw.Traw']) || part?.materialThickness || 50.8,
      material: String(v['raw.Material'] ?? ''),
      density: n(v['raw.Density'])
    }
  };
}

export function defaultV2(part) {
  return {
    version: 2,
    operations: [],
    other: {
      loadUnload: 15,
      machine: 'Hartford Aero-426',
      accel: 1.3,
      toolChanges: 0,
      toolChangeSec: 15
    },
    rawMaterial: {
      length: part?.materialLength ?? 2032,
      width: part?.materialWidth ?? 266.7,
      thickness: part?.materialThickness ?? 50.8,
      material: '',
      density: 0
    }
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
        loadUnload: n(saved.other?.loadUnload ?? 15),
        machine: String(saved.other?.machine ?? 'Hartford Aero-426'),
        accel: n(saved.other?.accel) || 1.3,
        toolChanges: n(saved.other?.toolChanges),
        toolChangeSec: n(saved.other?.toolChangeSec ?? 15)
      },
      rawMaterial: saved.rawMaterial ?? defaultV2(part).rawMaterial
    };
  }

  if (saved?.values) return migrateV1ToV2(saved.values, part);
  return defaultV2(part);
}

export { newOpId };
