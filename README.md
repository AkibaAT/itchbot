# FVN.li Discord Bot

## What does it do?

This project serves as a Discord bot interface for visual novel metadata that is indexed and stored by a separate Laravel application. The bot provides notifications about visual novel updates to Discord users.

The project works in conjunction with [FVN.li](https://github.com/AkibaAT/fvn.li), a Laravel application that handles the actual indexing, metadata processing, and database management.

### Current Functionality:

The Discord bot offers several commands:

* `/subscribe` - Subscribe to receive private messages whenever an update has been found
* `/unsubscribe` - Unsubscribe from the private message
* `/refresh` - Refresh metadata for a specific game
* `/search` - Search for a particular pattern, and return all matches with update information

The bot periodically checks for updates and notifies subscribed users about new game versions.

## How Do I Run It?

### Option 1: Docker (Recommended)

A Docker setup for the project can be found at https://github.com/AkibaAT/fvn.li-docker  
Follow the README in the Docker project for setup instructions. This is the recommended way to run the bot as it handles all dependencies and environment setup automatically.

### Option 2: Self-managed

#### Prerequisites:
* Unix-like system
* Python 3.13
* Discord bot application with Message Content Intent enabled
* Access to the [FVN.li](https://github.com/AkibaAT/fvn.li) API

#### Environment Variables:
The following environment variables must be set before starting the application:

**FVN.li API Configuration:**
* `API_URL` - URL of the FVN.li API
* `API_KEY` - Your API key for accessing the FVN.li API

**Discord Configuration:**
* `DISCORD_API_KEY` - Bot token from Discord Developer Portal
* `DISCORD_ADMIN_ID` - Discord user ID for the admin
* `DISCORD_NOTIFICATIONS_CHANNEL_ID` - Channel ID for notifications

#### Installation and Setup:
```bash
# Clone the repository
git clone https://github.com/AkibaAT/fvn.li-discord-bot.git
cd fvn.li-discord-bot

# Create and activate virtual environment
python3 -m pip install --user virtualenv
python3 -m venv venv
source venv/bin/activate

# Install dependencies
python3 -m pip install -r requirements.txt

# Start the Discord bot
python3 main.py
```

## Related Projects

This bot works in conjunction with:

* [FVN.li](https://github.com/AkibaAT/fvn.li) - A Laravel application that handles the indexing and metadata processing
* [FVN.li-docker](https://github.com/AkibaAT/fvn.li-docker) - Docker setup for this project
