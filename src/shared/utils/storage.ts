/** 从 localStorage 读取字符串 */
export function readString(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

/** 判断 localStorage 中是否存在指定 key */
export function hasStorageValue(key: string): boolean {
  return localStorage.getItem(key) !== null;
}

/** 从 localStorage 读取数字 */
export function readNumber(key: string, fallback: number): number {
  const storedValue = localStorage.getItem(key);
  if (storedValue === null) return fallback;

  const value = Number(storedValue);
  return Number.isFinite(value) ? value : fallback;
}

/** 写入字符串 */
export function writeString(key: string, value: string): void {
  localStorage.setItem(key, value);
}

/** 写入数字 */
export function writeNumber(key: string, value: number): void {
  localStorage.setItem(key, String(value));
}

/** 从 localStorage 读取布尔值 */
export function readBoolean(key: string, fallback = false): boolean {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === 'true';
}

/** 写入布尔值 */
export function writeBoolean(key: string, value: boolean): void {
  localStorage.setItem(key, String(value));
}

/** 从 localStorage 读取枚举值 */
export function readEnum<const T extends readonly string[]>(
  key: string,
  fallback: T[number],
  allowedValues: T
): T[number] {
  const value = localStorage.getItem(key);
  return value && allowedValues.includes(value) ? value : fallback;
}
