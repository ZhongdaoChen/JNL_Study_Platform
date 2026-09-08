import {
  DASH_SCOPE_CHAT_COMPLETIONS_URL,
  DASH_SCOPE_MULTIMODAL_URL,
  type AudioRequest,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  audioFormatForMimeType,
  isRecord,
  parseJsonObject,
  parseRequestBody,
  validateAudioRequest,
} from './pronunciationShared.ts';
import {
  isSingleHanCharacter,
  normalizeRecognizedChinese,
} from '../src/lib/pronunciationRules.ts';
import {
  type PronunciationSecurityContext,
  PronunciationSecurityError,
  PronunciationTimeoutError,
  withPronunciationSecurity,
} from './pronunciationSecurity.ts';

const ASSESS_MODEL =
  process.env.QWEN_PRONUNCIATION_MODEL ?? 'qwen-audio-3.0-asr-flash';
const DIRECT_ASSESS_MODEL = 'qwen3.5-omni-plus';
const HIGH_CONFIDENCE_THRESHOLD = 0.9;
const PINYIN_RE = /^[a-züvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+[1-5]?$/iu;

interface PronunciationJudgment {
  status: 'correct' | 'incorrect' | 'unclear';
  confidence: number;
  acceptedReading: string | null;
}

interface AsrTranscript {
  text: string;
  words: string[];
}

export function pronunciationJudgmentPrompt(
  target: string,
  transcript: AsrTranscript,
): string {
  const singleCharacter = isSingleHanCharacter(target);
  return [
    '你是谨慎的儿童普通话发音核验器，必须直接听所附原始录音。',
    '目标文本和自动转写只提供上下文；禁止只根据自动转写猜测结论。',
    '只返回一个 JSON 对象，且只能有 status、confidence、acceptedReading 三个字段。',
    'status 只能是 correct、incorrect 或 unclear；confidence 必须是 0 到 1 的数字。',
    '只有录音清楚且能明确判断时才返回 correct 或 incorrect；噪声、截断、含糊或证据冲突都返回 unclear。',
    'incorrect 只用于原始录音明确读成了目标以外内容的情形，不确定时绝不能猜测。',
    singleCharacter
      ? '目标是单个汉字：该字任一常见现代普通话读音都算 correct；correct 时 acceptedReading 填写带声调拼音。'
      : '目标是词组或句子：核验整段内容和发音是否匹配；acceptedReading 必须为 null。',
    'incorrect 或 unclear 时 acceptedReading 必须为 null。',
    JSON.stringify({
      target,
      recognizedText: transcript.text,
      recognizedWords: transcript.words,
    }),
  ].join('\n');
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '发音服务未配置' });
    return;
  }

  let request: AudioRequest;
  try {
    request = validateAudioRequest(parseRequestBody(req.body));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: '请求参数无效' });
    return;
  }

  await withPronunciationSecurity(req, res, 'assessment', (context) => (
    handleAuthorizedAssessment(res, context, request, apiKey)
  ));
}

async function handleAuthorizedAssessment(
  res: ApiResponse,
  context: PronunciationSecurityContext,
  request: AudioRequest,
  apiKey: string,
): Promise<void> {
  try {
    const audioFormat = audioFormatForMimeType(request.mimeType);
    const audioDataUrl = `data:${request.mimeType};base64,${request.audioBase64}`;
    const { response: asrResponse, data: asrData } = await context.fetchJson(
      DASH_SCOPE_MULTIMODAL_URL,
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'disable',
      },
      body: JSON.stringify({
        model: ASSESS_MODEL,
        input: {
          messages: [{
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: audioDataUrl,
                },
              },
            ],
          }],
        },
        parameters: {
          format: audioFormat,
          language_hints: ['zh'],
        },
      }),
      },
    );

    if (!asrResponse.ok) {
      res.status(502).json({ error: '发音评估服务暂时不可用' });
      return;
    }

    const transcript = parseAsrTranscript(asrData);
    if (!transcript) {
      res.status(502).json({ error: '发音评估结果无效' });
      return;
    }
    if (!normalizeRecognizedChinese(transcript.text)) {
      res.status(422).json({ error: '没有听清，请再试一次' });
      return;
    }

    const { response: judgmentResponse, data: judgmentStream } =
      await context.withProviderGate('omni_assessment', (providerContext) => (
        providerContext.fetchText(DASH_SCOPE_CHAT_COMPLETIONS_URL,
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DIRECT_ASSESS_MODEL,
        messages: [
          {
            role: 'system',
            content: '直接根据原始录音核验普通话发音，并严格返回 JSON。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: audioDataUrl,
                  format: audioFormat,
                },
              },
              {
                type: 'text',
                text: pronunciationJudgmentPrompt(request.target, transcript),
              },
            ],
          },
        ],
        modalities: ['text'],
        stream: true,
        stream_options: {
          include_usage: true,
        },
        response_format: {
          type: 'json_object',
        },
        temperature: 0,
        max_tokens: 120,
      }),
        },
      )));
    if (!judgmentResponse.ok) {
      res.status(502).json({ error: '发音评估服务暂时不可用' });
      return;
    }

    const judgmentText = typeof judgmentStream === 'string'
      ? extractSseText(judgmentStream)
      : null;
    const judgment = judgmentText
      ? parsePronunciationJudgment(judgmentText, request.target)
      : null;
    if (!judgment) {
      res.status(502).json({ error: '发音评估结果无效' });
      return;
    }
    if (
      judgment.status === 'unclear'
      || judgment.confidence < HIGH_CONFIDENCE_THRESHOLD
    ) {
      res.status(422).json({ error: '没有听清，请再试一次' });
      return;
    }

    res.status(200).json({
      correct: judgment.status === 'correct',
      recognizedText: transcript.text,
      acceptedReading: judgment.acceptedReading,
      confidence: judgment.confidence,
    });
  } catch (error) {
    if (error instanceof PronunciationTimeoutError) {
      res.status(504).json({ error: '发音评估超时，请稍后重试' });
      return;
    }
    if (error instanceof PronunciationSecurityError) throw error;
    res.status(502).json({ error: '发音评估服务暂时不可用' });
  }
}

function parseAsrTranscript(value: unknown): AsrTranscript | null {
  if (!isRecord(value) || !isRecord(value.output)) {
    return null;
  }

  const text = typeof value.output.text === 'string' ? value.output.text.trim() : null;
  if (text === null) return null;

  const sentence = isRecord(value.output.sentence) ? value.output.sentence : null;
  const words = sentence && Array.isArray(sentence.words)
    ? sentence.words.flatMap((word) => (
        isRecord(word) && typeof word.text === 'string' && word.text.trim()
          ? [word.text.trim()]
          : []
      ))
    : [];

  return { text, words };
}

function extractSseText(value: string): string | null {
  let text = '';
  let sawDone = false;

  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload) continue;
    if (payload === '[DONE]') {
      sawDone = true;
      break;
    }

    const event = parseJsonObject(payload);
    if (!event || !Array.isArray(event.choices)) return null;
    if (event.choices.length === 0) continue;
    const choice = event.choices[0];
    if (!isRecord(choice) || !isRecord(choice.delta)) return null;
    const content = choice.delta.content;
    if (content === null || content === undefined) continue;
    if (typeof content !== 'string') return null;
    text += content;
  }

  const trimmed = text.trim();
  return sawDone && trimmed ? trimmed : null;
}

function parsePronunciationJudgment(
  value: string,
  target: string,
): PronunciationJudgment | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;

  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'acceptedReading'
    || keys[1] !== 'confidence'
    || keys[2] !== 'status'
  ) {
    return null;
  }

  const { status, confidence, acceptedReading } = parsed;
  const singleCharacter = isSingleHanCharacter(target);
  if (
    (status !== 'correct' && status !== 'incorrect' && status !== 'unclear')
    || typeof confidence !== 'number'
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
    || (
      acceptedReading !== null
      && (
        typeof acceptedReading !== 'string'
        || !PINYIN_RE.test(acceptedReading.trim())
        || acceptedReading.trim().length > 32
      )
    )
    || (
      status === 'correct'
      && (
        singleCharacter
          ? typeof acceptedReading !== 'string'
          : acceptedReading !== null
      )
    )
    || (status !== 'correct' && acceptedReading !== null)
  ) {
    return null;
  }

  return {
    status,
    confidence,
    acceptedReading: typeof acceptedReading === 'string'
      ? acceptedReading.trim()
      : null,
  };
}
