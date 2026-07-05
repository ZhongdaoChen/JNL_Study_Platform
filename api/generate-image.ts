// Vercel Serverless Function：服务端代理调用百炼 z-image-turbo 生成例句配图。
// QWEN_API_KEY 通过服务端环境变量注入，绝不暴露给前端。

const Z_IMAGE_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

interface GenerateImageBody {
  sentence?: unknown;
  word?: unknown;
  lang?: unknown;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '服务端未配置 QWEN_API_KEY' });
    return;
  }

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as GenerateImageBody;
  const sentence = String(body?.sentence ?? '').trim();
  const word = String(body?.word ?? '').trim();
  const lang = body?.lang === 'zh' ? 'zh' : 'en';

  if (!sentence) {
    res.status(400).json({ error: '缺少参数 sentence' });
    return;
  }
  if (sentence.length > 240) {
    res.status(400).json({ error: 'sentence 过长' });
    return;
  }
  if (word.length > 40) {
    res.status(400).json({ error: 'word 过长' });
    return;
  }

  const prompt =
    lang === 'zh'
      ? `为5岁儿童画一张温暖、简单、彩色的绘本插画，表现这个例句的意思：「${sentence}」。画面自然包含「${word}」的含义。不要文字、字母、字幕、标志或水印。`
      : `Create a warm, simple, colorful picture-book illustration for a 5-year-old child that shows this example sentence: "${sentence}". Make the meaning of "${word}" clear in the scene. No text, letters, captions, logos, or watermarks.`;

  try {
    const r = await fetch(Z_IMAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'z-image-turbo',
        input: {
          messages: [
            {
              role: 'user',
              content: [{ text: prompt.slice(0, 800) }],
            },
          ],
        },
        parameters: {
          prompt_extend: false,
          size: '1024*1024',
        },
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ error: 'z-image-turbo 接口返回错误', detail: detail.slice(0, 500) });
      return;
    }

    const data = await r.json();
    const content = data?.output?.choices?.[0]?.message?.content ?? [];
    const imageUrl = Array.isArray(content)
      ? content.find(hasImage)?.image ?? ''
      : '';

    if (!imageUrl) {
      res.status(502).json({ error: '未能生成图片' });
      return;
    }

    res.status(200).json({ imageUrl });
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e, '生成失败') });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function hasImage(item: unknown): item is { image: string } {
  return (
    typeof item === 'object' &&
    item !== null &&
    'image' in item &&
    typeof (item as { image?: unknown }).image === 'string'
  );
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
