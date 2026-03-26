import type {
    ChatInputCommandInteraction,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandBuilder
} from 'discord.js';
import {SlashCommandBuilder} from 'discord.js';

export type SlashCommand = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandBuilder;

export interface Command {
    data: SlashCommand;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}