const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const minutesFromTime = (time: string): number => {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
};

export const normalizeQuietHourInput = (value: string | null): string | null => {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  return timePattern.test(normalized) ? normalized : value;
};

export const formatQuietHoursSummary = (start: string | null, end: string | null): string => {
  if (!start || !end) {
    return "未启用时间段";
  }

  const startMinute = minutesFromTime(start);
  const endMinute = minutesFromTime(end);

  if (startMinute === endMinute) {
    return "全天勿扰";
  }

  return startMinute > endMinute ? `${start} 至次日 ${end}` : `${start} 至 ${end}`;
};

export const formatNotificationThresholdSummary = (quotaWarningPercent: number, staleMinutes: number): string =>
  `额度低于 ${quotaWarningPercent}% 提醒；${staleMinutes} 分钟无活动提醒`;
