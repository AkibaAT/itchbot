import {describe, expect, test} from 'bun:test';
import {classifyDiscordError} from './discord-errors.ts';

describe('classifyDiscordError', () => {
    test.each([50007, 50278, 10013])('classifies Discord code %s as undeliverable', (code) => {
        expect(classifyDiscordError({code, message: 'cannot DM'})).toEqual({code: String(code), category: 'undeliverable', message: 'cannot DM'});
    });

    test('classifies rate limits, server errors, and timeouts as retryable', () => {
        expect(classifyDiscordError({status: 429, message: 'limited'}).category).toBe('retryable');
        expect(classifyDiscordError({status: 503, message: 'down'}).category).toBe('retryable');
        expect(classifyDiscordError({code: 'ETIMEDOUT', message: 'timeout'}).category).toBe('retryable');
    });

    test('classifies permission and validation errors as permanent', () => {
        expect(classifyDiscordError({code: 50013, message: 'missing permissions'}).category).toBe('permanent');
    });
});
