export type IslandDisplayKind =
  | 'agent'
  | 'wechat'
  | 'notification'
  | 'system-toast'
  | 'hardware'
  | 'music'
  | 'network'
  | 'update';

export type IslandInterruptLevel = 'none' | 'soft' | 'strong';

export type IslandModuleVisualStatus =
  | 'normal'
  | 'info'
  | 'running'
  | 'success'
  | 'warning'
  | 'error'
  | 'unread'
  | 'paused';

export type IslandLayoutReason =
  | 'strong-interrupt'
  | 'manual-focus'
  | 'soft-interrupt'
  | 'rotation'
  | 'stable'
  | 'priority'
  | 'fallback';

export interface IslandModuleSnapshot {
  kind: IslandDisplayKind;
  active: boolean;
  interrupt?: IslandInterruptLevel;
  interruptUntil?: number;
  status?: IslandModuleVisualStatus;
  unreadCount?: number;
  label?: string;
  iconUrl?: string;
}

export interface IslandSatelliteItem {
  kind: IslandDisplayKind;
  status: IslandModuleVisualStatus;
  unreadCount: number;
  label: string;
  iconUrl?: string;
}

export interface IslandLayoutSize {
  width: number;
  height: number;
}

export interface IslandLayoutInput {
  modules: IslandModuleSnapshot[];
  now: number;
  manualFocusKind?: IslandDisplayKind | null;
  manualFocusUntil?: number;
  stableMainKind?: IslandDisplayKind | null;
  expandedKind?: IslandDisplayKind | null;
  rotationEnabled?: boolean;
  rotationIndex?: number;
  rotationKinds?: IslandDisplayKind[];
  maxSatellites?: number;
}

export interface IslandLayoutState {
  main: IslandDisplayKind;
  satellites: IslandSatelliteItem[];
  overflowCount: number;
  expandedKind: IslandDisplayKind | null;
  reason: IslandLayoutReason;
  size: IslandLayoutSize;
}

export interface IslandDisplayInput {
  agentActive?: boolean;
  wechatActive?: boolean;
  notificationActive?: boolean;
  systemToastActive?: boolean;
  rotationEnabled: boolean;
  rotationIndex: number;
  musicEnabled: boolean;
  hardwareEnabled: boolean;
}

const FALLBACK_KIND: IslandDisplayKind = 'network';
const DEFAULT_MAX_SATELLITES = 3;
const ROTATION_DISPLAYS: IslandDisplayKind[] = ['network', 'music', 'hardware'];
const SATELLITE_ORDER: IslandDisplayKind[] = [
  'wechat',
  'agent',
  'notification',
  'hardware',
  'music',
  'update',
];

const BASE_SIZE: IslandLayoutSize = { width: 260, height: 42 };
const DETAIL_PANEL_GAP = 8;

const DETAIL_SIZES: Partial<Record<IslandDisplayKind, { width: number; detailHeight: number }>> = {
  music: { width: 420, detailHeight: 132 },
  notification: { width: 380, detailHeight: 112 },
  hardware: { width: 316, detailHeight: 92 },
  network: { width: 316, detailHeight: 92 },
  agent: { width: 340, detailHeight: 92 },
  wechat: { width: 340, detailHeight: 92 },
  update: { width: 340, detailHeight: 92 },
};

const DEFAULT_DETAIL_SIZE = { width: BASE_SIZE.width, detailHeight: 86 };

const DEFAULT_LABELS: Record<IslandDisplayKind, string> = {
  agent: 'Agent',
  wechat: '微信',
  notification: '通知',
  'system-toast': '系统提示',
  hardware: '硬件',
  music: '音乐',
  network: '网速',
  update: '更新',
};

const normalizeModules = (modules: IslandModuleSnapshot[]): IslandModuleSnapshot[] => {
  if (modules.some((item) => item.kind === FALLBACK_KIND)) return modules;
  return [...modules, { kind: FALLBACK_KIND, active: true }];
};

const toModuleMap = (modules: IslandModuleSnapshot[]) => {
  const map = new Map<IslandDisplayKind, IslandModuleSnapshot>();
  for (const module of normalizeModules(modules)) {
    map.set(module.kind, module);
  }
  return map;
};

const getActiveModule = (
  modules: Map<IslandDisplayKind, IslandModuleSnapshot>,
  kind: IslandDisplayKind | null | undefined
) => {
  if (!kind) return null;
  const module = modules.get(kind);
  return module?.active ? module : null;
};

const isInterruptActive = (
  module: IslandModuleSnapshot,
  level: Exclude<IslandInterruptLevel, 'none'>,
  now: number
) => {
  if (!module.active || module.interrupt !== level) return false;
  return module.interruptUntil === undefined || module.interruptUntil > now;
};

const getPriorityScore = (module: IslandModuleSnapshot): number => {
  if (module.kind === 'agent' && ['error', 'warning'].includes(module.status ?? 'normal')) return 1;
  if (module.kind === 'hardware' && module.status === 'error') return 2;
  if (module.kind === 'wechat') return 3;
  if (module.kind === 'notification') return 4;
  if (module.kind === 'system-toast') return 5;
  if (module.kind === 'agent') return 6;
  if (module.kind === 'update') return 7;
  if (module.kind === 'music') return 8;
  if (module.kind === 'hardware') return 9;
  return 10;
};

const sortByPriority = (modules: IslandModuleSnapshot[]) =>
  [...modules].sort((a, b) => getPriorityScore(a) - getPriorityScore(b));

const pickInterruptMain = (
  modules: IslandModuleSnapshot[],
  level: Exclude<IslandInterruptLevel, 'none'>,
  now: number
) => sortByPriority(modules.filter((module) => isInterruptActive(module, level, now)))[0] ?? null;

const pickRotationMain = (
  modules: Map<IslandDisplayKind, IslandModuleSnapshot>,
  input: IslandLayoutInput
) => {
  const rotationKinds = input.rotationKinds?.length ? input.rotationKinds : ROTATION_DISPLAYS;
  const safeIndex = Math.abs(input.rotationIndex ?? 0) % rotationKinds.length;

  for (let offset = 0; offset < rotationKinds.length; offset += 1) {
    const kind = rotationKinds[(safeIndex + offset) % rotationKinds.length];
    const module = getActiveModule(modules, kind);
    if (module) return module;
  }

  return null;
};

const pickPriorityMain = (modules: IslandModuleSnapshot[]) =>
  sortByPriority(modules.filter((module) => module.active))[0] ?? null;

const toSatelliteItem = (module: IslandModuleSnapshot): IslandSatelliteItem => ({
  kind: module.kind,
  status: module.status ?? 'normal',
  unreadCount: module.unreadCount ?? 0,
  label: module.label ?? DEFAULT_LABELS[module.kind],
  iconUrl: module.iconUrl,
});

const resolveSatellites = (
  modules: IslandModuleSnapshot[],
  main: IslandDisplayKind,
  maxSatellites: number
) => {
  const candidates = modules
    .filter((module) => module.active)
    .filter((module) => module.kind !== main)
    .filter((module) => module.kind !== 'network' && module.kind !== 'system-toast')
    .sort((a, b) => SATELLITE_ORDER.indexOf(a.kind) - SATELLITE_ORDER.indexOf(b.kind));

  const visible = candidates.slice(0, maxSatellites).map(toSatelliteItem);
  const overflowCount = Math.max(0, candidates.length - visible.length);

  return { satellites: visible, overflowCount };
};

const getSatelliteWidth = (satelliteCount: number, overflowCount: number) => {
  const visibleCount = satelliteCount + (overflowCount > 0 ? 1 : 0);
  if (visibleCount === 0) return 0;
  return 22 + visibleCount * 26 + Math.max(0, visibleCount - 1) * 6 + 8;
};

const resolveSize = (
  expandedKind: IslandDisplayKind | null,
  satellites: IslandSatelliteItem[],
  overflowCount: number
): IslandLayoutSize => {
  const compactWidth = BASE_SIZE.width + getSatelliteWidth(satellites.length, overflowCount);

  if (!expandedKind) {
    return {
      width: compactWidth,
      height: BASE_SIZE.height,
    };
  }

  const detailSize = DETAIL_SIZES[expandedKind] ?? DEFAULT_DETAIL_SIZE;

  return {
    width: Math.max(compactWidth, detailSize.width),
    height: BASE_SIZE.height + DETAIL_PANEL_GAP + detailSize.detailHeight,
  };
};

export function resolveIslandLayout(input: IslandLayoutInput): IslandLayoutState {
  const moduleMap = toModuleMap(input.modules);
  const activeModules = [...moduleMap.values()].filter((module) => module.active);
  const strongMain = pickInterruptMain(activeModules, 'strong', input.now);

  let mainModule: IslandModuleSnapshot | null = null;
  let reason: IslandLayoutReason = 'fallback';

  if (strongMain) {
    mainModule = strongMain;
    reason = 'strong-interrupt';
  } else {
    const manualMain = getActiveModule(moduleMap, input.manualFocusKind);
    if (manualMain && (input.manualFocusUntil ?? 0) > input.now) {
      mainModule = manualMain;
      reason = 'manual-focus';
    }
  }

  if (!mainModule) {
    const softMain = pickInterruptMain(activeModules, 'soft', input.now);
    if (softMain) {
      mainModule = softMain;
      reason = 'soft-interrupt';
    }
  }

  if (!mainModule && input.rotationEnabled) {
    const rotationMain = pickRotationMain(moduleMap, input);
    if (rotationMain) {
      mainModule = rotationMain;
      reason = 'rotation';
    }
  }

  if (!mainModule) {
    const stableMain = getActiveModule(moduleMap, input.stableMainKind);
    if (stableMain) {
      mainModule = stableMain;
      reason = 'stable';
    }
  }

  if (!mainModule) {
    const priorityMain = pickPriorityMain(activeModules);
    if (priorityMain) {
      mainModule = priorityMain;
      reason = priorityMain.kind === FALLBACK_KIND ? 'fallback' : 'priority';
    }
  }

  const main = mainModule?.kind ?? FALLBACK_KIND;
  const safeExpandedKind =
    input.expandedKind === main && input.expandedKind !== 'system-toast' ? input.expandedKind : null;
  const { satellites, overflowCount } = resolveSatellites(
    activeModules,
    main,
    input.maxSatellites ?? DEFAULT_MAX_SATELLITES
  );

  return {
    main,
    satellites,
    overflowCount,
    expandedKind: safeExpandedKind,
    reason,
    size: resolveSize(safeExpandedKind, satellites, overflowCount),
  };
}

/** 兼容旧的单主岛解析接口，后续调用方应迁移到 resolveIslandLayout */
export function resolveIslandDisplay(input: IslandDisplayInput): IslandDisplayKind {
  return resolveIslandLayout({
    modules: [
      { kind: 'agent', active: Boolean(input.agentActive) },
      { kind: 'wechat', active: Boolean(input.wechatActive) },
      { kind: 'notification', active: Boolean(input.notificationActive), interrupt: 'soft' },
      { kind: 'system-toast', active: Boolean(input.systemToastActive), interrupt: 'soft' },
      { kind: 'music', active: input.musicEnabled },
      { kind: 'hardware', active: input.hardwareEnabled },
      { kind: 'network', active: true },
    ],
    now: Date.now(),
    rotationEnabled: input.rotationEnabled,
    rotationIndex: input.rotationIndex,
  }).main;
}
