if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const { Client, GatewayIntentBits } = require('discord.js')
const token = process.env.BOT_TOKEN
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once('ready', () => {
  console.info('Ready!')
})

client.login(token)
