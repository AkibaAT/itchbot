import type {ChatInputCommandInteraction} from 'discord.js';
import {
    ApplicationIntegrationType,
    InteractionContextType,
    SlashCommandBuilder,
} from 'discord.js';
import {api, extractUrl} from '../services/api.ts';
import type {Command} from './index.ts';

export const searchCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for visual novels by name')
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        )
        .setIntegrationTypes(
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        )
        .addStringOption((option) =>
            option
                .setName('name')
                .setDescription('Game name to search')
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        const name = interaction.options.getString('name', true);

        await interaction.deferReply();

        const username = interaction.user.username;
        console.log(`[Search] Query: "${name}" (user: ${username})`);

        try {
            const result = await api.search(name);

            if (result.matches === 0) {
                await interaction.editReply(`Found no matches for "${name}"`);
                return;
            }

            const games = result.games;
            const singleResult = games.length === 1;

            let response = `**Found ${result.matches} matches for "${name}":**\n`;

            for (const game of games) {
                const version = game.version ?? 'unknown';
                const wordCount = game.english_word_count
                    ? `, ${game.english_word_count.toLocaleString()} words`
                    : '';
                const lastUpdated = game.published_at
                    ? `, updated <t:${Math.floor(game.published_at)}:R>`
                    : '';
                const gameUrl = extractUrl(game.url);
                const primaryUrl = game.primary_url
                    ? `\n<${game.primary_url}>`
                    : '';

                if (singleResult) {
                    response += `**${game.name}** (v${version}${wordCount}${lastUpdated})\n${gameUrl}${primaryUrl}\n\n`;
                } else {
                    response += `**${game.name}** (v${version}${wordCount}${lastUpdated})\n<${gameUrl}>${primaryUrl}\n\n`;
                }
            }

            if (games.length >= 10 && result.search_url) {
                response += `[View all results](${result.search_url})`;
            }

            if (response.length > 2000) {
                response = response.slice(0, 1950) + `\n\n… results truncated`;
                if (result.search_url) {
                    response += ` — [view all](${result.search_url})`;
                }
            }

            console.log(`[Search] Response length: ${response.length} chars`);
            await interaction.editReply(response);
        } catch (error) {
            console.error(`[Search] API error:`, error);
            await interaction.editReply(
                `An unexpected error occurred while searching for "${name}"`
            );
        }
    },
};
