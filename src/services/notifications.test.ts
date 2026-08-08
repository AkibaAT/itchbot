import {afterEach, expect, test} from 'bun:test';
import type {Client} from 'discord.js';

process.env['DISCORD_API_KEY'] = 'test-token';
process.env['DISCORD_ADMIN_ID'] = 'admin-1';
process.env['DISCORD_ADMIN_NOTIFICATIONS_CHANNEL_ID'] = '';
process.env['DISCORD_DEV_MODE'] = 'false';
process.env['DISCORD_DEV_USER_IDS'] = '';
process.env['DISCORD_DEV_GUILD_IDS'] = '';
process.env['LARAVEL_API_URL'] = 'https://example.test';
process.env['LARAVEL_API_TOKEN'] = 'test-api-token';

const {api} = await import('./api.ts');
const {NotificationService} = await import('./notifications.ts');

const originalGetChannelUpdates = api.getChannelUpdates;
const originalRecordChannelStatus = api.recordChannelStatus;

afterEach(() => {
    api.getChannelUpdates = originalGetChannelUpdates;
    api.recordChannelStatus = originalRecordChannelStatus;
});

test('sends every global update to the configured admin without requiring a channel', async () => {
    const sentMessages: string[] = [];
    const recordedBatches: Array<{ batchKey: string; success: boolean }> = [];
    let requestedAdminId = '';

    api.getChannelUpdates = async () => ({
        batch_key: 'updates-1',
        notifications: [
            {
                announcement_id: 10,
                name: 'First VN',
                version: '2.0',
                published_at: 1_700_000_000,
                url: 'https://example.test/first',
            },
            {
                announcement_id: 11,
                name: 'Second VN',
                version: '3.0',
                published_at: 1_700_000_100,
                url: 'https://example.test/second',
            },
        ],
    });
    api.recordChannelStatus = async (batchKey, results) => {
        recordedBatches.push({batchKey, success: results.every((result) => result.success)});
        return {message: 'recorded'};
    };

    const client = {
        users: {
            fetch: async (userId: string) => {
                requestedAdminId = userId;
                return {
                    createDM: async () => ({
                        send: async ({content}: { content: string }) => {
                            sentMessages.push(content);
                        },
                    }),
                };
            },
        },
        channels: {
            fetch: async () => {
                throw new Error('A channel must not be required for admin updates');
            },
        },
    } as unknown as Client;

    await new NotificationService(client).processUpdates();

    expect(requestedAdminId).toBe('admin-1');
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain('Found 2 new updates:');
    expect(sentMessages[0]).toContain('First VN');
    expect(sentMessages[0]).toContain('Second VN');
    expect(recordedBatches).toEqual([{batchKey: 'updates-1', success: true}]);
});
