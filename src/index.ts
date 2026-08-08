import {Client, Events, IntentsBitField} from 'discord.js';
import {config} from './config.ts';
import {registerCommands, registerEvents} from './events/handlers.ts';
import {reconcileCurrentGuilds, registerGuildEvents} from './events/guilds.ts';
import {api, ApiRequestError} from './services/api.ts';
import {NotificationService} from './services/notifications.ts';
import {ServerNotificationService} from './services/server-notifications.ts';

const client = new Client({intents: [IntentsBitField.Flags.Guilds]});
const notificationService = new NotificationService(client);
const serverNotificationService = new ServerNotificationService(client);

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let inFlightPoll: Promise<void> | null = null;
let shuttingDown = false;
let consecutiveFailedPasses = 0;
let serverBotAvailable = false;

registerEvents(client);
client.on(Events.Error, (error) => console.error('Discord client error:', error));
client.on(Events.Warn, (message) => console.warn('Discord client warning:', message));
process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));

async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(pollTimer);
    console.log(`Received ${signal}; waiting for the active notification pass to drain`);

    if (inFlightPoll) {
        await Promise.race([
            inFlightPoll.catch(() => undefined),
            Bun.sleep(30_000).then(() => console.warn('Notification pass did not drain within 30 seconds')),
        ]);
    }

    client.destroy();
    process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main(): Promise<void> {
    client.once(Events.ClientReady, async (readyClient) => {
        console.log('Discord connection established');
        try {
            await reconcileCurrentGuilds(readyClient);
            registerGuildEvents(readyClient);
            serverBotAvailable = true;
        } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
                console.log('[Ready] Discord server management is disabled; continuing with DM features');
            } else {
                console.warn('[Ready] Discord server management is unavailable; continuing with DM features:', error);
            }
        }
        await registerCommands(readyClient);
        schedulePoll(0);
    });

    await client.login(config.discord.token);
}

function schedulePoll(delay: number): void {
    if (shuttingDown) return;
    pollTimer = setTimeout(() => {
        inFlightPoll = runPoll().finally(() => {
            inFlightPoll = null;
            schedulePoll(config.polling.intervalMs);
        });
    }, delay);
}

async function runPoll(): Promise<void> {
    const passes: Record<string, string> = {};
    passes.channel_updates = await notificationService.processUpdates();
    passes.user_notifications = await notificationService.processUserNotifications();
    passes.addition_requests = await notificationService.processAdditionRequestNotifications();
    passes.review_reports = await notificationService.processReviewReportNotifications();
    passes.server_notifications = serverBotAvailable ? await serverNotificationService.processServerNotifications() : 'disabled';

    const failed = Object.values(passes).some((status) => status === 'error');
    consecutiveFailedPasses = failed ? consecutiveFailedPasses + 1 : 0;
    const status = consecutiveFailedPasses >= 3 ? 'degraded' : 'ok';

    try {
        await api.heartbeat(status, passes);
    } catch (error) {
        consecutiveFailedPasses++;
        console.error('[poll] Failed to report heartbeat:', error);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
