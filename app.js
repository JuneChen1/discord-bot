if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

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

let wager = 0

client.on('messageCreate', message => {
  if (!message.content.startsWith('!')) return

  const discordUserId = message.author.id

  if (message.content === '!win') {
    if (wager === 0) return message.reply('還沒下注喔～')
    wager = 0
    return message.reply('恭喜獲利！')
  }

  if (message.content === '!draw') {
    return message.reply(`再接再厲！籌碼：${wager}`)
  }

  if (message.content === '!lose') {
    if (wager === 0) return message.reply('還沒下注喔～')
    wager = wager * 2
    return message.reply(`籌碼加倍：${wager}`)
  }

  if (message.content === '!wager') {
    return message.reply('請輸入 !wager [籌碼數]')
  }
  const order = message.content.split(' ')
  if (order[0] === '!wager' && order.length === 2 &&
    Number(order[1])) {
    wager = Number(order[1])
    message.reply(`下注 ${order[1]}`)
  }
})

client.login(token)
