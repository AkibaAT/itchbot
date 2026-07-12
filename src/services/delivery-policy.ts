export interface DeliveryPolicyConfig {
    devMode: boolean;
    devUserIds: readonly string[];
    devGuildIds: readonly string[];
}

export class DeliveryPolicy {
    private readonly userIds: Set<string>;
    private readonly guildIds: Set<string>;

    constructor(private readonly options: DeliveryPolicyConfig) {
        this.userIds = new Set(options.devUserIds);
        this.guildIds = new Set(options.devGuildIds);
    }

    get isDevMode(): boolean {
        return this.options.devMode;
    }

    allowsUser(userId: string): boolean {
        return !this.isDevMode || this.userIds.has(userId);
    }

    allowsGuild(guildId: string): boolean {
        return !this.isDevMode || this.guildIds.has(guildId);
    }
}
