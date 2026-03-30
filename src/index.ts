import {Client, Events, IntentsBitField} from 'discord.js';
import {config} from './config.ts';
import {registerCommands, registerEvents} from './events/handlers.ts';
import {registerGuildEvents} from './events/guilds.ts';
import {NotificationService} from './services/notifications.ts';
import {ServerNotificationService} from './services/server-notifications.ts';

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.DirectMessages,
    ],
});

const notificationService = new NotificationService(client);
const serverNotificationService = new ServerNotificationService(client);

registerEvents(client);
registerGuildEvents(client);

async function main() {
    client.once(Events.ClientReady, async () => {
        console.log('Discord connection established');
        await registerCommands(client);
        startNotificationLoop();
    });

    await client.login(config.discord.token);
}

function startNotificationLoop() {
    const poll = async () => {
        await notificationService.processUpdates();
        await notificationService.processUserNotifications();
        await notificationService.processAdditionRequestNotifications();
        await notificationService.processReviewReportNotifications();
        await serverNotificationService.processServerNotifications();
    };

    poll();
    setInterval(poll, config.polling.intervalMs);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
