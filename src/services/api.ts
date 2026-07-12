import {config} from '../config.ts';

interface ApiResponse {
    [key: string]: unknown;
}

const httpClient = {
    timeout: config.polling.httpTimeoutMs,
};

export const api = {
    async request<T = ApiResponse>(
        method: 'GET' | 'POST',
        path: string,
        data?: Record<string, unknown> | null
    ): Promise<T> {
        const url = `${config.laravel.apiUrl}/api${path}`;
        console.log(`[API] ${method} ${url}`);

        const body = data ? JSON.stringify(data) : undefined;
        const response = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${config.laravel.apiToken}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(httpClient.timeout),
        });

        const responseText = await response.text();
        const responsePreview = responseText.length > 100
            ? responseText.slice(0, 100) + '...'
            : responseText;

        console.log(`[API] Response status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}, body: ${responsePreview}`);
        }

        return JSON.parse(responseText) as T;
    },

    async search(name: string): Promise<{
        matches: number;
        games: GameResult[];
        search_url?: string;
    }> {
        return this.request('POST', '/discord/search', {name});
    },

    async getUpdates(): Promise<{
        updates: Update[];
        discord_users: string[];
    }> {
        return this.request('POST', '/discord/updates', null);
    },

    async getPendingNotifications(): Promise<{
        notifications: Notification[];
        batch_key: string;
    }> {
        return this.request('GET', '/discord-notifications/pending', null);
    },

    async recordNotificationStatus(
        batchKey: string,
        notifications: Array<{
            notification_id: number;
            success: boolean;
            error: string;
        }>
    ): Promise<{ message: string }> {
        return this.request('POST', '/discord-notifications/status', {
            batch_key: batchKey,
            notifications,
        });
    },

    async getAdditionRequests(): Promise<{
        notifications: AdditionRequest[];
        admin_panel_url: string;
    }> {
        const since = encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString());
        return this.request('GET', `/discord-notifications/addition-requests?limit=20&since=${since}`);
    },

    async getReviewReports(): Promise<{
        notifications: ReviewReport[];
    }> {
        return this.request('GET', '/discord-notifications/review-reports', null);
    },
};

export interface GameResult {
    name: string;
    version: string;
    english_word_count?: number;
    published_at: number;
    url: string | UrlMap;
    primary_url?: string;
}

export interface UrlMap {
    itch_io?: string;
    steam?: string;
    other?: string;
}

export interface Update {
    name: string;
    version: string;
    published_at: string | number;
    url: string | UrlMap;
    devlog?: string;
}

export interface Notification {
    notification_id: number;
    discord_user_id: string;
    game: {
        name: string;
        version: string;
        published_at: number;
        url: string | UrlMap;
        devlog_url?: string;
        word_count_diff?: number;
        compared_to_version?: {
            version: string;
            is_last_read: boolean;
        };
    };
    is_digest: boolean;
    digest_type?: string;
}

export interface AdditionRequest {
    url: string;
    user_count: number;
    users: Array<{ name: string }>;
}

export interface ReviewReport {
    reason: string;
    reporter: string;
    review_author: string;
    game_name: string;
    details: string;
    review_excerpt: string;
    admin_panel_url: string;
}

export function extractUrl(url: string | UrlMap | undefined | null): string {
    if (!url) return '';
    if (typeof url === 'string') return url;
    if (url.itch_io) return url.itch_io;
    if (url.steam) return url.steam;
    if (url.other) return url.other;
    return '';
}
