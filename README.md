# Discord Bot
使用 AWS DynamoDB 儲存資料的 Discord 機器人。

### .env 內容
1. BOT_TOKEN  
[Applitions](https://discord.com/developers/applications) -> Bot -> TOKEN

2. CLIENT_ID  
[Applitions](https://discord.com/developers/applications) -> OAuth2 -> CLIENT ID

3. SERVER_ID  
Discord -> 使用者設定 -> 進階 -> 打開開發者模式  
伺服器 -> 右鍵點擊名稱 -> 複製ID

4. ACCESS_KEY_ID & SECRET_ACCESS_KEY  
登入 AWS -> 點擊名稱(畫面右上角) -> Security credentials -> Access keys

## 環境建置
+ node.js 16.17.0
+ discord.js 14.2.0
+ @discordjs/rest 1.0.1
+ dotenv 16.0.1
+ aws-sdk 2.1199.0
