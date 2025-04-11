const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json());

// ✅ MongoDB 接続
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB に接続成功！"))
    .catch(err => console.error("🚨 MongoDB 接続エラー:", err));

// ✅ 環境変数
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// ✅ MongoDB スキーマ
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    switchbotToken: { type: String },
    devices: { type: Array, default: [] }
});

const User = mongoose.model("User", userSchema);
const userRegistrationState = new Map();

// ✅ ユーザーのデバイス一覧をSwitchBot APIから取得
async function fetchSwitchBotDevices(switchbotToken) {
    try {
        const response = await axios.get(
            'https://api.switch-bot.com/v1.0/devices',
            {
                headers: {
                    'Authorization': `Bearer ${switchbotToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data.body.deviceList || [];
    } catch (error) {
        console.error("🚨 SwitchBot API Error (Device Fetch):", error.response ? error.response.data : error.message);
        return [];
    }
}

// ✅ ChatGPT にメッセージを送る関数
async function analyzeMessageWithChatGPT(userMessage, userDevices) {
    try {
        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                max_tokens: 1000,
                temperature: 0.3,
                messages: [
                    { role: "system", content: `あなたはスマートホームアシスタントです。\
ユーザーの家には次のデバイスがあります: ${JSON.stringify(userDevices.map(d => d.deviceName)) || "不明"}。\
ユーザーのメッセージが「家電の操作」か「スマートホームの質問」かを判定し、\
JSON 形式で返答してください。\
- 「家電の操作」なら \`{ "type": "device_control", "commands": [{ "device": "<適切なデバイス名>", "action": "turnOn" }] }\`\
- 「スマートホームの質問」なら \`{ "type": "smart_home_help", "answer": "<詳細な説明を含めた回答>" }\`\
- 🔹 回答が途中で切れないように、全文を出力してください\
- 🔹 「...」や「以下の手順を参照してください」は使わず、具体的に答えてください\
- 何も対応しない場合は \`{ "type": "none" }\` を返してください。` },
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

        return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
        console.error("🚨 ChatGPT API Error:", error.response ? error.response.data : error.message);
        return { type: "none" };
    }
}

// ✅ LINEに返信
async function replyMessage(replyToken, text) {
    try {
        await axios.post(
            'https://api.line.me/v2/bot/message/reply',
            {
                replyToken: replyToken,
                messages: [{ type: 'text', text }]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
                }
            }
        );
    } catch (error) {
        console.error("🚨 LINE API Error:", error.response ? error.response.data : error.message);
    }
}

// ✅ LINEにプッシュメッセージ（友達追加時など）
async function pushMessage(userId, text) {
    try {
        await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
                to: userId,
                messages: [{ type: 'text', text }]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
                }
            }
        );
    } catch (error) {
        console.error("🚨 LINE Push API Error:", error.response ? error.response.data : error.message);
    }
}

// ✅ Webhookエンドポイント
app.post('/webhook', async (req, res) => {
    const events = req.body.events;

    for (const event of events) {
        if (event.type === "follow") {
            const userId = event.source.userId;
            await pushMessage(userId,
                "こんにちは！このLINE Botでは、スマートホームに関する質問をすることができます。\n\n"
                + "❓ **スマートホームの質問をしたい場合** → そのまま質問内容を送信してください！（例：「SwitchBotのペアリング方法は？」）\n\n"
                + "⚠️ ご利用にあたって\n"
                + "このチャットボットの回答はAIによる自動応答のため、内容に誤りを含む可能性があります。正確な情報は、製品の公式FAQや取扱説明書をご確認ください。\n\n"
                + "🔗 SwitchBot公式サポート：https://support.switch-bot.com/\n"
                + "🔗 Amazon Alexaヘルプ：https://www.amazon.co.jp/alexasupport\n\n"
                + "※スマートホーム関連以外のご質問は回答が無い仕様になっております。"
            );
            continue;
        }

        if (event.message && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            if (userMessage === "登録") {
                userRegistrationState.set(userId, true);
                await replyMessage(event.replyToken, "🔑 SwitchBot APIキーを送信してください。キャンセルしたい場合は「キャンセル」と送ってください。");
                continue;
            }

            if (userMessage === "キャンセル") {
                if (userRegistrationState.has(userId)) {
                    userRegistrationState.delete(userId);
                    await replyMessage(event.replyToken, "🔹 APIキーの登録をキャンセルしました。質問したい場合はそのまま送ってください。");
                } else {
                    await replyMessage(event.replyToken, "🔹 現在、APIキー登録待ちではありません。質問があればそのまま送ってください。");
                }
                continue;
            }

            if (userRegistrationState.get(userId)) {
                const switchbotToken = userMessage.trim();

                if (switchbotToken.length <= 60 || !/^[A-Za-z0-9]+$/.test(switchbotToken)) {
                    await replyMessage(event.replyToken, "⚠️ 無効なAPIキーです。60文字以上・半角英数字である必要があります。\n\n登録をやめる場合は「キャンセル」と送信してください。");
                    continue;
                }

                try {
                    const devices = await fetchSwitchBotDevices(switchbotToken);
                    await User.findOneAndUpdate(
                        { userId },
                        { switchbotToken, devices },
                        { upsert: true, new: true }
                    );

                    userRegistrationState.delete(userId);
                    await replyMessage(event.replyToken, "✅ SwitchBotとの連携が完了しました！\n\n「リビングの電気つけて」などで家電を操作できます！");
                } catch (error) {
                    await replyMessage(event.replyToken, "⚠️ APIキーの登録に失敗しました。もう一度確認してください。\n\nキャンセルしたい場合は「キャンセル」と送信してください。");
                }
                continue;
            }

            // ✅ MongoDB fallback対応
            let user = null;
            let devices = [];

            try {
                user = await User.findOne({ userId });
                devices = user?.devices || [];
            } catch (err) {
                console.error("⚠️ MongoDB に接続できなかったため、空のデバイスリストで処理します:", err.message);
                devices = [];
            }

            const chatGPTResponse = await analyzeMessageWithChatGPT(userMessage, devices);

            if (chatGPTResponse.type === "device_control") {
                if (!user || !user.switchbotToken) {
                    await replyMessage(event.replyToken, "家電を操作するには、まず「登録」と送って SwitchBot APIキーを入力してください。");
                    continue;
                }

                for (const command of chatGPTResponse.commands) {
                    const device = user.devices.find(d => d.deviceName === command.device);
                    if (device) {
                        await axios.post(
                            `https://api.switch-bot.com/v1.0/devices/${device.deviceId}/commands`,
                            { command: command.action, parameter: 'default', commandType: 'command' },
                            { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.switchbotToken}` } }
                        );
                    }
                }

                await replyMessage(event.replyToken, "家電を操作しました！");
            } else if (chatGPTResponse.type === "smart_home_help") {
                await replyMessage(event.replyToken, chatGPTResponse.answer);
            } else {
                await replyMessage(event.replyToken, "ごめんなさい。質問の内容をもう少し詳しく教えていただけますか？");
            }
        }
    }

    res.sendStatus(200);
});

// ✅ サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));

