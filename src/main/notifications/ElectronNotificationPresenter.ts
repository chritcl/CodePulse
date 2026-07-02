import { Notification, type NotificationConstructorOptions } from "electron";
import type {
  NotificationActionIndex,
  NotificationHandle,
  NotificationOptions,
  NotificationPresenter
} from "./NotificationManager";

class ElectronNotificationHandle implements NotificationHandle {
  private readonly notification: Notification;

  constructor(options: NotificationOptions) {
    const notificationOptions: NotificationConstructorOptions = {
      id: options.id,
      title: options.title,
      body: options.body,
      groupId: "codepulse",
      groupTitle: "CodePulse",
      timeoutType: options.eventType === "taskWaiting" || options.eventType === "taskFailed" ? "never" : "default",
      urgency: options.eventType === "taskFailed" || options.eventType === "quotaEmpty" ? "critical" : "normal"
    };

    if (options.actions) {
      notificationOptions.actions = options.actions;
    }

    this.notification = new Notification(notificationOptions);
  }

  show(): void {
    this.notification.show();
  }

  onClick(listener: () => void): void {
    this.notification.on("click", listener);
  }

  onAction(listener: (index: NotificationActionIndex) => void): void {
    this.notification.on("action", (event) => {
      listener(event.actionIndex);
    });
  }
}

export class ElectronNotificationPresenter implements NotificationPresenter {
  create(options: NotificationOptions): NotificationHandle {
    return new ElectronNotificationHandle(options);
  }
}
