const failureRecoveryText = "请重试，或导出诊断信息查看原因。";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "未知错误";
};

export const formatSettingsFailureMessage = (action: string, error: unknown): string =>
  `${action}失败：${getErrorMessage(error)}。${failureRecoveryText}`;

export const formatSettingsSuccessMessage = (savedAtIso: string): string => `设置已保存 · ${savedAtIso.slice(11, 19)}`;
