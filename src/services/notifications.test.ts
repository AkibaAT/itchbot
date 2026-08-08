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
const {config} = await import('../config.ts');
const {NotificationService} = await import('./notifications.ts');

const originalGetChannelUpdates = api.getChannelUpdates;
const originalRecordChannelStatus = api.recordChannelStatus;
const originalGetPendingNotifications = api.getPendingNotifications;
const originalRecordNotificationStatus = api.recordNotificationStatus;
const originalGetAdditionRequests = api.getAdditionRequests;
const originalAckAdditionRequests = api.ackAdditionRequests;

afterEach(() => {
    api.getChannelUpdates = originalGetChannelUpdates;
    api.recordChannelStatus = originalRecordChannelStatus;
    api.getPendingNotifications = originalGetPendingNotifications;
    api.recordNotificationStatus = originalRecordNotificationStatus;
    api.getAdditionRequests = originalGetAdditionRequests;
    api.ackAdditionRequests = originalAckAdditionRequests;
    (config.discord as {devMode: boolean}).devMode = false;
});

test('chunks update content below the safe message limit and preserves per-item acknowledgement mapping', () => {
    const service = new NotificationService({} as Client);
    const chunks = service.buildUpdateMessages([
        {announcement_id: 1, name: 'A'.repeat(2_200), version: '1', published_at: 1, url: 'https://example.test'},
        {announcement_id: 2, name: 'Second', version: '2', published_at: 2, url: 'https://example.test'},
    ]);

    expect(chunks.every((chunk) => chunk.content.length <= 1900)).toBeTrue();
    expect(chunks.flatMap((chunk) => chunk.announcementIds)).toEqual([1, 2]);
});

test('reports dev-mode DM suppression as a retryable non-success', async () => {
    (config.discord as {devMode: boolean}).devMode = true;
    api.getPendingNotifications = async () => ({
        batch_key: 'dm-batch',
        notifications: [{
            notification_id: 7,
            discord_user_id: 'not-allowlisted',
            type: 'test',
            game: null,
            is_digest: false,
        }],
    });
    let recorded: Parameters<typeof api.recordNotificationStatus>[1] = [];
    api.recordNotificationStatus = async (_batchKey, notifications) => {
        recorded = notifications;
        return {message: 'recorded'};
    };

    await new NotificationService({} as Client).processUserNotifications();

    expect(recorded[0]).toMatchObject({success: false, error_code: 'dev_mode_suppressed', retryable: true});
});

test('acknowledges each admin alert only after that alert is sent', async () => {
    api.getAdditionRequests = async () => ({
        admin_panel_url: 'https://example.test/admin',
        notifications: [
            {id: 1, url: 'https://one.test', user_count: 1, users: [{name: 'One'}]},
            {id: 2, url: 'https://two.test', user_count: 1, users: [{name: 'Two'}]},
        ],
    });
    const acknowledgements: number[][] = [];
    api.ackAdditionRequests = async (ids) => {
        acknowledgements.push(ids);
        return {success: true};
    };
    let sends = 0;
    const client = {
        users: {fetch: async () => ({createDM: async () => ({send: async () => {
            sends++;
            if (sends === 2) throw Object.assign(new Error('Discord unavailable'), {status: 503});
        }})})},
    } as unknown as Client;

    await expect(new NotificationService(client).processAdditionRequestNotifications()).resolves.toBe('error');
    expect(acknowledgements).toEqual([[1]]);
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
