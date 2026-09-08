import {
  DASH_SCOPE_MULTIMODAL_URL,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  isRecord,
  parseRequestBody,
  validateSynthesisRequest,
} from './pronunciationShared.ts';
import { withPronunciationSecurity } from './pronunciationSecurity.ts';

const TTS_MODEL = process.env.QWEN_TTS_MODEL ?? 'qwen3-tts-flash';
const TTS_VOICE = process.env.QWEN_TTS_VOICE ?? 'Cherry';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

  await withPronunciationSecurity(req, res, 'synthesis', () => (
    handleAuthorizedSynthesis(req, res)
  ));
}

async function handleAuthorizedSynthesis(req: ApiRequest, res: ApiResponse): Promise<void> {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '语音合成服务未配置' });
    return;
  }

  let text: string;
  try {
    ({ text } = validateSynthesisRequest(parseRequestBody(req.body)));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: '请求参数无效' });
    return;
  }

  try {
    const upstream = await fetch(DASH_SCOPE_MULTIMODAL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: {
          text,
          voice: TTS_VOICE,
          language_type: 'Chinese',
        },
      }),
    });

    if (!upstream.ok) {
      res.status(502).json({ error: '语音合成服务暂时不可用' });
      return;
    }

    const audioUrl = extractHttpsAudioUrl(await upstream.json());
    if (!audioUrl) {
      res.status(502).json({ error: '语音合成结果无效' });
      return;
    }

    res.status(200).json({ audioUrl });
  } catch {
    res.status(502).json({ error: '语音合成服务暂时不可用' });
  }
}

function extractHttpsAudioUrl(value: unknown): string | null {
  if (
    !isRecord(value)
    || !isRecord(value.output)
    || !isRecord(value.output.audio)
    || typeof value.output.audio.url !== 'string'
  ) {
    return null;
  }

  const rawUrl = value.output.audio.url.trim();
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
