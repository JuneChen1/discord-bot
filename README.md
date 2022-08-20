# Discord Bot
使用 AWS DynamoDB 儲存資料的 Discord 機器人。 

## 說明
因為加入的一個 Discord 群組有擲骰子遊戲，想到之前聽過的 Martingale Strategy，就決定寫一個 bot 來設定下注的籌碼。

### 什麼是 Martingale Strategy?
假設第一次下注10個籌碼，如果輸了下次就將籌碼加倍到20，再下一次變成40，一直加倍到贏了為止，在籌碼足夠的情況下，  
就能保證一定會獲利10個籌碼。  (現實中不推薦這麼做！因為錢不是無限的:neutral_face:)
  
![IMG_0439_1](https://user-images.githubusercontent.com/103798145/185736750-1a9d396d-10b8-4b76-94bf-69d942de9f96.jpg)

## .env 內容
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
