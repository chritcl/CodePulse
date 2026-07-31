export interface SettingsFeedback {
  kind: 'success' | 'error';
  message: string;
}

export interface SettingsAction<T> {
  key: string;
  getValue: () => T;
  setValue: (value: T) => void;
  nextValue: T;
  sync: (value: T) => Promise<void>;
  successMessage: string;
  errorMessage: string;
}

export type SettingsFeedbackHandler = (feedback: SettingsFeedback) => void;

export const createSettingsActionCoordinator = (showFeedback: SettingsFeedbackHandler) => {
  const generations = new Map<string, number>();

  const apply = async <T>(action: SettingsAction<T>): Promise<boolean> => {
    const previousValue = action.getValue();
    const generation = (generations.get(action.key) ?? 0) + 1;
    generations.set(action.key, generation);
    action.setValue(action.nextValue);

    try {
      await action.sync(action.nextValue);
      if (generations.get(action.key) === generation) {
        showFeedback({
          kind: 'success',
          message: action.successMessage,
        });
      }
      return true;
    } catch {
      if (generations.get(action.key) === generation) {
        action.setValue(previousValue);
        showFeedback({
          kind: 'error',
          message: action.errorMessage,
        });
      }
      return false;
    }
  };

  return { apply };
};
