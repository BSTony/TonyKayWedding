require('dotenv').config();
const functions = require('@google-cloud/functions-framework');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// 註冊名為 'lineBotWebhook' 的 HTTP 函式，這將是 Google Cloud Functions 的入口點
functions.http('lineBotWebhook', async (req, res) => {
  try {
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send('OK'); // 處理 webhook 驗證請求
    }

    const results = await Promise.all(events.map(handleEvent));
    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// 處理個別事件
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null); // 忽略非文字訊息
  }

  // HELLO WORLD 邏輯
  const replyText = `Hello World! 你剛剛說了：「${event.message.text}」`;

  // 回傳訊息給使用者
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });
}
