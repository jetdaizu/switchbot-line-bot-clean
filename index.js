const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ✅ `.env` は使わず、Railway の環境変数を直接使用
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN;
const DEVICE_ID = process.env.DEVICE_ID;

if (!SWITCHBOT_TOKEN || !LINE_ACCESS_TOKEN || !DEVICE_ID || !OPENAI_API_KEY) {
    console.error("🚨 ERROR: 必要な環境変数が設定されていません！");
    process.exit(1);
}

// LINE Webhookエンドポイント
app.post('/webhook', async (req, res) => {
    const events = req.body.events;

    for (const event of events) {
        if (event.message && event.message.type === 'text') {
            const userMessage = event.message.text;

            console.log(`📩 受信したメッセージ: ${userMessage}`);

            // 🔹 ChatGPT API を使ってメッセージを解析
            const shouldTurnOnBath = await analyzeMessageWithChatGPT(userMessage);

            if (shouldTurnOnBath) {
                try {
                    console.log(`🚀 Sending turnOn command to SwitchBot...`);
                    const response = await axios.post(
                        `https://api.switch-bot.com/v1.0/devices/${DEVICE_ID}/commands`,
                        {
                            command: 'turnOn',
                            parameter: 'default',
                            commandType: 'command'
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${SWITCHBOT_TOKEN}`
                            }
                        }
                    );
                    console.log("✅ SwitchBot API Response:", response.data);
                    await replyMessage(event.replyToken, 'お湯張りを開始しました！');
                } catch (error) {
                    console.error("🚨 SwitchBot API Error:", error.response ? error.response.data : error.message);
                    await replyMessage(event.replyToken, 'エラーが発生しました。');
                }
            } else {
                await replyMessage(event.replyToken, '「お風呂を準備して」「お風呂を入れて」などと送ると起動します。');
            }
        }
    }

    res.sendStatus(200);
})

// 🔹 ChatGPT API を使ってメッセージを解析
async function analyzeMessageWithChatGPT(userMessage) {
    try {
        console.log(`🤖 ChatGPT にリクエスト: ${userMessage}`);
        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "あなたは家庭用スマートホームアシスタントです。ユーザーのメッセージを解析し、お風呂を準備する指示かどうかを判定してください。\ 例えば、「お風呂を入れて」「お湯を張って」ならお風呂を準備するべきです。\ しかし、「トイレの準備をして」「洗面所を掃除して」はお風呂とは関係ありません。\ 回答は「お風呂を準備するべきです」または「お風呂を準備する必要はありません」のどちらかのみで答えてください。" },
                    { role: "user", content: userMessage }
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${OPENAI_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        if (!response.data.choices || !response.data.choices[0] || !response.data.choices[0].message) {
            console.error("🚨 ChatGPT API のレスポンスが無効です。");
            return false;
        }

        const aiResponse = response.data.choices[0].message.content;
        console.log(`🤖 ChatGPT Response: ${aiResponse}`);

        return aiResponse.includes("お風呂を準備するべきです");
    } catch (error) {
        console.error("🚨 ChatGPT API Error:", error.response ? error.response.data : error.message);
        return false; // エラーが出た場合は何もしない
    }
}

// LINEに返信する関数
async function replyMessage(replyToken, text) {
    try {
        const response = await axios.post(
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
        );
        console.log("✅ LINEに返信成功");
    } catch (error) {
        console.error("🚨 LINE API Error:", error.response ? error.response.data : error.message);
    }
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
