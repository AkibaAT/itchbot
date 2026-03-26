import type {Client} from 'discord.js';
import {Events} from 'discord.js';
import {searchCommand} from '../commands/search.ts';
import type {Command} from '../commands';

const commands: Command[] = [searchCommand];

export function registerEvents(client: Client) {
    client.on(Events.ClientReady, (client: Client<true>) => {
        console.log(`Bot is ready (${client.user?.tag})`);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = commands.find(
            (cmd) => cmd.data.name === interaction.commandName
        );

        if (!command) {
            console.warn(`No command found for: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing command ${interaction.commandName}:`, error);
            if (interaction.deferred) {
                await interaction.editReply('An unexpected error occurred');
            }
        }
    });
}

export async function registerCommands(client: Client) {
    const body = commands.map((cmd) => cmd.data.toJSON());
    await client.rest.put(
        `/applications/${client.application?.id}/commands`,
        {body}
    );
    console.log(`Registered ${commands.length} command(s)`);
}