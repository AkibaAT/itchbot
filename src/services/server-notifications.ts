import type { Client, TextBasedChannel } from "discord.js";
import { api, type ServerNotification } from "./api.ts";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

export class ServerNotificationService {
  constructor(private client: Client) {}

  async processServerNotifications() {
    console.log("\n[processServerNotifications] Start");

    try {
      const resp = await api.getPendingServerNotifications();
      const notifications = resp.notifications;

      if (!notifications || notifications.length === 0) return;

      console.log(
        `[processServerNotifications] Processing ${notifications.length} notifications`,
      );

      for (const notif of notifications) {
        await this.deliverNotificationWithRetry(notif);
      }
    } catch (error) {
      console.error("[processServerNotifications] Error:", error);
    }
  }

  private async deliverNotificationWithRetry(notif: ServerNotification) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.deliverNotification(notif);
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (attempt < MAX_RETRIES) {
          console.warn(
            `[deliverNotification] Attempt ${attempt + 1} failed for #${notif.id}, retrying in ${RETRY_DELAY_MS}ms: ${errorMessage}`,
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          console.error(
            `[deliverNotification] All attempts failed for #${notif.id}: ${errorMessage}`,
          );

          try {
            await api.markServerNotificationFailed(
              notif.id,
              errorMessage.slice(0, 500),
            );
          } catch (statusError) {
            console.error(
              `[deliverNotification] Failed to mark #${notif.id} as failed:`,
              statusError,
            );
          }
        }
      }
    }
  }

  private async deliverNotification(notif: ServerNotification) {
    const channel = (await this.client.channels.fetch(
      notif.channel_id,
    )) as TextBasedChannel | null;

    if (!channel || !channel.isTextBased()) {
      await api.markServerNotificationFailed(
        notif.id,
        `Channel ${notif.channel_id} not found or not text-based`,
      );
      return;
    }

    const payload = notif.payload || {};

    const messageOptions: Record<string, unknown> = {};

    if (payload.content) {
      messageOptions.content = payload.content;
    }

    if (payload.embeds && Array.isArray(payload.embeds)) {
      messageOptions.embeds = payload.embeds;
    }

    if (!messageOptions.content && !messageOptions.embeds) {
      messageOptions.content = notif.game_name
        ? `**${notif.game_name}** - ${notif.notification_type}`
        : `Notification: ${notif.notification_type}`;
    }

    const message = await (channel as any).send(messageOptions);
    await api.markServerNotificationDelivered(notif.id, message.id);

    console.log(
      `[deliverNotification] Sent #${notif.id} to channel ${notif.channel_id}`,
    );
  }
}
