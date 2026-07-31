import { ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createDashboardLocation,
  openSettingsCategory,
  openSettingsHome,
  resolveDashboardBack,
  type DashboardLocation,
  type SettingsCategoryId,
} from '@/modules/dashboard/settingsNavigation';
import {
  createEventListenerRegistry,
  type EventListen,
} from '@/shared/utils/eventListenerRegistry';

export type DashboardTransition = (update: () => void) => Promise<void>;

interface MainWindowActions {
  show: () => Promise<void>;
  unminimize: () => Promise<void>;
  setFocus: () => Promise<void>;
}

interface DashboardNavigationOptions {
  listenEvent?: EventListen;
  windowActions?: MainWindowActions;
}

const immediateTransition: DashboardTransition = async (update) => {
  update();
};

export function useDashboardNavigation(options: DashboardNavigationOptions = {}) {
  const registry = createEventListenerRegistry(options.listenEvent);
  const location = ref<DashboardLocation>(createDashboardLocation());
  const isNavigating = ref(false);
  let started = false;

  const navigate = async (
    nextLocation: DashboardLocation,
    transition: DashboardTransition = immediateTransition
  ): Promise<boolean> => {
    if (isNavigating.value) return false;

    isNavigating.value = true;
    try {
      await transition(() => {
        location.value = nextLocation;
      });
      return true;
    } finally {
      isNavigating.value = false;
    }
  };

  const openHome = (transition?: DashboardTransition) => navigate(openSettingsHome(), transition);

  const openCategory = (category: SettingsCategoryId, transition?: DashboardTransition) =>
    navigate(openSettingsCategory(category), transition);

  const goBack = (transition?: DashboardTransition) =>
    navigate(resolveDashboardBack(location.value), transition);

  const start = async () => {
    if (started) return;
    started = true;
    await registry.register('open-settings-panel', async () => {
      let windowActions = options.windowActions;
      if (!windowActions) {
        const appWindow = getCurrentWindow();
        windowActions = {
          show: () => appWindow.show(),
          unminimize: () => appWindow.unminimize(),
          setFocus: () => appWindow.setFocus(),
        };
      }
      location.value = openSettingsHome();
      await windowActions.show();
      await windowActions.unminimize();
      await windowActions.setFocus();
    });
  };

  const dispose = () => {
    registry.dispose();
  };

  return {
    location,
    isNavigating,
    openHome,
    openCategory,
    goBack,
    start,
    dispose,
  };
}
