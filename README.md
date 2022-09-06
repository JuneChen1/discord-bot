# Discord Bot
Discord 機器人，使用 AWS DynamoDB 並部署至 EC2。 

## 功能
+ 計時器
+ 籌碼下注紀錄 

[全部指令](https://hackmd.io/@RG9cKZ2IS4C8Z69gXipgAA/rkv2nNDyj)

## 說明
因為加入的一個 Discord 群組有擲骰子遊戲，想到之前聽過的 Martingale Strategy，就決定寫一個 bot 來設定下注的籌碼。

### 什麼是 Martingale Strategy?
假設第一次下注10個籌碼，如果輸了下次就將籌碼加倍到20，再下一次變成40，一直加倍到贏了為止，在籌碼足夠的情況下，就能保證一定會獲利10個籌碼。  (現實中不推薦這麼做！因為錢不是無限的:neutral_face:)
  
![IMG_0440_1](https://user-images.githubusercontent.com/103798145/185778920-ae3cdd79-221e-470b-902f-c64c9575f214.jpg)


## 安裝流程
1. 請確認有安裝 Node.js 與 npm
2. 將專案 clone 到本地
```
git clone https://github.com/JuneChen1/discord-bot.git
```
3. 進入專案資料夾
```
cd discord
```
4. 安裝套件
```
npm install
```
#### .env 內容
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

## 筆記
[AWS EC2 部署](https://medium.com/@juneee/%E7%AD%86%E8%A8%98-discord-bot-%E9%83%A8%E7%BD%B2%E8%87%B3-aws-ec2-f51eb238e2f5)  
[AWS DynamoDB](https://medium.com/@juneee/node-js-%E6%93%8D%E4%BD%9C-aws-dynamodb-2a74de8deb4d)
