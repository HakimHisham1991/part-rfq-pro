/** Cycle-time formulas per operation type (minutes). */

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function mrrVolume(ap, ae, feed) {
  return n(ap) * n(ae) * n(feed);
}

function effectiveAe(type, p) {
  const ae = n(p.ae);
  if (ae > 0) return ae;
  if (type === 'Face Milling' && n(p.diameter) > 0) return 0.5 * n(p.diameter);
  return ae;
}

/** Material removal rate (mm³/min) when applicable. */
export function calcMrr(type, params) {
  const p = params ?? {};
  switch (type) {
    case 'Face Milling':
    case 'Roughing':
    case 'Pocketing':
    case 'Slotting':
    case 'Ballnose Finishing':
      return mrrVolume(p.ap, effectiveAe(type, p), p.feed);
    default:
      return 0;
  }
}

/** @type {Record<string, (params: Record<string, number>) => number>} */
export const FORMULAS = {
  'Face Milling': (p) => {
    const mrr = calcMrr('Face Milling', p);
    const volume = n(p.volume) || n(p.area) * n(p.ap);
    return mrr > 0 ? volume / mrr : 0;
  },
  Roughing: (p) => {
    const mrr = calcMrr('Roughing', p);
    return mrr > 0 ? n(p.volume) / mrr : 0;
  },
  Pocketing: (p) => {
    const mrr = calcMrr('Pocketing', p);
    return mrr > 0 ? n(p.volume) / mrr : 0;
  },
  Profiling: (p) => (n(p.feed) > 0 ? n(p.length) / n(p.feed) : 0),
  Slotting: (p) => {
    const mrr = calcMrr('Slotting', p);
    return mrr > 0 ? n(p.volume) / mrr : 0;
  },
  Drilling: (p) =>
    n(p.feed) > 0 ? (n(p.ap) * n(p.holeCount)) / n(p.feed) : 0,
  Reaming: (p) =>
    n(p.feed) > 0 ? (n(p.ap) * n(p.holeCount)) / n(p.feed) : 0,
  Tapping: (p) =>
    n(p.feed) > 0 ? (n(p.ap) * n(p.holeCount)) / n(p.feed) : 0,
  'Ballnose Finishing': (p) => {
    const mrr = calcMrr('Ballnose Finishing', p);
    const stockLeft = n(p.stockLeft) || 0.5;
    const volume = n(p.area) * stockLeft;
    return mrr > 0 ? volume / mrr : 0;
  },
  Engraving: (p) => (n(p.feed) > 0 ? n(p.length) / n(p.feed) : 0),
  'Manual Operation': (p) => n(p.minutes)
};

export function calcOperationCt(operation) {
  if (operation.type === 'Manual Operation' && n(operation.params?.minutes) > 0) {
    return n(operation.params.minutes);
  }
  const fn = FORMULAS[operation.type];
  if (!fn) return 0;
  return fn(operation.params ?? {});
}

export function roundUpTo(value, step) {
  if (!Number.isFinite(value) || step <= 0) return 0;
  if (value <= 0) return 0;
  return Math.ceil(value / step - 1e-9) * step;
}

/** @deprecated Use roundUpTo */
export function ceilingTo(value, step) {
  return roundUpTo(value, step);
}

export const QUOTE_HR_STEP = 0.1;

/**
 * @param {Array<{ ctMin?: number }>} operations
 * @param {{ enabled?: boolean, loadUnload?: number, accel?: number, toolChanges?: number, toolChangeSec?: number }} other
 */
export function calcTotals(operations, other) {
  const enabled = other?.enabled !== false;
  const machiningMin = (operations ?? []).reduce((s, o) => s + n(o.ctMin), 0);
  const toolChangeMin = enabled
    ? (n(other?.toolChangeSec) / 60) * n(other?.toolChanges)
    : 0;
  const otherMin = enabled ? n(other?.loadUnload) + toolChangeMin : 0;
  const accel = enabled ? n(other?.accel) || 1 : 1;
  const overallMin = machiningMin * accel + otherMin;
  const overallHr = overallMin / 60;
  return {
    machiningMin,
    toolChangeMin,
    otherMin,
    overallMin,
    overallHr,
    quoteHr: roundUpTo(overallHr, QUOTE_HR_STEP)
  };
}

export function recalcOperations(operations) {
  return (operations ?? []).map((op) => ({
    ...op,
    ctMin: calcOperationCt(op)
  }));
}
