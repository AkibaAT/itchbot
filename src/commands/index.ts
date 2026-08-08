import type {
    ChatInputCommandInteraction,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import {SlashCommandBuilder} from 'discord.js';

export type SlashCommand = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
    data: SlashCommand;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
