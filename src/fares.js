export const TRANSIT_FARES = {
  metro: {
    slabs: [[2, 5], [5, 10], [10, 15], [20, 20], [Infinity, 25]],
    lines: {
      'Green Line': [[2, 5], [5, 10], [10, 20], [Infinity, 30]],
    },
  },
  train: {
    slabs: [[5, 5], [10, 10], [15, 15], [20, 20], [25, 25], [30, 30], [35, 35], [40, 40], [45, 45], [50, 50], [Infinity, 60]],
  },
  bus: {
    slabs: [[5, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, 35], [Infinity, 40]],
  },
  tram: {
    slabs: [[2, 6], [5, 8], [Infinity, 10]],
  },
  express: { fixed: 120 },
  launch: { fixed: 6 },
};

export const ROAD_FARES = {
  taxi: { base: 30, incl: 2, perKm: 15, speed: 14, label: 'taxi' },
  auto: { base: 20, incl: 1.5, perKm: 10, speed: 11, label: 'auto' },
  rickshaw: { base: 30, incl: 0.5, perKm: 25, speed: 2.6, label: 'rickshaw', max: 2500 },
};

export function transitFare(type, metres, line = '') {
  const table = TRANSIT_FARES[type];
  if (!table) throw new Error(`Unknown transit fare type: ${type}`);
  if (table.fixed != null) return table.fixed;
  const km = Math.max(0, metres) / 1000;
  const slabs = table.lines && table.lines[line] ? table.lines[line] : table.slabs;
  return slabs.find(([limit]) => km <= limit)[1];
}

export function roadFare(type, metres) {
  const fare = ROAD_FARES[type];
  if (!fare) throw new Error(`Unknown road fare type: ${type}`);
  return Math.round(fare.base + Math.max(0, metres / 1000 - fare.incl) * fare.perKm);
}
