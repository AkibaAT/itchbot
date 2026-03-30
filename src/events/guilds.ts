import type { Client, Guild } from "discord.js";
import { Events } from "discord.js";
import { api } from "../services/api.ts";

export function registerGuildEvents(client: Client) {
  client.on(Events.GuildCreate, async (guild: Guild) => {
    console.log(`[GuildCreate] Bot joined guild: ${guild.name} (${guild.id})`);

    try {
      const channels = guild.channels.cache
        .filter((ch) => ch.isTextBased())
        .map((ch) => ({
          id: ch.id,
          name: (ch as any).name ?? ch.id,
          type: ch.type,
        }));

      await api.botJoined(guild.id, guild.name, channels);
      console.log(
        `[GuildCreate] Registered with API. ${channels.length} channels synced.`,
      );
    } catch (error) {
      console.error(`[GuildCreate] Failed to register:`, error);
    }
  });

  client.on(Events.GuildDelete, async (guild: Guild) => {
    console.log(`[GuildDelete] Bot left guild: ${guild.name} (${guild.id})`);

    try {
      await api.botLeft(guild.id);
      console.log(`[GuildDelete] Marked as inactive in API`);
    } catch (error) {
      console.error(`[GuildDelete] Failed to notify API:`, error);
    }
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    await syncGuildChannels(channel.guild);
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    await syncGuildChannels(channel.guild);
  });

  client.on(Events.ChannelUpdate, async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    await syncGuildChannels(channel.guild);
  });
}

async function syncGuildChannels(guild: Guild) {
  try {
    const channels = guild.channels.cache
      .filter((ch) => ch.isTextBased())
      .map((ch) => ({
        id: ch.id,
        name: (ch as any).name ?? ch.id,
        type: ch.type,
      }));

    await api.syncChannels(guild.id, channels);
  } catch (error) {
    console.error(`[syncChannels] Failed for ${guild.id}:`, error);
  }
}
