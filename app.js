if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const createItems = require('./config/createItems')
const readItems = require('./config/readItems')
const updateItems = require('./config/updateItems')
const deleteItems = require('./config/deleteItems')

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
  }
})

client.on('messageCreate', async message => {
  if (!message.content.startsWith('!')) return
  try {
    // timer
    if (message.channelId === process.env.TIMER_CHANNEL_ID) {
      if (message.content === '!timer') {
        return message.reply('計時請輸入 !timer [分鐘數]')
      }
      const order = message.content.split(' ')
      if (order[0] === '!timer' && order.length === 2 &&
        Number(order[1])) {
        const time = Number(order[1])
        const millisecond = time * 60000
        message.reply(`開始計時 ${time} 分鐘`)
        return setTimeout(() => message.reply('時間到！'), millisecond)
      }
      return
    }

    // Martingale Strategy
    if (message.channelId === process.env.WAGER_CHANNEL_ID) {
      let wager = 0
      const discordUserId = message.author.id
      const user = await readItems(discordUserId)
      if (user.Item) {
        wager = user.Item.Wager
      }

      if (message.content === '!win') {
        if (wager === 0) return message.reply('還沒下注喔～')
        const initialWager = user.Item.InitialWager
        await deleteItems(discordUserId)
        return message.reply(`恭喜獲利 ${initialWager}！`)
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
        return message.reply(`下注 ${wager}`)
      }
      return
    }
  } catch (err) {
    console.warn(err)
  }
})

client.login(token)
