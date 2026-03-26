export const config = {
    discord: {
        token: process.env.DISCORD_API_KEY!,
        adminId: process.env.DISCORD_ADMIN_ID ?? '',
        notificationsChannelId: process.env.DISCORD_NOTIFICATIONS_CHANNEL_ID ?? '',
    },
    laravel: {
        apiUrl: process.env.LARAVEL_API_URL!,
        apiToken: process.env.LARAVEL_API_TOKEN!,
    },
    polling: {
        intervalMs: 60 * 1000,
        httpTimeoutMs: 30 * 1000,
    },
} as const;

export type Config = typeof config;