import {afterEach, expect, test} from 'bun:test';

process.env['DISCORD_API_KEY'] = 'test-token';
process.env['LARAVEL_API_URL'] = 'https://example.test';
process.env['LARAVEL_API_TOKEN'] = 'test-api-token';

const {api, ApiRequestError} = await import('./api.ts');
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test('API retries transient 5xx responses and succeeds', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
        attempts++;
        return attempts < 3
            ? new Response('{"error":"down"}', {status: 503})
            : new Response('{"success":true}', {status: 200});
    }) as unknown as typeof fetch;

    await expect(api.request('GET', '/retry-test')).resolves.toEqual({success: true});
    expect(attempts).toBe(3);
});

test('API does not retry validation failures', async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
        attempts++;
        return new Response('{"error":"invalid"}', {status: 422});
    }) as unknown as typeof fetch;

    await expect(api.request('POST', '/validation-test', {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(attempts).toBe(1);
});
