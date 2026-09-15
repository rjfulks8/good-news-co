import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import cron from 'node-cron';
import Parser from 'rss-parser';
import dotenv from 'dotenv';
import http from 'http';
import fs from 'fs';

dotenv.config();

// HTTP Server for Render free tier keep-alive
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Good News Co. is running 24/7!\n');
}).listen(port, () => {
  console.log(`🌐 Web server listening on port ${port}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const parser = new Parser();
const DB_FILE = './channels.json';

function getSavedChannels() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveChannel(guildId, channelId) {
  const data = getSavedChannels();
  data[guildId] = channelId;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const FEEDS = [
  'https://www.goodnewsnetwork.org/feed/',
  'https://www.positivenews.org.uk/feed/'
];

async function fetchAndSendGoodNews(channel) {
  try {
    const randomFeedUrl = FEEDS[Math.floor(Math.random() * FEEDS.length)];
    const feed = await parser.parseURL(randomFeedUrl);

    if (!feed.items || feed.items.length === 0) return;

    const article = feed.items[Math.floor(Math.random() * feed.items.length)];
    const rawSummary = article.contentSnippet || article.snippet || article.summary || '';
    const cleanSummary = rawSummary.replace(/<[^>]*>?/gm, '').slice(0, 300) + '...';
    const imageUrl = article.enclosure?.url || null;

    const newsEmbed = new EmbedBuilder()
      .setTitle(`☀️ ${article.title}`)
      .setURL(article.link)
      .setDescription(cleanSummary)
      .setColor('#00FF7F')
      .setFooter({ text: `Source: ${feed.title || 'Good News Network'}` })
      .setTimestamp();

    if (imageUrl) {
      newsEmbed.setImage(imageUrl);
    }

    await channel.send({
      content: '📰 **In Todays News!**',
      embeds: [newsEmbed]
    });
  } catch (error) {
    console.error('Error fetching good news article:', error);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('set-news-channel')
    .setDescription('Set the channel where daily good news dispatches will be posted.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName('goodnews')
    .setDescription('Fetch a random good news article on demand!')
];

client.once('ready', async () => {
  console.log(`☀️ Good News Co. is online as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Global slash commands registered.');
  } catch (err) {
    console.error('Error registering slash commands:', err);
  }

  // 12:00 PM Daily Cron Job across all configured servers
  cron.schedule('0 12 * * *', async () => {
    console.log('⏰ Triggering 12 PM news dispatch across all servers...');
    const channelMap = getSavedChannels();

    for (const [guildId, channelId] of Object.entries(channelMap)) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel) await fetchAndSendGoodNews(channel);
      } catch (err) {
        console.error(`Failed to post to Guild ${guildId} / Channel ${channelId}:`, err);
      }
    }
  });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'set-news-channel') {
    saveChannel(interaction.guildId, interaction.channelId);
    await interaction.reply({
      content: `☀️ Success! <#${interaction.channelId}> is now set to receive daily good news at 12:00 PM.`,
      ephemeral: true
    });
  }

  if (interaction.commandName === 'goodnews') {
    await interaction.deferReply();
    await fetchAndSendGoodNews(interaction.channel);
    await interaction.deleteReply();
  }
});

client.login(process.env.DISCORD_TOKEN);