# FVN.li Discord Bot

## What does it do?

This project serves as a Discord bot interface for visual novel metadata that is indexed and stored by a separate Laravel application. The bot provides notifications about visual novel updates to Discord users.

The project works in conjunction with [FVN.li](https://github.com/AkibaAT/fvn.li), a Laravel application that handles the actual indexing, metadata processing, and database management.

### Current Functionality:

* `/search` - Search for visual novels by name, returns matches with version, word count, last updated, and links

The bot periodically polls the API for updates and notifies subscribed users.

## How Do I Run It?

### Option 1: Docker (Recommended)

```bash
docker compose up -d
```

### Option 2: Self-managed

#### Prerequisites:
* Bun 1.0 or later
* Discord bot application with Message Content Intent enabled
* Access to the [FVN.li](https://github.com/AkibaAT/fvn.li) API

#### Environment Variables:
The following environment variables must be set before starting the application:

**FVN.li API Configuration:**
* `LARAVEL_API_URL` - URL of the FVN.li API
* `LARAVEL_API_TOKEN` - Your API token for accessing the FVN.li API

**Discord Configuration:**
* `DISCORD_API_KEY` - Bot token from Discord Developer Portal
* `DISCORD_ADMIN_ID` - Discord user ID that receives the simple feed of every watched game update, addition request, and review report
* `DISCORD_ADMIN_NOTIFICATIONS_CHANNEL_ID` - Optional channel ID that mirrors the admin update feed

**Optional development mode:**
* `DISCORD_DEV_MODE` - Set to `true` to restrict Discord deliveries
* `DISCORD_DEV_USER_IDS` - Comma-separated Discord user IDs allowed to receive DMs in development mode
* `DISCORD_DEV_GUILD_IDS` - Comma-separated Discord guild IDs allowed to receive channel messages in development mode

In development mode, queued notifications for users outside the allowlist are reported to the API as successfully processed without contacting Discord. Addition-request and review-report notifications are likewise consumed without delivery when the configured admin is not allowlisted. Production delivery behavior is unchanged when `DISCORD_DEV_MODE` is unset or false.

#### Installation and Setup:
```bash
# Clone the repository
git clone https://github.com/AkibaAT/fvn.li-discord-bot.git
cd fvn.li-discord-bot

# Install dependencies
bun install

# Start the Discord bot
bun run src/index.ts
```

## Project Structure

```
src/
├── index.ts              # Main entry point
├── config.ts             # Environment configuration
├── commands/
│   ├── index.ts          # Command registry
│   └── search.ts         # /search command
├── events/
│   └── handlers.ts       # Discord event handlers
└── services/
    ├── api.ts            # Laravel API client
    └── notifications.ts  # Notification polling service
```

## Adding New Commands

Create a new file in `src/commands/` following this pattern:

```typescript
import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './index.ts';

export const myCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Description here'),

  async execute(interaction: ChatInputCommandInteraction) {
    // Handle command
  },
};
```

Then register it in `src/events/handlers.ts`.

## Related Projects

This bot works in conjunction with:

* [FVN.li](https://github.com/AkibaAT/fvn.li) - A Laravel application that handles the indexing and metadata processing
