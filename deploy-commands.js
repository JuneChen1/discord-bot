require('dotenv').config()

const { SlashCommandBuilder, Routes } = require('discord.js')
const { REST } = require('@discordjs/rest')
const clientId = process.env.CLIENT_ID
const guildId = process.env.SERVER_ID
const token = process.env.BOT_TOKEN

const commands = [
  new SlashCommandBuilder().setName('hi').setDescription('打個招呼吧'),
  new SlashCommandBuilder().setName('wager').setDescription('開始下注')
]
  .map(command => command.toJSON())

const rest = new REST({ version: '10' }).setToken(token)

rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
  .then(() => console.info('Successfully registered application commands.'))
  .catch(console.error)
