function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function parseBoolean(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value?.toLowerCase() ?? '');
}

function parseIds(value: string | undefined): string[] {
    return value?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
}

export const config = {
    discord: {
        token: requireEnv('DISCORD_API_KEY'),
        adminId: process.env['DISCORD_ADMIN_ID'] ?? '',
        adminNotificationsChannelId: process.env['DISCORD_ADMIN_NOTIFICATIONS_CHANNEL_ID'] ?? '',
        devMode: parseBoolean(process.env['DISCORD_DEV_MODE']),
        devUserIds: parseIds(process.env['DISCORD_DEV_USER_IDS']),
        devGuildIds: parseIds(process.env['DISCORD_DEV_GUILD_IDS']),
    },
    laravel: {
        apiUrl: requireEnv('LARAVEL_API_URL'),
        apiToken: requireEnv('LARAVEL_API_TOKEN'),
    },
    polling: {
        intervalMs: 60 * 1000,
        httpTimeoutMs: 30 * 1000,
    },
} as const;

if (config.discord.devMode && config.discord.devUserIds.length === 0 && config.discord.devGuildIds.length === 0) {
    console.warn('Dev mode is enabled but DISCORD_DEV_USER_IDS and DISCORD_DEV_GUILD_IDS are empty — all deliveries will be suppressed');
}

export type Config = typeof config;
