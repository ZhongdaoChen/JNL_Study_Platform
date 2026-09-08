import { sanitizePronunciationExamples } from './pronunciationRules.ts';

const ASSESS_TIMEOUT_MS = 12_000;
const CONTENT_TIMEOUT_MS = 15_000;
const TTS_TIMEOUT_MS = 15_000;

interface RequestOptions {
  timeoutMs?: number;
}

export interface PronunciationAssessment {
  correct: boolean;
  recognizedText: string;
  acceptedReading: string | null;
}

export async function assessPronunciation(
  target: string,
  audio: Blob,
  options: RequestOptions = {},
): Promise<PronunciationAssessment> {
  const data = await fetchJsonWithTimeout(
    '/api/assess-pronunciation',
    {
      target,
      mimeType: audio.type,
      audioBase64: await blobToBase64(audio),
    },
    options.timeoutMs ?? ASSESS_TIMEOUT_MS,
    '发音评估超时，请稍后重试',
    '发音评估失败，请稍后重试',
    '语音识别结果无效',
  );

  if (!isRecord(data)) throw new Error('语音识别结果无效');
  const { correct, recognizedText, acceptedReading } = data;
  if (
    typeof correct !== 'boolean'
    || typeof recognizedText !== 'string'
    || (acceptedReading !== null && typeof acceptedReading !== 'string')
  ) {
    throw new Error('语音识别结果无效');
  }

  return {
    correct,
    recognizedText,
    acceptedReading,
  };
}

export async function generatePronunciationExamples(
  character: string,
  options: RequestOptions = {},
): Promise<string[]> {
  const data = await fetchJsonWithTimeout(
    '/api/generate-pronunciation-examples',
    { character },
    options.timeoutMs ?? CONTENT_TIMEOUT_MS,
    '辅助词生成超时，请稍后重试',
    '辅助词生成失败，请稍后重试',
    '辅助词结果无效',
  );

  if (!isRecord(data)) throw new Error('辅助词结果无效');
  const examples = sanitizePronunciationExamples(character, data.examples);
  if (examples.length !== 3) throw new Error('辅助词结果无效');
  return examples;
}

export async function synthesizePronunciation(
  text: string,
  options: RequestOptions = {},
): Promise<string> {
  const data = await fetchJsonWithTimeout(
    '/api/synthesize-pronunciation',
    { text },
    options.timeoutMs ?? TTS_TIMEOUT_MS,
    '语音合成超时，请稍后重试',
    '语音合成失败，请稍后重试',
    '语音合成结果无效',
  );

  if (!isRecord(data) || typeof data.audioUrl !== 'string' || !data.audioUrl.trim()) {
    throw new Error('语音合成结果无效');
  }

  return data.audioUrl.trim();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  body: unknown,
  timeoutMs: number,
  timeoutMessage: string,
  failureMessage: string,
  invalidMessage: string,
): Promise<unknown> {
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
    const response = await Promise.race([
      fetch(input, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      timeout,
    ]);

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (timedOut || isAbortError(error)) {
        throw new Error(timeoutMessage, { cause: error });
      }
      if (!response.ok) throw new Error(failureMessage);
      throw new Error(invalidMessage);
    }

    if (!response.ok) {
      throw new Error(extractErrorMessage(data, failureMessage));
    }

    return data;
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      throw new Error(timeoutMessage, { cause: error });
    }
    if (error instanceof TypeError) {
      throw new Error(failureMessage, { cause: error });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (!isRecord(data) || typeof data.error !== 'string' || !data.error.trim()) {
    return fallback;
  }
  return data.error.trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
