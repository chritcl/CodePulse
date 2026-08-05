import { describe, expect, it } from 'vitest';
import {
  createDashboardLocation,
  openSettingsCategory,
  openSettingsHome,
  resolveDashboardBack,
  SETTINGS_CATEGORIES,
} from './settingsNavigation';

describe('设置中心导航', () => {
  it('从控制台进入设置首页，并从设置首页返回控制台', () => {
    const settingsHome = openSettingsHome();

    expect(settingsHome).toEqual({
      page: 'settings-home',
      category: null,
    });
    expect(resolveDashboardBack(settingsHome)).toEqual(createDashboardLocation());
  });

  it('进入分类详情时记录分类，并返回设置首页', () => {
    const detail = openSettingsCategory('codex');

    expect(detail).toEqual({
      page: 'settings-detail',
      category: 'codex',
    });
    expect(resolveDashboardBack(detail)).toEqual(openSettingsHome());
  });

  it('设置首页暴露五个固定分类', () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      'appearance',
      'island',
      'system',
      'codex',
      'claude',
    ]);
  });
});
