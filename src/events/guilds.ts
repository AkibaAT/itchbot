import type { Client, Guild } from "discord.js";
import { Events } from "discord.js";
import { api } from "../services/api.ts";

function apiChannels(guild: Guild) {
  return guild.channels.cache
    .filter((channel) => channel.isTextBased())
    .map((channel) => ({
      id: String(channel.id),
      name: channel.name,
      type: Number(channel.type),
      nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
    }));
}

export function registerGuildEvents(client: Client) {
  client.on(Events.GuildCreate, async (guild: Guild) => {
    console.log(`[GuildCreate] Bot joined guild: ${guild.name} (${guild.id})`);

    try {
      const channels = apiChannels(guild);

      await api.botJoined(String(guild.id), guild.name, channels, String(guild.ownerId));
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
      await api.botLeft(String(guild.id));
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

export async function reconcileCurrentGuilds(client: Client<true>) {
  const guilds = client.guilds.cache.map((guild) => ({
    discord_server_id: String(guild.id),
    discord_server_name: guild.name,
    owner_discord_id: String(guild.ownerId),
    channels: apiChannels(guild),
  }));

  await api.reconcileGuilds(guilds);
  console.log(`[Ready] Reconciled ${guilds.length} guild(s) with API`);
}

async function syncGuildChannels(guild: Guild) {
  try {
    const channels = apiChannels(guild);

    await api.syncChannels(String(guild.id), channels);
  } catch (error) {
    console.error(`[syncChannels] Failed for ${guild.id}:`, error);
  }
}
