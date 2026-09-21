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

// Load local state configuration safely
let state = { guilds: {}, feedQueue: [] };
if (fs.existsSync('state.json')) {
  try {
    const raw = JSON.parse(fs.readFileSync('state.json', 'utf8'));
    if (raw.guilds) state.guilds = raw.guilds;
    if (Array.isArray(raw.feedQueue)) state.feedQueue = raw.feedQueue;
  } catch (e) {
    console.error("Error reading state.json:", e);
  }
}

function saveState() {
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
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
  if (!state.feedQueue || state.feedQueue.length === 0) {
    console.log('🔄 Replenishing and shuffling RSS feed queue...');
    state.feedQueue = shuffleArray(RSS_FEEDS);
  }

  const selectedFeed = state.feedQueue.shift();
  saveState();
  return selectedFeed;
}

// Ensure guild registration & channel persistence
function setGuildNewsChannel(guildId, channelId) {
  if (!state.guilds) state.guilds = {};
  state.guilds[guildId] = { newsChannelId: channelId };
  saveState();
}

// Fetch and dispatch daily good news article across registered servers
async function dispatchDailyNews() {
  const targetGuildIds = Object.keys(state.guilds).filter(id => state.guilds[id]?.newsChannelId);
  if (targetGuildIds.length === 0) {
    console.log('No servers registered for Good News dispatch.');
    return;
  }

  const currentFeed = getNextFeed();
  console.log(`📰 Pulling daily article from: ${currentFeed.name} (${currentFeed.url})`);

  try {
    const feed = await parser.parseURL(currentFeed.url);
    if (!feed || !feed.items || feed.items.length === 0) {
      console.log(`No articles found in RSS feed for ${currentFeed.name}.`);
      return;
    }

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
      .setTitle(`📰 ${article.title || 'News of the Day!'}`)
      .setURL(article.link || currentFeed.url)
      .setDescription(article.contentSnippet ? article.contentSnippet.slice(0, 300) + '...' : 'Click the title to read full story!')
      .setColor('#00FF7F')
      .setTimestamp(article.pubDate ? new Date(article.pubDate) : new Date())
      .setFooter({ text: `Source: ${currentFeed.name} • Good News Co.` });

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    for (const guildId of targetGuildIds) {
      const channelId = state.guilds[guildId].newsChannelId;
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
          await channel.send({
            content: '☀️ **Here is the good news**',
            embeds: [embed]
          });
        }
      } catch (err) {
        console.error(`Failed to send news to guild ${guildId}:`, err);
      }
    }

  } catch (err) {
    console.error(`Error processing RSS feed for ${currentFeed.name}:`, err);
  }
}

// Define Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('set-news-channel')
    .setDescription('Set the channel where daily uplifting news will be posted!')
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
    await dispatchDailyNews();
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
});

client.login(process.env.DISCORD_TOKEN);
