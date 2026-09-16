import { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  EmbedBuilder 
} from 'discord.js';
import Parser from 'rss-parser';
import cron from 'node-cron';
import fs from 'fs';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// Keep-alive HTTP server for Render Free Tier
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Good News Co. is running 24/7!\n');
}).listen(port, () => {
  console.log(`🌐 Web server listening on port ${port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

const parser = new Parser();

// Primary RSS Feed Source (Good News Network)
const RSS_FEED_URL = 'https://www.goodnewsnetwork.org/feed/';

// Load local state configuration safely
let state = { guilds: {} };
if (fs.existsSync('state.json')) {
  try {
    const raw = JSON.parse(fs.readFileSync('state.json', 'utf8'));
    if (raw.guilds) state = raw;
  } catch (e) {
    console.error("Error reading state.json:", e);
  }
}

function saveState() {
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
}

// Ensure guild registration & channel persistence
function setGuildNewsChannel(guildId, channelId) {
  if (!state.guilds) state.guilds = {};
  state.guilds[guildId] = { newsChannelId: channelId };
  saveState();
}

// Fetch and dispatch daily good news article for a specific guild
async function sendDailyNewsForGuild(guildId) {
  const guildData = state.guilds[guildId];
  if (!guildData || !guildData.newsChannelId) {
    console.log(`Skipping Good News dispatch for Guild ${guildId}: No news channel configured.`);
    return;
  }

  try {
    const channel = await client.channels.fetch(guildData.newsChannelId).catch(() => null);
    if (!channel) {
      console.log(`Skipping Good News dispatch for Guild ${guildId}: Channel ${guildData.newsChannelId} not found.`);
      return;
    }

    // Fetch and parse RSS feed
    const feed = await parser.parseURL(RSS_FEED_URL);
    if (!feed || !feed.items || feed.items.length === 0) {
      console.log('No articles found in RSS feed.');
      return;
    }

    // Select top latest article
    const article = feed.items[0];

    // Extract image thumbnail from content if available
    let imageUrl = null;
    if (article['media:content'] && article['media:content'].$.url) {
      imageUrl = article['media:content'].$.url;
    } else if (article.content) {
      const imgMatch = article.content.match(/<img[^>]+src="([^">]+)"/);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    const embed = new EmbedBuilder()
      .setTitle(`📰 ${article.title || 'Uplifting News of the Day!'}`)
      .setURL(article.link || RSS_FEED_URL)
      .setDescription(article.contentSnippet ? article.contentSnippet.slice(0, 300) + '...' : 'Click the title to read full story!')
      .setColor('#00FF7F')
      .setTimestamp(article.pubDate ? new Date(article.pubDate) : new Date())
      .setFooter({ text: 'Good News Co. • Giving you the good news' });

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    await channel.send({
      content: '☀️ **Here is the good news!**',
      embeds: [embed]
    }).catch(err => console.error(`Failed to send news article to guild ${guildId}:`, err));

  } catch (err) {
    console.error(`Error processing RSS feed for guild ${guildId}:`, err);
  }
}

// Define Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('set-news-channel')
    .setDescription('Set the channel where daily uplifting news will be posted!'),
  new SlashCommandBuilder()
    .setName('test-news')
    .setDescription('Force trigger the daily news dispatch across all registered servers!')
];

client.once('clientReady', async () => {
  console.log(`☀️ Good News Co. is online as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Successfully registered slash commands globally!');
  } catch (err) {
    console.error('Error registering slash commands:', err);
  }

  // Cron schedule for 12:00 PM Central Time
  cron.schedule('0 12 * * *', async () => {
    console.log('⏰ Running 12 PM Central Good News Dispatch across all servers...');
    for (const guildId of Object.keys(state.guilds)) {
      await sendDailyNewsForGuild(guildId);
    }
  }, {
    scheduled: true,
    timezone: "America/Chicago"
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;

  // --- /set-news-channel ---
  if (interaction.commandName === 'set-news-channel') {
    setGuildNewsChannel(guildId, interaction.channelId);

    await interaction.reply({
      content: `✅ Success! Daily uplifting news will now be delivered to <#${interaction.channelId}> every day at 12:00 PM Central!`,
      flags: 64
    });
  }

  // --- /test-news ---
  if (interaction.commandName === 'test-news') {
    await interaction.reply({
      content: '⚡ Fetching latest positive news and dispatching across registered servers...',
      flags: 64
    });

    for (const id of Object.keys(state.guilds)) {
      await sendDailyNewsForGuild(id);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
