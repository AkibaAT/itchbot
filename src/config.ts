function parseBoolean(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value?.toLowerCase() ?? '');
}

function parseIds(value: string | undefined): string[] {
    return value?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
}

export const config = {
    discord: {
        token: process.env.DISCORD_API_KEY!,
        adminId: process.env.DISCORD_ADMIN_ID ?? '',
        notificationsChannelId: process.env.DISCORD_NOTIFICATIONS_CHANNEL_ID ?? '',
        devMode: parseBoolean(process.env.DISCORD_DEV_MODE),
        devUserIds: parseIds(process.env.DISCORD_DEV_USER_IDS),
        devGuildIds: parseIds(process.env.DISCORD_DEV_GUILD_IDS),
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
