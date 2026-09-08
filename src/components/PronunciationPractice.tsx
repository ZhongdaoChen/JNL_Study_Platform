import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assessPronunciation,
  generatePronunciationExamples,
  synthesizePronunciation,
} from '../lib/pronunciationApi';
import {
  isSingleHanCharacter,
  pronunciationPlaybackItems,
  sanitizePronunciationExamples,
} from '../lib/pronunciationRules';
import {
  createSpeechRecorderSession,
  type SpeechRecorderSession,
} from '../lib/speechRecorder';
import type { Word } from '../lib/types';
import {
  advancePronunciationPlayback,
  beginPronunciationOutcome,
  cancelPendingPronunciationSuccess,
  finalizePendingPronunciationSuccess,
  startPronunciationPlayback,
} from './pronunciationSession';

export type PronunciationStatus =
  | 'idle'
  | 'requesting-permission'
  | 'listening'
  | 'assessing'
  | 'correct'
  | 'incorrect'
  | 'error';

export interface PronunciationPracticeProps {
  word: Word;
  onExamplesChanged(wordId: string, examples: string[]): void;
  onVoiceGrade(grade: 'mastered' | 'forgotten', advance: boolean): void;
}

interface TtsRequest {
  key: string;
  promise: Promise<Map<string, string> | null>;
}

export default function PronunciationPractice({
  word,
  onExamplesChanged,
  onVoiceGrade,
}: PronunciationPracticeProps) {
  const [uiWordId, setUiWordId] = useState(word.id);
  const [status, setStatus] = useState<PronunciationStatus>('idle');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [examples, setExamples] = useState<string[]>(() => validExamples(word));
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [advancePending, setAdvancePending] = useState(false);

  const recorderRef = useRef<SpeechRecorderSession | null>(null);
  const mountedRef = useRef(false);
  const wordRef = useRef(word);
  const currentWordIdRef = useRef(word.id);
  const onExamplesChangedRef = useRef(onExamplesChanged);
  const onVoiceGradeRef = useRef(onVoiceGrade);
  const gradedWordIdsRef = useRef(new Set<string>());
  const pendingSuccessWordIdsRef = useRef(new Set<string>());
  const recordingRequestRef = useRef(0);
  const assessmentRequestRef = useRef(0);
  const exampleRequestRef = useRef(0);
  const ttsRequestRef = useRef(0);
  const playbackRequestRef = useRef(0);
  const advanceTimeoutRef = useRef<number | null>(null);
  const pendingAdvanceWordIdRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const recorderStartingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelAudioWaitRef = useRef<(() => void) | null>(null);
  const examplesRef = useRef(validExamples(word));
  const ttsUrlsRef = useRef(new Map<string, string>());
  const ttsInFlightRef = useRef<TtsRequest | null>(null);

  useEffect(() => {
    wordRef.current = word;
    onExamplesChangedRef.current = onExamplesChanged;
    onVoiceGradeRef.current = onVoiceGrade;
  }, [onExamplesChanged, onVoiceGrade, word]);

  const clearAdvanceTimeout = useCallback(() => {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
    const pendingWordId = pendingAdvanceWordIdRef.current;
    if (pendingWordId !== null) {
      cancelPendingPronunciationSuccess(pendingSuccessWordIdsRef.current, pendingWordId);
      pendingAdvanceWordIdRef.current = null;
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    playbackRequestRef.current += 1;
    cancelAudioWaitRef.current?.();
    cancelAudioWaitRef.current = null;
    if (audioRef.current !== null) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    stopAudioPlayback();
    setPlayingIndex(null);
    setIsPlaying(false);
  }, [stopAudioPlayback]);

  const invalidateRequests = useCallback(() => {
    recordingRequestRef.current += 1;
    assessmentRequestRef.current += 1;
    exampleRequestRef.current += 1;
    ttsRequestRef.current += 1;
    ttsInFlightRef.current = null;
  }, []);

  const isCurrentRequest = useCallback((
    requestRef: { current: number },
    requestId: number,
    wordId: string,
  ): boolean => (
    mountedRef.current
      && requestRef.current === requestId
      && currentWordIdRef.current === wordId
  ), []);

  const generateExamples = useCallback(async (targetWord: Word): Promise<void> => {
    if (!isSingleHanCharacter(targetWord.text)) return;
    const requestId = exampleRequestRef.current + 1;
    exampleRequestRef.current = requestId;
    setExamplesLoading(true);
    setExamplesError(null);
    try {
      const generated = await generatePronunciationExamples(targetWord.text);
      if (!isCurrentRequest(exampleRequestRef, requestId, targetWord.id)) return;
      const latestWord = wordRef.current;
      if (latestWord.id !== targetWord.id) return;
      examplesRef.current = generated;
      setExamples(generated);
      onExamplesChangedRef.current(targetWord.id, generated);
    } catch (error: unknown) {
      if (isCurrentRequest(exampleRequestRef, requestId, targetWord.id)) {
        setExamplesError(messageFor(error, '辅助词准备失败'));
      }
    } finally {
      if (isCurrentRequest(exampleRequestRef, requestId, targetWord.id)) {
        setExamplesLoading(false);
      }
    }
  }, [isCurrentRequest]);

  useEffect(() => {
    mountedRef.current = true;
    const recorder = createSpeechRecorderSession();
    recorderRef.current = recorder;

    function handleVisibilityChange() {
      if (document.visibilityState !== 'hidden') return;
      recordingRequestRef.current += 1;
      assessmentRequestRef.current += 1;
      ttsRequestRef.current += 1;
      ttsInFlightRef.current = null;
      clearAdvanceTimeout();
      stopPlayback();
      stoppingRef.current = true;
      if (recorder.isRecording) void recorder.stop().catch(() => {});
      setStatus('idle');
      setFeedback(null);
      setTtsLoading(false);
      setAdvancePending(false);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      mountedRef.current = false;
      invalidateRequests();
      clearAdvanceTimeout();
      stopAudioPlayback();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      recorder.dispose();
      if (recorderRef.current === recorder) recorderRef.current = null;
    };
  }, [clearAdvanceTimeout, invalidateRequests, stopAudioPlayback, stopPlayback]);

  useEffect(() => {
    currentWordIdRef.current = word.id;
    invalidateRequests();
    clearAdvanceTimeout();
    stopAudioPlayback();
    stoppingRef.current = true;
    ttsUrlsRef.current.clear();

    const recorder = recorderRef.current;
    if (recorder?.isRecording) void recorder.stop().catch(() => {});

    const currentWord = wordRef.current;
    const savedExamples = validExamples(currentWord);
    examplesRef.current = savedExamples;

    const resetTimer = window.setTimeout(() => {
      if (currentWordIdRef.current !== currentWord.id) return;
      setUiWordId(currentWord.id);
      setStatus('idle');
      setFeedback(null);
      setPlayingIndex(null);
      setIsPlaying(false);
      setTtsError(null);
      setTtsLoading(false);
      setAdvancePending(false);
      setExamples(savedExamples);
      setExamplesError(null);
      if (!isSingleHanCharacter(currentWord.text) || savedExamples.length === 3) {
        setExamplesLoading(false);
        return;
      }
      void generateExamples(currentWord);
    }, 0);

    return () => window.clearTimeout(resetTimer);
  }, [
    clearAdvanceTimeout,
    generateExamples,
    invalidateRequests,
    stopAudioPlayback,
    word.id,
  ]);

  function retryExamples() {
    void generateExamples(wordRef.current);
  }

  async function handleMicrophoneClick(): Promise<void> {
    if (status === 'listening') {
      await finishRecording(
        recordingRequestRef.current,
        currentWordIdRef.current,
        wordRef.current.text,
      );
      return;
    }
    if (
      status === 'requesting-permission'
      || status === 'assessing'
      || advancePending
      || pendingAdvanceWordIdRef.current === currentWordIdRef.current
    ) {
      return;
    }

    const recorder = recorderRef.current;
    if (recorder === null) {
      setStatus('error');
      setFeedback('当前浏览器不支持语音练习');
      return;
    }
    if (recorderStartingRef.current) {
      setStatus('requesting-permission');
      setFeedback('麦克风正在准备，请稍候');
      return;
    }

    stopPlayback();
    clearAdvanceTimeout();
    setAdvancePending(false);
    setTtsError(null);
    setFeedback(null);
    setStatus('requesting-permission');
    stoppingRef.current = false;
    recorderStartingRef.current = true;

    const targetWord = wordRef.current;
    const requestId = recordingRequestRef.current + 1;
    recordingRequestRef.current = requestId;
    try {
      await recorder.start(() => {
        void finishRecording(requestId, targetWord.id, targetWord.text);
      });
      if (!isCurrentRequest(recordingRequestRef, requestId, targetWord.id)) {
        if (recorder.isRecording) await recorder.stop().catch(() => {});
        if (mountedRef.current && currentWordIdRef.current !== targetWord.id) {
          setStatus('idle');
          setFeedback(null);
        }
        return;
      }
      setStatus('listening');
      setFeedback('正在听，请读出上面的内容');
    } catch (error: unknown) {
      if (isCurrentRequest(recordingRequestRef, requestId, targetWord.id)) {
        setStatus('error');
        setFeedback(recordingErrorMessage(error));
      }
    } finally {
      recorderStartingRef.current = false;
    }
  }

  async function finishRecording(
    recordingRequestId: number,
    wordId: string,
    target: string,
  ): Promise<void> {
    if (
      stoppingRef.current
      || !isCurrentRequest(recordingRequestRef, recordingRequestId, wordId)
    ) {
      return;
    }
    const recorder = recorderRef.current;
    if (recorder === null) return;

    stoppingRef.current = true;
    setStatus('assessing');
    setFeedback('正在判断发音…');
    try {
      const recording = await recorder.stop();
      if (!isCurrentRequest(recordingRequestRef, recordingRequestId, wordId)) return;
      if (recording.blob.size > 1_000_000) {
        throw new Error('录音过大，请缩短朗读时间');
      }

      const assessmentRequestId = assessmentRequestRef.current + 1;
      assessmentRequestRef.current = assessmentRequestId;
      const assessment = await assessPronunciation(target, recording.blob);
      if (!isCurrentRequest(assessmentRequestRef, assessmentRequestId, wordId)) return;

      const outcome = beginPronunciationOutcome(
        gradedWordIdsRef.current,
        pendingSuccessWordIdsRef.current,
        wordId,
        assessment.correct,
      );
      setStatus(assessment.correct ? 'correct' : 'incorrect');
      setFeedback(outcome.message);

      if (outcome.grade === 'forgotten') {
        onVoiceGradeRef.current('forgotten', false);
      } else if (outcome.grade === 'mastered' && outcome.advanceAfterMs !== null) {
        setAdvancePending(true);
        pendingAdvanceWordIdRef.current = wordId;
        advanceTimeoutRef.current = window.setTimeout(() => {
          advanceTimeoutRef.current = null;
          const shouldSubmit = (
            mountedRef.current
            && currentWordIdRef.current === wordId
            && assessmentRequestRef.current === assessmentRequestId
          );
          if (shouldSubmit && finalizePendingPronunciationSuccess(
            gradedWordIdsRef.current,
            pendingSuccessWordIdsRef.current,
            wordId,
          )) {
            pendingAdvanceWordIdRef.current = null;
            setAdvancePending(false);
            onVoiceGradeRef.current('mastered', true);
          } else {
            cancelPendingPronunciationSuccess(pendingSuccessWordIdsRef.current, wordId);
            if (pendingAdvanceWordIdRef.current === wordId) {
              pendingAdvanceWordIdRef.current = null;
            }
            if (mountedRef.current && currentWordIdRef.current === wordId) {
              setAdvancePending(false);
            }
          }
        }, outcome.advanceAfterMs);
      }

      if (!assessment.correct) {
        const items = pronunciationPlaybackItems(target, examplesForWord(wordId));
        void ensureSynthesisUrls(wordId, items);
      }
    } catch (error: unknown) {
      if (isCurrentRequest(recordingRequestRef, recordingRequestId, wordId)) {
        setStatus('error');
        setFeedback(messageFor(error, '没有听清，请再试一次'));
      }
    } finally {
      if (recordingRequestRef.current === recordingRequestId) {
        stoppingRef.current = false;
      }
    }
  }

  function examplesForWord(wordId: string): string[] {
    return currentWordIdRef.current === wordId ? examplesRef.current : [];
  }

  async function ensureSynthesisUrls(
    wordId: string,
    items: string[],
  ): Promise<Map<string, string> | null> {
    if (items.every((item) => ttsUrlsRef.current.has(item))) {
      return new Map(ttsUrlsRef.current);
    }

    const key = `${wordId}\u0000${items.join('\u0000')}`;
    if (ttsInFlightRef.current?.key === key) return ttsInFlightRef.current.promise;

    const requestId = ttsRequestRef.current + 1;
    ttsRequestRef.current = requestId;
    setTtsLoading(true);
    setTtsError(null);

    const promise = (async () => {
      try {
        const pairs = await Promise.all(
          items.map(async (item) => [item, await synthesizePronunciation(item)] as const),
        );
        if (!isCurrentRequest(ttsRequestRef, requestId, wordId)) return null;
        const urls = new Map(pairs);
        ttsUrlsRef.current = urls;
        return urls;
      } catch (error: unknown) {
        if (isCurrentRequest(ttsRequestRef, requestId, wordId)) {
          setTtsError(messageFor(error, '正确读音加载失败，请重试'));
        }
        return null;
      } finally {
        if (isCurrentRequest(ttsRequestRef, requestId, wordId)) {
          setTtsLoading(false);
          ttsInFlightRef.current = null;
        }
      }
    })();

    ttsInFlightRef.current = { key, promise };
    return promise;
  }

  async function playCorrectPronunciation(): Promise<void> {
    const targetWord = wordRef.current;
    const items = pronunciationPlaybackItems(
      targetWord.text,
      examplesForWord(targetWord.id),
    );
    stopPlayback();
    const playbackRequestId = playbackRequestRef.current;
    setIsPlaying(true);
    setTtsError(null);

    const urls = await ensureSynthesisUrls(targetWord.id, items);
    if (
      urls === null
      || playbackRequestRef.current !== playbackRequestId
      || currentWordIdRef.current !== targetWord.id
    ) {
      if (playbackRequestRef.current === playbackRequestId) setIsPlaying(false);
      return;
    }

    let playbackState = startPronunciationPlayback(targetWord.text, examplesForWord(targetWord.id));
    try {
      while (playbackState.playingIndex !== null) {
        if (
          playbackRequestRef.current !== playbackRequestId
          || currentWordIdRef.current !== targetWord.id
        ) {
          return;
        }
        setPlayingIndex(playbackState.playingIndex);
        const item = playbackState.items[playbackState.playingIndex];
        const url = urls.get(item);
        if (!url) throw new Error('正确读音加载失败，请重试');
        await playAudio(url);
        playbackState = advancePronunciationPlayback(playbackState);
      }
    } catch (error: unknown) {
      if (
        playbackRequestRef.current === playbackRequestId
        && currentWordIdRef.current === targetWord.id
      ) {
        setTtsError(messageFor(error, '正确读音播放失败，请重试'));
      }
    } finally {
      if (playbackRequestRef.current === playbackRequestId) {
        setPlayingIndex(null);
        setIsPlaying(false);
      }
    }
  }

  function playAudio(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      let settled = false;

      const cleanup = () => {
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
        if (audioRef.current === audio) audioRef.current = null;
        if (cancelAudioWaitRef.current === cancel) cancelAudioWaitRef.current = null;
      };
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        action();
      };
      const handleEnded = () => finish(resolve);
      const handleError = () => finish(() => reject(new Error('正确读音播放失败，请重试')));
      const cancel = () => {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        finish(resolve);
      };

      audio.addEventListener('ended', handleEnded, { once: true });
      audio.addEventListener('error', handleError, { once: true });
      cancelAudioWaitRef.current = cancel;
      void audio.play().catch(handleError);
    });
  }

  const isSingleCharacter = isSingleHanCharacter(word.text);
  const uiMatchesWord = uiWordId === word.id;
  const visibleStatus = uiMatchesWord ? status : 'idle';
  const visibleFeedback = uiMatchesWord ? feedback : null;
  const visibleExamples = uiMatchesWord ? examples : validExamples(word);
  const visibleExamplesLoading = uiMatchesWord
    ? examplesLoading
    : isSingleCharacter && visibleExamples.length < 3;
  const visibleExamplesError = uiMatchesWord ? examplesError : null;
  const visiblePlayingIndex = uiMatchesWord ? playingIndex : null;
  const microphoneDisabled = !uiMatchesWord
    || visibleStatus === 'requesting-permission'
    || visibleStatus === 'assessing'
    || advancePending;
  const microphoneLabel = visibleStatus === 'listening'
    ? '停止并提交'
    : visibleStatus === 'incorrect' || visibleStatus === 'error'
      ? '再试一次'
      : visibleStatus === 'correct'
        ? '再读一次'
        : '开始朗读';

  return (
    <section
      className="pronunciation-practice"
      aria-label="发音练习"
      aria-busy={visibleStatus === 'requesting-permission' || visibleStatus === 'assessing'}
      data-playing-target={visiblePlayingIndex === 0 ? 'true' : undefined}
    >
      <div className="pronunciation-controls">
        <button
          type="button"
          className={`pronunciation-mic-btn${visibleStatus === 'listening' ? ' listening' : ''}`}
          onClick={() => void handleMicrophoneClick()}
          disabled={microphoneDisabled}
          aria-pressed={visibleStatus === 'listening'}
          aria-label={microphoneLabel}
        >
          <MicrophoneIcon stopped={visibleStatus === 'listening'} />
          <span>{microphoneLabel}</span>
        </button>

        {visibleStatus === 'incorrect' && (
          <button
            type="button"
            className="pronunciation-play-btn"
            onClick={() => void playCorrectPronunciation()}
            disabled={ttsLoading || isPlaying}
          >
            <SpeakerIcon />
            <span>{isPlaying ? '正在播放' : ttsLoading ? '正在准备' : '听正确读音'}</span>
          </button>
        )}
      </div>

      <div
        className={`pronunciation-feedback ${visibleStatus}`}
        role={visibleStatus === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {visibleFeedback ?? '点一下麦克风，读出上面的内容'}
      </div>

      {visibleStatus === 'correct' && (
        <div className="pronunciation-fireworks" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
        </div>
      )}

      {ttsError && <p className="pronunciation-error" role="alert">{ttsError}</p>}

      {isSingleCharacter && (
        <div className="pronunciation-examples" aria-label="辅助词">
          {visibleExamplesLoading ? (
            <span className="pronunciation-example-status">正在准备词语…</span>
          ) : visibleExamplesError ? (
            <span className="pronunciation-example-status">
              {visibleExamplesError}
              {' '}
              <button type="button" className="link-btn" onClick={retryExamples}>
                重新生成
              </button>
            </span>
          ) : (
            visibleExamples.map((example, index) => (
              <span
                className={`pronunciation-example${visiblePlayingIndex === index + 1 ? ' playing' : ''}`}
                key={example}
              >
                <HighlightedExample text={example} target={word.text} />
              </span>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function HighlightedExample({ text, target }: { text: string; target: string }) {
  const parts = text.split(target);
  return (
    <span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 && <mark>{target}</mark>}
          {part}
        </span>
      ))}
    </span>
  );
}

function MicrophoneIcon({ stopped }: { stopped: boolean }) {
  return stopped ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 4V5L9 9H5Z" />
      <path d="M17 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

function validExamples(word: Word): string[] {
  return sanitizePronunciationExamples(word.text, word.pronunciationExamples);
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function recordingErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '请在浏览器设置中允许麦克风权限后重试';
    }
    if (error.name === 'NotFoundError') return '没有找到可用的麦克风';
  }
  const message = messageFor(error, '');
  if (message.includes('does not support')) return '当前浏览器不支持语音练习';
  return message || '麦克风启动失败，请重试';
}
