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

// Array of 5 curated positive news RSS sources
const RSS_FEEDS = [
  { name: 'Good News Network', url: 'https://www.goodnewsnetwork.org/feed/' },
  { name: 'Positive News UK', url: 'https://www.positive.news/feed/' },
  { name: 'The Optimist Daily', url: 'https://www.optimistdaily.com/feed/' },
  { name: 'Sunny Skyz', url: 'https://www.sunnyskyz.com/rss.xml' },
  { name: 'Good News Shared', url: 'https://goodnews-shared.com/feed/' }
];

// Load local channels configuration safely
let channelsData = { guilds: {}, feedQueue: [] };
if (fs.existsSync('channels.json')) {
  try {
    const raw = JSON.parse(fs.readFileSync('channels.json', 'utf8'));
    if (raw.guilds) channelsData.guilds = raw.guilds;
    if (Array.isArray(raw.feedQueue)) channelsData.feedQueue = raw.feedQueue;
  } catch (e) {
    console.error("Error reading channels.json:", e);
  }
}

function saveState() {
  fs.writeFileSync('channels.json', JSON.stringify(channelsData, null, 2));
}

// Fisher-Yates shuffle helper
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Get next RSS feed ensuring no repeats within a 5-day cycle
function getNextFeed() {
  if (!channelsData.feedQueue || channelsData.feedQueue.length === 0) {
    console.log('🔄 Replenishing and shuffling RSS feed queue...');
    channelsData.feedQueue = shuffleArray(RSS_FEEDS);
  }

  const selectedFeed = channelsData.feedQueue.shift();
  saveState();
  return selectedFeed;
}

// Ensure guild registration & channel persistence
function setGuildNewsChannel(guildId, channelId) {
  if (!channelsData.guilds) channelsData.guilds = {};
  channelsData.guilds[guildId] = { newsChannelId: channelId };
  saveState();
}

// Fetch and dispatch daily good news article across registered servers with fallback
async function dispatchDailyNews() {
  const targetGuildIds = Object.keys(channelsData.guilds).filter(id => channelsData.guilds[id]?.newsChannelId);
  if (targetGuildIds.length === 0) {
    console.log('No servers registered for Good News dispatch.');
    return;
  }

  let article = null;
  let currentFeed = null;
  let attempts = 0;
  const maxAttempts = RSS_FEEDS.length;

  // Try feeds sequentially until one succeeds or we exhaust the list
  while (attempts < maxAttempts && !article) {
    currentFeed = getNextFeed();
    attempts++;
    console.log(`📰 Trying article pull from (${attempts}/${maxAttempts}): ${currentFeed.name} (${currentFeed.url})`);

    try {
      const feed = await parser.parseURL(currentFeed.url);
      if (feed && feed.items && feed.items.length > 0) {
        article = feed.items[0];
      } else {
        console.warn(`⚠️ Feed ${currentFeed.name} returned 0 items. Trying next...`);
      }
    } catch (err) {
      console.error(`❌ Failed to fetch feed ${currentFeed.name} (${err.message}). Trying next...`);
    }
  }

  if (!article) {
    console.error('❌ All RSS feeds failed today. Could not dispatch news.');
    return;
  }

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
    .setURL(article.link || currentFeed.url)
    .setDescription(article.contentSnippet ? article.contentSnippet.slice(0, 300) + '...' : 'Click the title to read full story!')
    .setColor('#00FF7F')
    .setTimestamp(article.pubDate ? new Date(article.pubDate) : new Date())
    .setFooter({ text: `Source: ${currentFeed.name} • Good News Co.` });

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  for (const guildId of targetGuildIds) {
    const channelId = channelsData.guilds[guildId].newsChannelId;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        console.warn(`⚠️ Channel ${channelId} in guild ${guildId} unreachable. Removing from channels.json.`);
        delete channelsData.guilds[guildId];
        saveState();
        continue;
      }

      await channel.send({
        content: "Here's the good news",
        embeds: [embed]
      });
    } catch (err) {
      console.error(`Failed to send news to guild ${guildId}:`, err);
    }
  }
}

// Define Slash Commands (Only set-news-channel registered)
const commands = [
  new SlashCommandBuilder()
    .setName('set-news-channel')
    .setDescription('Set the channel where daily uplifting news will be posted!')
];

client.once('clientReady', async () => {
  console.log(`Good News Co. is online as ${client.user.tag}!`);

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
    await dispatchDailyNews();
  }, {
    scheduled: true,
    timezone: "America/Chicago"
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // --- /set-news-channel ---
  if (interaction.commandName === 'set-news-channel') {
    setGuildNewsChannel(interaction.guildId, interaction.channelId);

    await interaction.reply({
      content: `✅ Success! Daily uplifting news will now be delivered to <#${interaction.channelId}> every day at 12:00 PM Central!`,
      flags: 64
    });
  }
});

// Auto-clean channels.json if bot gets kicked or leaves a server
client.on('guildDelete', (guild) => {
  if (channelsData.guilds && channelsData.guilds[guild.id]) {
    delete channelsData.guilds[guild.id];
    saveState();
    console.log(`🗑️ Removed guild ${guild.id} from channels.json after bot left/kicked.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
