import {
  DASH_SCOPE_MULTIMODAL_URL,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  isRecord,
  parseRequestBody,
  validateSynthesisRequest,
} from './pronunciationShared.js';
import {
  type PronunciationSecurityContext,
  PronunciationTimeoutError,
  withPronunciationSecurity,
} from './pronunciationSecurity.js';

// instruct 版支持自然语言指令，配合 Cherry（官方标准普通话女声）消除短文本口音漂移。
const TTS_MODEL = 'qwen3-tts-instruct-flash';
const TTS_VOICE = process.env.QWEN_TTS_VOICE ?? 'Cherry';
const TTS_INSTRUCTIONS =
  '用标准普通话朗读，发音清晰、自然、亲切，语速适中，适合儿童跟读模仿，不带任何方言口音。';
// DashScope 的结果 OSS 桶是动态分配的：实测除 dashscope-result-bj/wlcb 外，
// 还返回过 dashscope-a717.oss-cn-beijing 这类桶名，固定主机名清单会误杀
// 合法结果（线上 502「语音合成结果无效」的根因）。改为严格模式：只允许
// dashscope 前缀、.aliyuncs.com 结尾的 OSS 桶域名，仍然排除任意第三方主机。
const TRUSTED_TTS_RESULT_HOST_RE =
  /^dashscope(?:-result)?-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

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

  await withPronunciationSecurity(req, res, 'synthesis', (context) => (
    handleAuthorizedSynthesis(res, context, text, apiKey)
  ));
}

async function handleAuthorizedSynthesis(
  res: ApiResponse,
  context: PronunciationSecurityContext,
  text: string,
  apiKey: string,
): Promise<void> {
  try {
    const { response: upstream, data: upstreamData } = await context.fetchJson(
      DASH_SCOPE_MULTIMODAL_URL,
      {
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
          instructions: TTS_INSTRUCTIONS,
          // 实测 optimize_instructions:true 会让上游先用大模型改写指令，
          // 单次合成从约 0.4 秒涨到 2.3~2.9 秒；指令是固定文本，改写没有价值。
          optimize_instructions: false,
        },
      }),
      },
    );

    if (!upstream.ok) {
      console.error('synthesis upstream rejected', JSON.stringify({
        status: upstream.status,
      }));
      res.status(502).json({ error: '语音合成服务暂时不可用' });
      return;
    }

    const audioUrl = extractTrustedAudioUrl(upstreamData);
    if (!audioUrl) {
      // 只记录主机名用于排障；带签名的完整 URL 不落日志。
      console.error('synthesis result url rejected', JSON.stringify({
        host: resultUrlHost(upstreamData),
      }));
      res.status(502).json({ error: '语音合成结果无效' });
      return;
    }

    res.status(200).json({ audioUrl });
  } catch (error) {
    if (error instanceof PronunciationTimeoutError) {
      res.status(504).json({ error: '语音合成超时，请稍后重试' });
      return;
    }
    res.status(502).json({ error: '语音合成服务暂时不可用' });
  }
}

function resultUrlHost(value: unknown): string {
  const url = isRecord(value) && isRecord(value.output) && isRecord(value.output.audio)
    && typeof value.output.audio.url === 'string'
    ? value.output.audio.url
    : null;
  if (url === null) return 'missing';
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return 'unparseable';
  }
}

function extractTrustedAudioUrl(value: unknown): string | null {
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
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !TRUSTED_TTS_RESULT_HOST_RE.test(url.hostname.toLowerCase())
      || url.username
      || url.password
      || url.port
    ) {
      return null;
    }
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}
