import {describe, expect, test} from 'bun:test';
import {DeliveryPolicy} from './delivery-policy.ts';

describe('DeliveryPolicy', () => {
    test('allows every destination outside dev mode', () => {
        const policy = new DeliveryPolicy({
            devMode: false,
            devUserIds: [],
            devGuildIds: [],
        });

        expect(policy.allowsUser('user-1')).toBe(true);
        expect(policy.allowsGuild('guild-1')).toBe(true);
    });

    test('only allows explicitly listed users and guilds in dev mode', () => {
        const policy = new DeliveryPolicy({
            devMode: true,
            devUserIds: ['user-1'],
            devGuildIds: ['guild-1'],
        });

        expect(policy.allowsUser('user-1')).toBe(true);
        expect(policy.allowsUser('user-2')).toBe(false);
        expect(policy.allowsGuild('guild-1')).toBe(true);
        expect(policy.allowsGuild('guild-2')).toBe(false);
    });
});
