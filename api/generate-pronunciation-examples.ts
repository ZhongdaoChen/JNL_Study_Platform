import { sanitizePronunciationExamples } from '../src/lib/pronunciationRules.ts';
import {
  DASH_SCOPE_CHAT_COMPLETIONS_URL,
  type ApiRequest,
  type ApiResponse,
  RequestValidationError,
  extractMessageText,
  isRecord,
  parseJsonObject,
  parseRequestBody,
  validateExampleRequest,
} from './pronunciationShared.ts';
import { withPronunciationSecurity } from './pronunciationSecurity.ts';

const EXAMPLES_MODEL = 'qwen-turbo';

export function examplesPrompt(character: string): string {
  return [
    '你为 5 岁儿童生成中文发音练习辅助词。',
    `目标汉字：${JSON.stringify(character)}`,
    '只返回 JSON，不要 Markdown、解释、拼音或其他文字。',
    '生成恰好三个互不重复、常见、自然、适合儿童理解的中文词语。',
    '每个词必须由 2 到 4 个汉字组成，并且必须包含目标汉字。',
    '返回格式：{"examples":["中国","中午","中间"]}',
  ].join('\n');
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

  await withPronunciationSecurity(req, res, 'examples', () => (
    handleAuthorizedExampleGeneration(req, res)
  ));
}

async function handleAuthorizedExampleGeneration(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '辅助词服务未配置' });
    return;
  }

  let character: string;
  try {
    ({ character } = validateExampleRequest(parseRequestBody(req.body)));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: '请求参数无效' });
    return;
  }

  try {
    const upstream = await fetch(DASH_SCOPE_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EXAMPLES_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: examplesPrompt(character),
          },
          {
            role: 'user',
            content: `请为汉字「${character}」生成三个辅助词。`,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      res.status(502).json({ error: '辅助词生成服务暂时不可用' });
      return;
    }

    const text = extractChatMessageText(await upstream.json());
    const parsed = text ? parseJsonObject(text) : null;
    const examples = sanitizePronunciationExamples(character, parsed?.examples);
    if (examples.length !== 3) {
      res.status(502).json({ error: '辅助词生成结果无效' });
      return;
    }

    res.status(200).json({ examples });
  } catch {
    res.status(502).json({ error: '辅助词生成服务暂时不可用' });
  }
}

function extractChatMessageText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return extractMessageText(choice.message.content);
}
