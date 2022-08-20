if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const createItems = require('./config/createItems')
const readItems = require('./config/readItems')
const updateItems = require('./config/updateItems')

const { Client, GatewayIntentBits } = require('discord.js')
const token = process.env.BOT_TOKEN
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

client.once('ready', () => {
  console.info('Ready!')
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return

  const { commandName } = interaction

  if (commandName === 'hi') {
    await interaction.reply(`hi～ ${interaction.user.username}`)
  } else if (commandName === 'wager') {
    await interaction.reply('下注請輸入 !wager [籌碼數]')
  }
})

client.on('messageCreate', async message => {
  if (!message.content.startsWith('!')) return

  // Martingale Strategy
  try {
    let wager = 0
    const discordUserId = message.author.id
    const user = await readItems(discordUserId)
    if (user.length !== 0) {
      wager = user.Item.Wager
    }

    if (message.content === '!win') {
      if (wager === 0) return message.reply('還沒下注喔～')
      wager = 0
      await updateItems(discordUserId, wager)
      return message.reply('恭喜獲利！')
    }

    if (message.content === '!draw') {
      if (wager === 0) return message.reply('還沒下注喔～')
      return message.reply(`再接再厲！籌碼：${wager}`)
    }

    if (message.content === '!lose') {
      if (wager === 0) return message.reply('還沒下注喔～')
      wager = wager * 2
      await updateItems(discordUserId, wager)
      return message.reply(`籌碼加倍：${wager}`)
    }

    if (message.content === '!wager') {
      if (wager === 0) return message.reply('還沒下注喔～')
      return message.reply(`目前下注：${wager}`)
    }
    const order = message.content.split(' ')
    if (order[0] === '!wager' && order.length === 2 &&
      Number(order[1])) {
      wager = Number(order[1])
      await createItems(discordUserId, wager)
      message.reply(`下注 ${wager}`)
    }
  } catch (err) {
    console.warn(err)
  }
})

client.login(token)
