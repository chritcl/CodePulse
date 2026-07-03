/**
 * Pinia Store 入口
 */

import { createPinia } from 'pinia';

export const pinia = createPinia();

export { useSettingsStore } from './settings';
export { useNetworkStore } from './network';
export { useIslandStore } from './island';
