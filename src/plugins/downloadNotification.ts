import { registerPlugin } from '@capacitor/core';

export interface DownloadNotificationPlugin {
  showDownloadNotification(options: {
    filePath: string;
    fileName: string;
    title?: string;
    message?: string;
  }): Promise<{ success: boolean; message: string }>;
}

const DownloadNotification = registerPlugin<DownloadNotificationPlugin>('DownloadNotification');

export default DownloadNotification;
