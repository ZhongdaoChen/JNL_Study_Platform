import {
  DASH_SCOPE_CHAT_COMPLETIONS_URL,
  type AudioRequest,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  audioFormatForMimeType,
  isRecord,
  parseJsonObject,
  parseRequestBody,
  validateAudioRequest,
} from './pronunciationShared.js';
import {
  isSingleHanCharacter,
  normalizeRecognizedChinese,
} from './pronunciationRules.js';
import {
  type PronunciationSecurityContext,
  PronunciationTimeoutError,
  withPronunciationSecurity,
} from './pronunciationSecurity.js';

// 单阶段评估：一次调用同时完成转写与发音判定。模型固定，避免部署配置漂移。
const ASSESS_MODEL = 'qwen3.5-omni-flash';
const HIGH_CONFIDENCE_THRESHOLD = 0.9;
const MAX_RECOGNIZED_TEXT_CHARACTERS = 120;
const PINYIN_RE = /^[a-züvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+[1-5]?$/iu;

interface PronunciationJudgment {
  status: 'correct' | 'incorrect' | 'unclear';
  confidence: number;
  acceptedReading: string | null;
  recognizedText: string;
}

export function pronunciationJudgmentPrompt(target: string): string {
  const singleCharacter = isSingleHanCharacter(target);
  return [
    '你是谨慎的儿童普通话发音核验器，必须直接听所附原始录音。',
    '第一步：把录音中实际听到的内容如实转写进 recognizedText（只写听到的汉字，没有听清人声就写空字符串）。',
    '第二步：对照目标文本判断录音的内容和发音是否匹配。',
    '只返回一个 JSON 对象，且只能有 recognizedText、status、confidence、acceptedReading 四个字段。',
    'status 只能是 correct、incorrect 或 unclear；confidence 必须是 0 到 1 的数字；recognizedText 必须是字符串。',
    '只有录音清楚且能明确判断时才返回 correct 或 incorrect；噪声、截断、含糊或证据冲突都返回 unclear。',
    'incorrect 只用于原始录音明确读成了目标以外内容的情形，不确定时绝不能猜测。',
    singleCharacter
      ? '目标是单个汉字：该字任一常见现代普通话读音都算 correct；correct 时 acceptedReading 填写带声调拼音。'
      : '目标是词组或句子：核验整段内容和发音是否匹配；acceptedReading 必须为 null。',
    'incorrect 或 unclear 时 acceptedReading 必须为 null。',
    JSON.stringify({ target }),
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
    const { response: judgmentResponse, data: judgmentStream } = await context.fetchText(
      DASH_SCOPE_CHAT_COMPLETIONS_URL,
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ASSESS_MODEL,
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
                text: pronunciationJudgmentPrompt(request.target),
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
        max_tokens: 200,
      }),
      },
    );
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
      || !normalizeRecognizedChinese(judgment.recognizedText)
    ) {
      res.status(422).json({ error: '没有听清，请再试一次' });
      return;
    }

    res.status(200).json({
      correct: judgment.status === 'correct',
      recognizedText: judgment.recognizedText,
      acceptedReading: judgment.acceptedReading,
      confidence: judgment.confidence,
    });
  } catch (error) {
    if (error instanceof PronunciationTimeoutError) {
      res.status(504).json({ error: '发音评估超时，请稍后重试' });
      return;
    }
    res.status(502).json({ error: '发音评估服务暂时不可用' });
  }
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
    keys.length !== 4
    || keys[0] !== 'acceptedReading'
    || keys[1] !== 'confidence'
    || keys[2] !== 'recognizedText'
    || keys[3] !== 'status'
  ) {
    return null;
  }

  const { status, confidence, acceptedReading, recognizedText } = parsed;
  const singleCharacter = isSingleHanCharacter(target);
  if (
    (status !== 'correct' && status !== 'incorrect' && status !== 'unclear')
    || typeof confidence !== 'number'
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
    || typeof recognizedText !== 'string'
    || recognizedText.trim().length > MAX_RECOGNIZED_TEXT_CHARACTERS
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
    recognizedText: recognizedText.trim(),
  };
}
