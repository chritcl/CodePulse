/** 打开应用载荷 */
export interface OpenAppPayload {
  aumid: string;
  appName: string;
  launchId?: string;
}

/** 累计接收与发送字节数 */
export type NetworkStats = [receivedBytes: number, transmittedBytes: number];

/** 处理器占用、已用内存和总内存 */
export type HardwareStats = [cpuUsage: number, usedMemory: number, totalMemory: number];

/** 最新系统通知 */
export interface LatestNotificationPayload {
  app_name: string;
  title: string;
  body: string;
  aumid: string;
}
