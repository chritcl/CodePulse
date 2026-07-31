export type SettingsCategoryId = 'appearance' | 'island' | 'system' | 'codex';

export type DashboardPage = 'dashboard' | 'settings-home' | 'settings-detail';

export interface DashboardLocation {
  page: DashboardPage;
  category: SettingsCategoryId | null;
}

export interface SettingsCategoryDefinition {
  id: SettingsCategoryId;
  title: string;
  description: string;
  summary: string;
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryDefinition[] = [
  {
    id: 'appearance',
    title: '外观与动效',
    description: '调整控制台与灵动岛的视觉体验',
    summary: '主题 · 透明度 · 动效',
  },
  {
    id: 'island',
    title: '岛屿内容',
    description: '选择灵动岛展示的内容与方式',
    summary: '音乐 · 通知 · 硬件',
  },
  {
    id: 'system',
    title: '系统与应用',
    description: '管理启动、停靠、更新与应用信息',
    summary: '启动 · 停靠 · 更新',
  },
  {
    id: 'codex',
    title: 'Codex 集成',
    description: '检查 Hook、监听状态与隐私偏好',
    summary: 'Hook · 状态 · 隐私',
  },
] as const;

export const createDashboardLocation = (): DashboardLocation => ({
  page: 'dashboard',
  category: null,
});

export const openSettingsHome = (): DashboardLocation => ({
  page: 'settings-home',
  category: null,
});

export const openSettingsCategory = (category: SettingsCategoryId): DashboardLocation => ({
  page: 'settings-detail',
  category,
});

export const resolveDashboardBack = (location: DashboardLocation): DashboardLocation => {
  if (location.page === 'settings-detail') {
    return openSettingsHome();
  }

  return createDashboardLocation();
};
