import { isSingleHanCharacter } from '../src/lib/pronunciationRules.ts';

export const DASH_SCOPE_MULTIMODAL_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

export const DASH_SCOPE_CHAT_COMPLETIONS_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const HAN_TEXT_RE = /^[\p{Script=Han}\s，。！？、,.!?；;：“”"'（）()]+$/u;
const HAN_CHARACTER_RE = /\p{Script=Han}/u;
const AUDIO_FORMAT_BY_MIME_TYPE = new Map([
  ['audio/wav', 'wav'],
]);
const MAX_AUDIO_BYTES = 1_000_000;
const MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const MIN_AUDIO_DURATION_MS = 250;
const MAX_AUDIO_DURATION_MS = 6_000;
const MIN_PCM_SAMPLE_RATE = 8_000;
const MAX_PCM_SAMPLE_RATE = 48_000;
const MAX_TEXT_CHARACTERS = 40;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface ApiRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string | number): void;
}

export interface AudioRequest {
  target: string;
  mimeType: string;
  audioBase64: string;
}

export interface ExampleRequest {
  character: string;
}

export interface SynthesisRequest {
  text: string;
}

export class RequestValidationError extends Error {}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  let value = text.trim();
  if (!value) return null;

  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseRequestBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  return parseJsonObject(body);
}

export function validateAudioRequest(body: unknown): AudioRequest {
  const value = requireRecord(body);
  const target = requireChineseText(value.target, 'target');
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim() : '';
  const audioBase64 = typeof value.audioBase64 === 'string' ? value.audioBase64 : '';

  if (!AUDIO_FORMAT_BY_MIME_TYPE.has(mimeType)) {
    throw new RequestValidationError('不支持的音频格式');
  }
  if (!audioBase64 || !BASE64_RE.test(audioBase64)) {
    throw new RequestValidationError('音频数据无效');
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
    throw new RequestValidationError('音频不能超过 1 MB');
  }

  const audio = Buffer.from(audioBase64, 'base64');
  if (audio.length === 0 || audio.toString('base64') !== audioBase64) {
    throw new RequestValidationError('音频数据无效');
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new RequestValidationError('音频不能超过 1 MB');
  }
  validatePcmWav(audio);

  return { target, mimeType, audioBase64 };
}

export function audioFormatForMimeType(mimeType: string): string {
  const format = AUDIO_FORMAT_BY_MIME_TYPE.get(mimeType);
  if (!format) throw new RequestValidationError('不支持的音频格式');
  return format;
}

export function validateExampleRequest(body: unknown): ExampleRequest {
  const value = requireRecord(body);
  const character = typeof value.character === 'string' ? value.character.trim() : '';
  if (!isSingleHanCharacter(character)) {
    throw new RequestValidationError('character 必须是单个汉字');
  }
  return { character };
}

export function validateSynthesisRequest(body: unknown): SynthesisRequest {
  const value = requireRecord(body);
  const text = requireChineseText(value.text, 'text');
  return { text };
}

export function extractMessageText(content: unknown): string | null {
  if (typeof content === 'string') {
    const text = content.trim();
    return text || null;
  }
  if (!Array.isArray(content)) return null;

  for (const item of content) {
    if (!isRecord(item) || typeof item.text !== 'string') continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RequestValidationError('请求体必须是 JSON 对象');
  }
  return value;
}

function requireChineseText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (
    !text
    || Array.from(text).length > MAX_TEXT_CHARACTERS
    || !HAN_TEXT_RE.test(text)
    || !HAN_CHARACTER_RE.test(text)
  ) {
    throw new RequestValidationError(
      `${field} 必须是 1 到 ${MAX_TEXT_CHARACTERS} 个中文字符`,
    );
  }
  return text;
}

function validatePcmWav(audio: Buffer): void {
  if (
    audio.length < 12
    || readAscii(audio, 0, 4) !== 'RIFF'
    || readAscii(audio, 8, 12) !== 'WAVE'
    || audio.readUInt32LE(4) !== audio.length - 8
  ) {
    throw new RequestValidationError('WAV 音频数据无效');
  }

  let format: {
    audioFormat: number;
    channelCount: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
  } | null = null;
  let dataBytes: number | null = null;
  let offset = 12;

  while (offset < audio.length) {
    if (offset + 8 > audio.length) {
      throw new RequestValidationError('WAV 音频数据无效');
    }
    const chunkId = readAscii(audio, offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > audio.length) {
      throw new RequestValidationError('WAV 音频数据无效');
    }

    if (chunkId === 'fmt ') {
      if (format !== null || chunkSize < 16) {
        throw new RequestValidationError('WAV 音频数据无效');
      }
      format = {
        audioFormat: audio.readUInt16LE(chunkStart),
        channelCount: audio.readUInt16LE(chunkStart + 2),
        sampleRate: audio.readUInt32LE(chunkStart + 4),
        byteRate: audio.readUInt32LE(chunkStart + 8),
        blockAlign: audio.readUInt16LE(chunkStart + 12),
        bitsPerSample: audio.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      if (dataBytes !== null) {
        throw new RequestValidationError('WAV 音频数据无效');
      }
      dataBytes = chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
    if (offset > audio.length) {
      throw new RequestValidationError('WAV 音频数据无效');
    }
  }

  if (format === null || dataBytes === null) {
    throw new RequestValidationError('WAV 音频数据无效');
  }

  const expectedBlockAlign = 2;
  const expectedByteRate = format.sampleRate * expectedBlockAlign;
  if (
    format.audioFormat !== 1
    || format.channelCount !== 1
    || format.bitsPerSample !== 16
    || format.sampleRate < MIN_PCM_SAMPLE_RATE
    || format.sampleRate > MAX_PCM_SAMPLE_RATE
    || format.blockAlign !== expectedBlockAlign
    || format.byteRate !== expectedByteRate
    || dataBytes % expectedBlockAlign !== 0
  ) {
    throw new RequestValidationError(
      '仅支持单声道 16 位 PCM WAV（8–48 kHz）',
    );
  }

  const durationNumerator = dataBytes * 1_000;
  if (durationNumerator < format.byteRate * MIN_AUDIO_DURATION_MS) {
    throw new RequestValidationError('音频太短，请至少录音 0.25 秒');
  }
  if (durationNumerator > format.byteRate * MAX_AUDIO_DURATION_MS) {
    throw new RequestValidationError('音频不能超过 6 秒');
  }
}

function readAscii(buffer: Buffer, start: number, end: number): string {
  return buffer.toString('ascii', start, end);
}
