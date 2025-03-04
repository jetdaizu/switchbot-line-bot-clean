const express = require('express')
const bodyParser = require('body-parser')
const axios = require('axios')

const app = express()
app.use(bodyParser.json())

// ===== あなたの情報を設定（必ず新しいトークンを発行して置き換えてください） =====
const LINE_ACCESS_TOKEN = '+7L52SeF0516khcX8iF6Od9nyQRDumxddUNDtHQZ6kTGsy2J5XLnDPIaAVBcrNDblSBYOFDGEegaKoAaL9MO54Zz3s9PcBiCwrh26MzbpFwVzgrzV9qgbxR2AbmgCXbNqXWnUm5lYnW7/T1ojDdX3gdB04t89/1O/w1cDnyilFU='
const SWITCHBOT_TOKEN = 'febf9039bbd130fced0856e89d11d14de7bead2b60e15bc2fac3e7e17c94635c5acbbd2f59796d2ab65ff0de10ec31ca'
const DEVICE_ID = 'C13635300732' // 例: "0123456789ABCDEF"
// ==================================================================

// LINE Webhookエンドポイント
app.post('/webhook', async (req, res) => {
  const events = req.body.events

  for (const event of events) {
    if (event.message && event.message.type === 'text') {
      const userMessage = event.message.text

      // 「スイッチオン」と送信されたらSwitchBotをONにする
      if (userMessage === 'お風呂入れて') {
        try {
          await axios.post(
            `https://api.switch-bot.com/v1.0/devices/${DEVICE_ID}/commands`,
            {
              command: 'turnOn',
              parameter: 'default',
              commandType: 'command'
            },
            {
              headers: {
                'Content-Type': 'application/json; charset=utf8',
                'Authorization': SWITCHBOT_TOKEN
              }
            }
          )
          await replyMessage(event.replyToken, 'お湯張りを開始しました！')
        } catch (error) {
          console.error(error)
          await replyMessage(event.replyToken, 'エラーが発生しました。')
        }
      } else {
        await replyMessage(event.replyToken, '「お風呂入れて」と送ると起動します。')
      }
    }
  }

  res.sendStatus(200)
})

// LINEに返信する関数
function replyMessage(replyToken, text) {
  return axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      }
    }
  )
}

// サーバー起動
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})

