// Vercel Serverless Function：服务端代理调用通义千问(Qwen) 生成儿童例句。
// Qwen API Key 通过环境变量 QWEN_API_KEY 注入，绝不暴露给前端。
//
// 本地用 `vercel dev` 运行此函数；线上由 Vercel 自动部署 /api/generate-sentence。

const DASHSCOPE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '服务端未配置 QWEN_API_KEY' });
    return;
  }

  // Vercel 在 Content-Type: application/json 时会自动解析 req.body
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const word = String(body?.word ?? '').trim();
  const lang = body?.lang === 'zh' ? 'zh' : 'en';
  if (!word) {
    res.status(400).json({ error: '缺少参数 word' });
    return;
  }
  if (word.length > 40) {
    res.status(400).json({ error: 'word 过长' });
    return;
  }

  const messages =
    lang === 'zh'
      ? [
          {
            role: 'system',
            content:
              '你为一个 5 岁、正在认字的中国小朋友编写简单的中文例句。' +
              '只用小学以内的常用字词。输出恰好一句简短的中文句子（5 到 12 个字）。' +
              '句子必须自然地包含给定的汉字。不要加引号、拼音、翻译或任何多余文字。',
          },
          {
            role: 'user',
            content: `请用「${word}」这个字写一句简单的中文句子。`,
          },
        ]
      : [
          {
            role: 'system',
            content:
              'You write simple English example sentences using everyday vocabulary at around US 3rd-grade reading level. ' +
              'The sentence MUST be funny, silly, and kid-friendly so a 5-year-old child would enjoy it. ' +
              'Output EXACTLY one sentence, preferably 5 to 10 words long. ' +
              'No quotes, no translation, no extra text, no explanations.',
          },
          {
            role: 'user',
            content: `Write one example sentence that uses the word "${word}".`,
          },
        ];

  try {
    const r = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        temperature: 0.9,
        messages,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ error: 'Qwen 接口返回错误', detail: detail.slice(0, 500) });
      return;
    }

    const data = await r.json();
    let sentence: string = data?.choices?.[0]?.message?.content ?? '';
    sentence = sentence.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();

    if (!sentence) {
      res.status(502).json({ error: '未能生成例句' });
      return;
    }

    res.status(200).json({ sentence });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '生成失败' });
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
