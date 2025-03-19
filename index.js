const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json());

// ✅ MongoDB 接続
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB に接続成功！"))
    .catch(err => console.error("🚨 MongoDB 接続エラー:", err));

// ✅ 環境変数
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;  // 🔹 ChatGPT API 用
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;  // 🔹 LINE Bot 用

// ✅ MongoDB スキーマ
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    switchbotToken: { type: String },
    devices: { type: Array, default: [] }
});

const User = mongoose.model("User", userSchema);

const userRegistrationState = new Map(); // 🔹 ユーザーの登録状態を管理

// ✅ ChatGPT にメッセージを送る関数
async function analyzeMessageWithChatGPT(userMessage, userDevices) {
    try {
        console.log(`🤖 ChatGPT にリクエスト: ${userMessage}`);

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: `あなたはスマートホームアシスタントです。\
                        ユーザーの家には次のデバイスがあります: ${JSON.stringify(userDevices.map(d => d.deviceName)) || "不明"}。\
                        ユーザーのメッセージが「家電の操作」か「スマートホームの質問」かを判定し、\
                        JSON 形式で返答してください。\
                        - 「家電の操作」なら \`{ "type": "device_control", "commands": [{ "device": "<適切なデバイス名>", "action": "turnOn" }] }\`\
                        - 「スマートホームの質問」なら \`{ "type": "smart_home_help", "answer": "SwitchBotのペアリング方法は..." }\`\
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

// ✅ LINE Webhookエンドポイント
app.post('/webhook', async (req, res) => {
    const events = req.body.events;

    for (const event of events) {
        if (event.type === "follow") {
            const userId = event.source.userId;
            await replyMessage(userId, 
                "こんにちは！このLINE Botでは、お家の家電を操作したり、スマートホームに関する質問をすることができます。\n\n"
                + "🏠 **家電を操作したい場合** → 「登録」と送信してください。その後、SwitchBot APIキーを送信すると、あなたの家電を操作できるようになります。\n\n"
                + "❓ **スマートホームの質問をしたい場合** → そのまま質問内容を送信してください！（例：「SwitchBotのペアリング方法は？」）"
            );
            continue;
        }

        if (event.message && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            if (userMessage === "登録") {
                userRegistrationState.set(userId, true);
                await replyMessage(event.replyToken, "🔑 SwitchBot APIキーを送信してください。");
                continue;
            }

            if (userRegistrationState.get(userId)) {
                const switchbotToken = userMessage.trim();

                if (switchbotToken.length <= 60) {
                    await replyMessage(event.replyToken, "⚠️ 無効なAPIキーです。APIキーは **60文字以上** である必要があります。もう一度送信してください。");
                    continue;
                }

                if (!/^[A-Za-z0-9]+$/.test(switchbotToken)) {
                    await replyMessage(event.replyToken, "⚠️ 無効なAPIキーです。APIキーは **半角英数字のみ** である必要があります。もう一度送信してください。");
                    continue;
                }

                try {
                    const devices = await fetchSwitchBotDevices(switchbotToken);
                    await User.findOneAndUpdate(
                        { userId: userId },
                        { switchbotToken: switchbotToken, devices: devices },
                        { upsert: true, new: true }
                    );

                    userRegistrationState.delete(userId);
                    await replyMessage(event.replyToken, "✅ SwitchBotとの連携が正常に完了しました！\n\n「リビングの電気つけて」など、家電を操作してみてください！");
                } catch (error) {
                    await replyMessage(event.replyToken, "⚠️ APIキーの登録に失敗しました。正しいAPIキーを入力してください。");
                }
                continue;
            }

            const user = await User.findOne({ userId: userId });
            const chatGPTResponse = await analyzeMessageWithChatGPT(userMessage, user ? user.devices : []);

            if (chatGPTResponse.type === "device_control") {
                if (!user || !user.switchbotToken) {
                    await replyMessage(event.replyToken, "家電を操作するには、まず「登録」と送信して APIキーを入力してください。");
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
            }
        }
    }

    res.sendStatus(200);
});

// ✅ サーバー起動
app.listen(3000, () => console.log("🚀 Server is running on port 3000"));

