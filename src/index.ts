import {Client, Events, IntentsBitField} from 'discord.js';
import {config} from './config.ts';
import {registerCommands, registerEvents} from './events/handlers.ts';
import {reconcileCurrentGuilds, registerGuildEvents} from './events/guilds.ts';
import {ApiRequestError} from './services/api.ts';
import {NotificationService} from './services/notifications.ts';
import {ServerNotificationService} from './services/server-notifications.ts';

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
    ],
});

const notificationService = new NotificationService(client);
const serverNotificationService = new ServerNotificationService(client);

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;

registerEvents(client);

client.on(Events.Error, (error) => {
    console.error('Discord client error:', error);
});

client.on(Events.Warn, (message) => {
    console.warn('Discord client warning:', message);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down`);
    clearTimeout(pollTimer);
    client.destroy().finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
    client.once(Events.ClientReady, async (readyClient) => {
        console.log('Discord connection established');
        let serverBotAvailable = false;
        try {
            await reconcileCurrentGuilds(readyClient);
            registerGuildEvents(readyClient);
            serverBotAvailable = true;
        } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
                console.log('[Ready] Discord server management is disabled; continuing with legacy bot features');
            } else {
                console.warn('[Ready] Discord server management is unavailable; continuing with legacy bot features:', error);
            }
        }
        await registerCommands(readyClient);
        startNotificationLoop(serverBotAvailable);
    });

    await client.login(config.discord.token);
}

function startNotificationLoop(serverBotAvailable: boolean) {
    const poll = async () => {
        try {
            await notificationService.processUpdates();
            await notificationService.processUserNotifications();
            await notificationService.processAdditionRequestNotifications();
            await notificationService.processReviewReportNotifications();
            if (serverBotAvailable) {
                await serverNotificationService.processServerNotifications();
            }
        } catch (error) {
            console.error('[poll] Error:', error);
        }

        if (!shuttingDown) {
            pollTimer = setTimeout(poll, config.polling.intervalMs);
        }
    };

    poll();
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
