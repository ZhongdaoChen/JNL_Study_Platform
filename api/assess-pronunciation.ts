import {
  DASH_SCOPE_CHAT_COMPLETIONS_URL,
  DASH_SCOPE_MULTIMODAL_URL,
  type AudioRequest,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  audioFormatForMimeType,
  extractMessageText,
  isRecord,
  parseJsonObject,
  parseRequestBody,
  validateAudioRequest,
} from './pronunciationShared.ts';
import {
  isSingleHanCharacter,
  normalizeRecognizedChinese,
} from '../src/lib/pronunciationRules.ts';
import { withPronunciationSecurity } from './pronunciationSecurity.ts';

const ASSESS_MODEL =
  process.env.QWEN_PRONUNCIATION_MODEL ?? 'qwen-audio-3.0-asr-flash';
const JUDGE_MODEL =
  process.env.QWEN_PRONUNCIATION_JUDGE_MODEL ?? 'qwen3.8-flash';
const PINYIN_RE = /^[a-züvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+[1-5]?$/iu;

interface PronunciationJudgment {
  status: 'correct' | 'incorrect' | 'unclear';
  acceptedReading: string | null;
}

interface AsrTranscript {
  text: string;
  words: string[];
}

const PRONUNCIATION_JUDGMENT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'pronunciation_judgment',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['correct', 'incorrect', 'unclear'],
        },
        acceptedReading: {
          type: ['string', 'null'],
        },
      },
      required: ['status', 'acceptedReading'],
      additionalProperties: false,
    },
  },
};

export function pronunciationJudgmentPrompt(
  target: string,
  transcript: AsrTranscript,
): string {
  return [
    '你是严格的儿童普通话单字发音核验器。',
    '输入来自语音识别服务，只能把识别文本和分词作为证据，不能添加未提供的录音信息。',
    '若识别结果对应目标汉字的任一常见现代普通话读音，status 为 correct。',
    '若明显对应其他读音，status 为 incorrect；证据不足则为 unclear。',
    'correct 时 acceptedReading 必须填写带声调的拼音，其他状态必须为 null。',
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

  await withPronunciationSecurity(req, res, 'assessment', () => (
    handleAuthorizedAssessment(req, res)
  ));
}

async function handleAuthorizedAssessment(req: ApiRequest, res: ApiResponse): Promise<void> {
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

  try {
    const asrResponse = await fetch(DASH_SCOPE_MULTIMODAL_URL, {
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
                  data: `data:${request.mimeType};base64,${request.audioBase64}`,
                },
              },
            ],
          }],
        },
        parameters: {
          format: audioFormatForMimeType(request.mimeType),
          language_hints: ['zh'],
        },
      }),
    });

    if (!asrResponse.ok) {
      res.status(502).json({ error: '发音评估服务暂时不可用' });
      return;
    }

    const transcript = parseAsrTranscript(await asrResponse.json());
    if (!transcript) {
      res.status(502).json({ error: '发音评估结果无效' });
      return;
    }
    if (!normalizeRecognizedChinese(transcript.text)) {
      res.status(422).json({ error: '没有听清，请再试一次' });
      return;
    }

    if (!isSingleHanCharacter(request.target)) {
      res.status(200).json({
        correct: normalizeRecognizedChinese(transcript.text)
          === normalizeRecognizedChinese(request.target),
        recognizedText: transcript.text,
        acceptedReading: null,
      });
      return;
    }

    const judgmentResponse = await fetch(DASH_SCOPE_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          {
            role: 'system',
            content: '根据给定的语音识别证据核验单个汉字读音，并严格按 JSON Schema 返回。',
          },
          {
            role: 'user',
            content: pronunciationJudgmentPrompt(request.target, transcript),
          },
        ],
        response_format: PRONUNCIATION_JUDGMENT_RESPONSE_FORMAT,
        temperature: 0,
        max_tokens: 100,
      }),
    });
    if (!judgmentResponse.ok) {
      res.status(502).json({ error: '发音评估服务暂时不可用' });
      return;
    }

    const judgment = parsePronunciationJudgment(await judgmentResponse.json());
    if (!judgment) {
      res.status(502).json({ error: '发音评估结果无效' });
      return;
    }
    if (judgment.status === 'unclear') {
      res.status(422).json({ error: '没有听清，请再试一次' });
      return;
    }

    res.status(200).json({
      correct: judgment.status === 'correct',
      recognizedText: transcript.text,
      acceptedReading: judgment.acceptedReading,
    });
  } catch {
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

function parsePronunciationJudgment(value: unknown): PronunciationJudgment | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const text = extractMessageText(choice.message.content);
  if (!text) return null;
  const parsed = parseJsonObject(text);
  if (!parsed) return null;

  const { status, acceptedReading } = parsed;
  if (
    (status !== 'correct' && status !== 'incorrect' && status !== 'unclear')
    || (
      acceptedReading !== null
      && (
        typeof acceptedReading !== 'string'
        || !PINYIN_RE.test(acceptedReading.trim())
        || acceptedReading.trim().length > 32
      )
    )
    || (status === 'correct' && typeof acceptedReading !== 'string')
    || (status !== 'correct' && acceptedReading !== null)
  ) {
    return null;
  }

  return {
    status,
    acceptedReading: typeof acceptedReading === 'string'
      ? acceptedReading.trim()
      : null,
  };
}
