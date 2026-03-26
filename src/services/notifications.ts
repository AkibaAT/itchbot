import type {Client, GuildTextBasedChannel} from 'discord.js';
import {api, extractUrl, type Update} from './api.ts';
import {config} from '../config.ts';

export class NotificationService {
    constructor(private client: Client) {
    }

    async processUpdates() {
        console.log('\n[processUpdates] Start');

        try {
            const resp = await api.getUpdates();
            const updates = resp.updates;

            if (!updates || updates.length === 0) return;

            const messageChunks = this.buildUpdateMessages(updates);

            for (const userId of resp.discord_users) {
                await this.sendUserNotifications(userId, messageChunks);
            }

            if (this.shouldNotifyChannel(resp.discord_users)) {
                this.sendChannelNotifications(messageChunks);
            }
        } catch (error) {
            console.error('[processUpdates] Error:', error);
        }
    }

    async processUserNotifications() {
        console.log('\n[processUserNotifications] Start');

        try {
            const resp = await api.getPendingNotifications();
            const notifications = resp.notifications;

            if (!notifications || notifications.length === 0) return;

            const batchKey = resp.batch_key;
            const results: Array<{ notification_id: number; success: boolean; error: string }> = [];

            for (const notif of notifications) {
                const {notification_id, discord_user_id, game, is_digest, digest_type} = notif;

                const gameUrl = extractUrl(game.url);
                const devlogUrl = game.devlog_url ?? '';

                let wordCountMsg = '';
                if (game.word_count_diff && game.word_count_diff !== 0) {
                    const comparedVersion = game.compared_to_version;
                    const compareType = comparedVersion?.is_last_read ? 'your last read' : 'previous version';
                    wordCountMsg = `\nWord count change from ${compareType} (${comparedVersion?.version}): ${game.word_count_diff > 0 ? '+' : ''}${game.word_count_diff.toLocaleString()} words`;
                }

                let message: string;
                if (is_digest) {
                    const digestTypeStr = digest_type === 'daily'
                        ? 'Daily Game Updates'
                        : digest_type === 'weekly'
                            ? 'Weekly Game Updates'
                            : 'Game Updates';
                    message = `${digestTypeStr}\n${game.name}\nVersion: ${game.version}\nReleased: <t:${Math.floor(game.published_at)}:f>${wordCountMsg}\nGame: <${gameUrl}>\nDevlog: <${devlogUrl}>`;
                } else {
                    message = `New Update Available!\n\n${game.name}\nVersion: ${game.version}\nReleased: <t:${Math.floor(game.published_at)}:f>${wordCountMsg}\nGame: <${gameUrl}>\nDevlog: <${devlogUrl}>`;
                }

                const result = await this.sendDM(discord_user_id, message);
                results.push({
                    notification_id,
                    success: result.success,
                    error: result.error,
                });
            }

            const statusResp = await api.recordNotificationStatus(batchKey, results);
            console.log(`[processUserNotifications] Status: ${statusResp.message}`);
        } catch (error) {
            console.error('[processUserNotifications] Error:', error);
        }
    }

    async processAdditionRequestNotifications() {
        console.log('\n[processAdditionRequestNotifications] Start');

        if (!config.discord.adminId) {
            console.log('[processAdditionRequestNotifications] No admin ID configured, skipping');
            return;
        }

        try {
            const resp = await api.getAdditionRequests();
            const notifications = resp.notifications;

            if (!notifications || notifications.length === 0) return;

            const adminPanelUrl = resp.admin_panel_url ?? '';
            const adminUser = await this.client.users.fetch(config.discord.adminId);
            const channel = await adminUser.createDM();

            for (const n of notifications) {
                const userNames = n.users.map((u) => u.name).join(', ');
                const pluralSuffix = n.user_count !== 1 ? 's' : '';

                const message = `🎮 **New VN Addition Request**\n\n**URL:** ${n.url}\n**Requested by:** ${userNames} (${n.user_count} user${pluralSuffix})\n**Admin Panel:** <${adminPanelUrl}>`;

                await channel.send(message);
                console.log(`[processAdditionRequestNotifications] Sent for: ${n.url}`);
            }
        } catch (error) {
            console.error('[processAdditionRequestNotifications] Error:', error);
        }
    }

    async processReviewReportNotifications() {
        console.log('\n[processReviewReportNotifications] Start');

        if (!config.discord.adminId) {
            console.log('[processReviewReportNotifications] No admin ID configured, skipping');
            return;
        }

        try {
            const resp = await api.getReviewReports();
            const notifications = resp.notifications;

            if (!notifications || notifications.length === 0) return;

            const adminUser = await this.client.users.fetch(config.discord.adminId);
            const channel = await adminUser.createDM();

            for (const n of notifications) {
                let message = `🚩 **Review Report**\n\n**Game:** ${n.game_name}\n**Review by:** ${n.review_author}\n**Reported by:** ${n.reporter}\n**Reason:** ${n.reason}`;

                if (n.details) {
                    message += `\n**Details:** ${n.details}`;
                }

                if (n.review_excerpt) {
                    message += `\n\n> ${n.review_excerpt.slice(0, 200)}`;
                }

                message += `\n\n**Admin Panel:** <${n.admin_panel_url}>`;

                await channel.send(message);
                console.log(`[processReviewReportNotifications] Sent for game: ${n.game_name}`);
            }
        } catch (error) {
            console.error('[processReviewReportNotifications] Error:', error);
        }
    }

    private buildUpdateMessages(updates: Update[]): string[] {
        const chunks: string[] = [];
        let currentChunk = `Found ${updates.length} new updates:\n`;

        for (const update of updates) {
            const publishedAt = typeof update.published_at === 'number'
                ? Math.floor(update.published_at).toString()
                : update.published_at;

            const url = extractUrl(update.url);

            const entry = `${update.name}, Latest Version: ${update.version}, Last Updated At: <t:${publishedAt}:f> <${url}> | <${update.devlog ?? ''}>\n`;

            if (currentChunk.length + entry.length > 1900) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += entry;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    private async sendUserNotifications(userId: string, chunks: string[]) {
        try {
            const user = await this.client.users.fetch(userId);
            const channel = await user.createDM();
            for (const chunk of chunks) {
                await channel.send(chunk);
            }
        } catch (error) {
            console.error(`[sendUserNotifications] Error for ${userId}:`, error);
        }
    }

    private async sendChannelNotifications(chunks: string[]) {
        const channelId = config.discord.notificationsChannelId;
        if (!channelId) return;

        try {
            const channel = await this.client.channels.fetch(channelId) as GuildTextBasedChannel | null;
            if (!channel) {
                console.error('[sendChannelNotifications] Channel not found');
                return;
            }

            for (const chunk of chunks) {
                await channel.send(chunk);
            }
        } catch (error) {
            console.error('[sendChannelNotifications] Error:', error);
        }
    }

    private shouldNotifyChannel(users: string[]): boolean {
        return users.includes(config.discord.adminId);
    }

    private async sendDM(userId: string, message: string): Promise<{ success: boolean; error: string }> {
        try {
            const user = await this.client.users.fetch(userId);
            const channel = await user.createDM();
            await channel.send(message);
            return {success: true, error: ''};
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[sendDM] Error for ${userId}:`, errorMessage);
            return {success: false, error: errorMessage};
        }
    }
}