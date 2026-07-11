// 前端调用内部 Serverless 接口生成例句和配图。
// 真正的 Qwen API Key 只存在服务端(Vercel 环境变量)，前端拿不到，保证安全。
// lang=en：生成简单英文例句；lang=zh：生成包含该汉字的简单中文句子。

const SENTENCE_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 45_000;

interface AiRequestOptions {
  timeoutMs?: number;
}

export async function generateExampleSentence(
  word: string,
  lang: 'en' | 'zh' = 'en',
  options: AiRequestOptions = {},
): Promise<string> {
  const res = await fetchWithTimeout(
    '/api/generate-sentence',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, lang }),
    },
    options.timeoutMs ?? SENTENCE_TIMEOUT_MS,
    '例句生成超时，请稍后重试',
  );

  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      detail = data.error || detail;
    } catch {
      // 本地 npm run dev 时没有 Serverless 接口，会落到这里
      detail = '例句服务不可用（本地开发请用 vercel dev，或部署到 Vercel）';
    }
    throw new Error(detail);
  }

  const data = await res.json();
  const sentence = (data.sentence ?? '').trim();
  if (!sentence) throw new Error('未生成例句，请重试');
  return sentence;
}

export async function generateExampleImage(
  sentence: string,
  word: string,
  lang: 'en' | 'zh' = 'en',
  options: AiRequestOptions = {},
): Promise<string> {
  const res = await fetchWithTimeout(
    '/api/generate-image',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence, word, lang }),
    },
    options.timeoutMs ?? IMAGE_TIMEOUT_MS,
    '图片生成超时，请稍后重试',
  );

  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      detail = data.error || detail;
    } catch {
      detail = '图片服务不可用（本地开发请用 vercel dev，或部署到 Vercel）';
    }
    throw new Error(detail);
  }

  const data = await res.json();
  const imageUrl = (data.imageUrl ?? '').trim();
  if (!imageUrl) throw new Error('未生成图片，请重试');
  return imageUrl;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeout]);
  } catch (e) {
    if (timedOut) throw new Error(timeoutMessage, { cause: e });
    throw e;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
