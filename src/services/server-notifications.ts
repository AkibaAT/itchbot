import type { Client, TextBasedChannel } from "discord.js";
import { api, type ServerNotification } from "./api.ts";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

export class ServerNotificationService {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async processServerNotifications(): Promise<"ok" | "error"> {
    console.log("\n[processServerNotifications] Start");

    try {
      const resp = await api.getPendingServerNotifications();
      const notifications = resp.notifications;

      if (!notifications || notifications.length === 0) return "ok";

      console.log(
        `[processServerNotifications] Processing ${notifications.length} notifications`,
      );

      for (const notif of notifications) {
        await this.deliverNotificationWithRetry(notif, resp.batch_key);
      }
      return "ok";
    } catch (error) {
      console.error("[processServerNotifications] Error:", error);
      return "error";
    }
  }

  private async deliverNotificationWithRetry(notif: ServerNotification, batchKey: string) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.deliverNotification(notif, batchKey);
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
              batchKey,
              errorMessage.slice(0, 500),
              true,
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

  private async deliverNotification(notif: ServerNotification, batchKey: string) {
    const channel = (await this.client.channels.fetch(
      notif.channel_id,
    )) as TextBasedChannel | null;

    if (!channel || !channel.isTextBased()) {
      await api.markServerNotificationFailed(
        notif.id,
        batchKey,
        `Channel ${notif.channel_id} not found or not text-based`,
        false,
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

    let message;
    if (notif.delivery_mode === "edit" && notif.message_id) {
      try {
        const existingMessage = await (channel as any).messages.fetch(
          notif.message_id,
        );
        message = await existingMessage.edit(messageOptions);
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code !== 10008) {
          throw error;
        }

        console.warn(
          `[deliverNotification] Original message ${notif.message_id} was deleted; creating a replacement`,
        );
        message = await (channel as any).send(messageOptions);
      }
    } else {
      message = await (channel as any).send(messageOptions);
    }
    await api.markServerNotificationDelivered(notif.id, batchKey, message.id);

    console.log(
      `[deliverNotification] ${notif.delivery_mode === "edit" ? "Synced" : "Sent"} #${notif.id} in channel ${notif.channel_id}`,
    );
  }
}
