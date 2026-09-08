import {
  DASH_SCOPE_MULTIMODAL_URL,
  type AudioRequest,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  extractMessageText,
  isRecord,
  parseJsonObject,
  parseRequestBody,
  validateAudioRequest,
} from './pronunciationShared.ts';

const ASSESS_MODEL = process.env.QWEN_PRONUNCIATION_MODEL ?? 'qwen-omni-turbo';

interface AssessmentResult {
  status: 'correct' | 'incorrect' | 'unclear';
  recognizedText: string;
  acceptedReading: string | null;
}

export function assessmentPrompt(target: string): string {
  return [
    '你是儿童中文发音评估器。请判断录音是否正确读出了目标文本。',
    `目标文本：${JSON.stringify(target)}`,
    '如果目标是单个多音字，只要读出该字的任何常见读音都算正确。',
    '如果是多字目标，必须读出完整内容；比较时忽略空格和常见中文标点，以标准化后的完整内容为准。',
    '录音听不清、没有有效语音或无法可靠判断时，status 必须为 unclear。',
    '只返回 JSON，不要 Markdown、解释或其他文字：',
    '{"status":"correct|incorrect|unclear","recognizedText":"...","acceptedReading":"... or null"}',
    'acceptedReading 仅在接受了多音字的某个常见读音时填写，否则返回 null。',
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

  try {
    const upstream = await fetch(DASH_SCOPE_MULTIMODAL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ASSESS_MODEL,
        input: {
          messages: [{
            role: 'user',
            content: [
              { audio: `data:${request.mimeType};base64,${request.audioBase64}` },
              { text: assessmentPrompt(request.target) },
            ],
          }],
        },
        parameters: { result_format: 'message' },
      }),
    });

    if (!upstream.ok) {
      res.status(502).json({ error: '发音评估服务暂时不可用' });
      return;
    }

    const assessment = parseAssessment(await upstream.json());
    if (!assessment) {
      res.status(502).json({ error: '发音评估结果无效' });
      return;
    }
    if (assessment.status === 'unclear') {
      res.status(422).json({ error: '没有听清，请再试一次' });
      return;
    }

    res.status(200).json({
      correct: assessment.status === 'correct',
      recognizedText: assessment.recognizedText,
      acceptedReading: assessment.acceptedReading,
    });
  } catch {
    res.status(502).json({ error: '发音评估服务暂时不可用' });
  }
}

function parseAssessment(value: unknown): AssessmentResult | null {
  if (!isRecord(value) || !isRecord(value.output) || !Array.isArray(value.output.choices)) {
    return null;
  }

  const choice = value.output.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  const text = extractMessageText(choice.message.content);
  if (!text) return null;

  const parsed = parseJsonObject(text);
  if (!parsed) return null;

  const { status, recognizedText, acceptedReading } = parsed;
  if (
    (status !== 'correct' && status !== 'incorrect' && status !== 'unclear')
    || typeof recognizedText !== 'string'
    || (status !== 'unclear' && !recognizedText.trim())
    || (
      acceptedReading !== null
      && (typeof acceptedReading !== 'string' || !acceptedReading.trim())
    )
  ) {
    return null;
  }

  return {
    status,
    recognizedText: recognizedText.trim(),
    acceptedReading: typeof acceptedReading === 'string'
      ? acceptedReading.trim()
      : null,
  };
}
