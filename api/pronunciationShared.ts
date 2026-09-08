import { isSingleHanCharacter } from './pronunciationRules.js';

export const DASH_SCOPE_MULTIMODAL_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

export const DASH_SCOPE_CHAT_COMPLETIONS_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const HAN_TEXT_RE = /^[\p{Script=Han}\s，。！？、,.!?；;：“”"'（）()]+$/u;
const HAN_CHARACTER_RE = /\p{Script=Han}/u;
const AUDIO_FORMAT_BY_MIME_TYPE = new Map([
  ['audio/webm', 'webm'],
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/mp4', 'mp4'],
  ['audio/ogg', 'ogg'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/wav', 'wav'],
]);
const MIN_AUDIO_BYTES = 256;
const MAX_AUDIO_BYTES = 1_000_000;
const MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
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
  const value = text.trim();
  if (!value) return null;

  const direct = tryParseJsonObject(value);
  if (direct) return direct;

  // qwen3.5-omni-flash 实测会在 JSON 结尾多输出一行孤立的 ```（没有开头围栏），
  // 直接 JSON.parse 必然失败。退回到“第一个 { 到最后一个 }”的子串再解析一次；
  // 严格性由调用方解析后的字段校验保证。
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return tryParseJsonObject(value.slice(start, end + 1));
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
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
  if (audio.length < MIN_AUDIO_BYTES) {
    throw new RequestValidationError('音频太短，请重新录音');
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new RequestValidationError('音频不能超过 1 MB');
  }

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
