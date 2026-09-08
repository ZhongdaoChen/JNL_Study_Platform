import { sanitizePronunciationExamples } from './pronunciationRules.ts';
import { supabase, usingCloud } from './supabase.ts';

export const PRONUNCIATION_REQUEST_TIMEOUTS = {
  assessment: 45_000,
  content: 15_000,
  synthesis: 15_000,
} as const;

interface RequestOptions {
  timeoutMs?: number;
  accessToken?: string;
  signal?: AbortSignal;
}

export interface PronunciationAssessment {
  correct: boolean;
  recognizedText: string;
  acceptedReading: string | null;
  confidence: number;
}

export async function assessPronunciation(
  target: string,
  audio: Blob,
  options: RequestOptions = {},
): Promise<PronunciationAssessment> {
  throwIfAborted(options.signal);
  const accessToken = await pronunciationAccessToken(options.accessToken);
  throwIfAborted(options.signal);
  const data = await fetchJsonWithTimeout(
    '/api/assess-pronunciation',
    {
      target,
      mimeType: audio.type,
      audioBase64: await blobToBase64(audio),
    },
    options.timeoutMs ?? PRONUNCIATION_REQUEST_TIMEOUTS.assessment,
    '发音评估超时，请稍后重试',
    '发音评估失败，请稍后重试',
    '语音识别结果无效',
    accessToken,
    options.signal,
  );

  if (!isRecord(data)) throw new Error('语音识别结果无效');
  const { correct, recognizedText, acceptedReading, confidence } = data;
  if (
    typeof correct !== 'boolean'
    || typeof recognizedText !== 'string'
    || (acceptedReading !== null && typeof acceptedReading !== 'string')
    || typeof confidence !== 'number'
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
  ) {
    throw new Error('语音识别结果无效');
  }

  return {
    correct,
    recognizedText,
    acceptedReading,
    confidence,
  };
}

export async function generatePronunciationExamples(
  character: string,
  options: RequestOptions = {},
): Promise<string[]> {
  throwIfAborted(options.signal);
  const accessToken = await pronunciationAccessToken(options.accessToken);
  throwIfAborted(options.signal);
  const data = await fetchJsonWithTimeout(
    '/api/generate-pronunciation-examples',
    { character },
    options.timeoutMs ?? PRONUNCIATION_REQUEST_TIMEOUTS.content,
    '辅助词生成超时，请稍后重试',
    '辅助词生成失败，请稍后重试',
    '辅助词结果无效',
    accessToken,
    options.signal,
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
  throwIfAborted(options.signal);
  const accessToken = await pronunciationAccessToken(options.accessToken);
  throwIfAborted(options.signal);
  const data = await fetchJsonWithTimeout(
    '/api/synthesize-pronunciation',
    { text },
    options.timeoutMs ?? PRONUNCIATION_REQUEST_TIMEOUTS.synthesis,
    '语音合成超时，请稍后重试',
    '语音合成失败，请稍后重试',
    '语音合成结果无效',
    accessToken,
    options.signal,
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
  accessToken: string,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = 0;
  const handleExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', handleExternalAbort, { once: true });
  if (externalSignal?.aborted) handleExternalAbort();
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
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
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
      if (!response.ok) throw new Error(failureMessage, { cause: error });
      throw new Error(invalidMessage, { cause: error });
    }

    if (!response.ok) {
      throw new Error(extractErrorMessage(data, failureMessage));
    }

    return data;
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage, { cause: error });
    }
    if (externalSignal?.aborted) {
      throw abortReason(externalSignal, error);
    }
    if (isAbortError(error)) throw error;
    if (error instanceof TypeError) {
      throw new Error(failureMessage, { cause: error });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', handleExternalAbort);
  }
}

async function pronunciationAccessToken(explicitToken?: string): Promise<string> {
  if (explicitToken?.trim()) return explicitToken.trim();

  if (!usingCloud || !supabase) {
    throw new Error('语音服务仅在云端登录模式可用');
  }

  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token?.trim();
  if (error || !accessToken) {
    throw new Error('登录已失效，请重新登录');
  }
  return accessToken;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (!isRecord(data) || typeof data.error !== 'string' || !data.error.trim()) {
    return fallback;
  }
  return data.error.trim();
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal, fallback?: unknown): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (isAbortError(fallback)) return fallback;
  return new DOMException('The operation was aborted.', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
