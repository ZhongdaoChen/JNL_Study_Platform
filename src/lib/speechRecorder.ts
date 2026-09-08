const SILENCE_MS = 800;
const MAX_RECORDING_MS = 6_000;
const SPEECH_RMS_THRESHOLD = 0.035;
const MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

type RecorderListener = (event?: { data?: Blob; error?: unknown }) => void;

interface MediaStreamTrackLike {
  readyState?: string;
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): MediaStreamTrackLike[];
}

interface MediaRecorderLike {
  readonly mimeType: string;
  readonly state: string;
  addEventListener(type: 'dataavailable' | 'stop' | 'error', listener: RecorderListener): void;
  removeEventListener(type: 'dataavailable' | 'stop' | 'error', listener: RecorderListener): void;
  start(): void;
  stop(): void;
}

interface AnalyserLike {
  fftSize: number;
  getFloatTimeDomainData(buffer: Float32Array): void;
}

interface MediaStreamSourceLike {
  connect(target: any): unknown;
  disconnect?(): void;
}

interface AudioContextLike {
  createAnalyser(): AnalyserLike;
  createMediaStreamSource(stream: MediaStreamLike): MediaStreamSourceLike;
  close(): Promise<void>;
}

export interface RecordedSpeech {
  blob: Blob;
  mimeType: string;
}

export interface SpeechRecorderSession {
  start(onAutoStop: () => void): Promise<void>;
  stop(): Promise<RecordedSpeech>;
  dispose(): void;
  readonly isRecording: boolean;
}

export interface SilenceState {
  recordingStartedAtMs: number;
  speechStartedAtMs: number | null;
  silenceStartedAtMs: number | null;
  shouldStop: boolean;
}

export interface SpeechRecorderDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
  createMediaRecorder(stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
  isMimeTypeSupported(mime: string): boolean;
  createAudioContext(): AudioContextLike;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
  now(): number;
}

interface ActiveRecording {
  readonly stream: MediaStreamLike;
  readonly recorder: MediaRecorderLike;
  readonly mimeType: string;
  readonly chunks: Blob[];
  readonly analyser: AnalyserLike;
  readonly source: MediaStreamSourceLike;
  readonly sampleBuffer: Float32Array;
  readonly onAutoStop: () => void;
  onDataAvailable: RecorderListener;
  onStop: RecorderListener;
  onError: RecorderListener;
  audioContext: AudioContextLike | null;
  animationFrameId: number | null;
  hardTimeoutId: number | null;
  silenceState: SilenceState;
  stopPromise: Promise<RecordedSpeech> | null;
  resolveStop: ((value: RecordedSpeech) => void) | null;
  rejectStop: ((reason?: unknown) => void) | null;
  closeAudioContextPromise: Promise<void> | null;
  autoStopNotified: boolean;
  finalizing: boolean;
  stopStreamOnFinalize: boolean;
}

export function createSpeechRecorderSession(
  providedDependencies: Partial<SpeechRecorderDependencies> = {},
): SpeechRecorderSession {
  const dependencies = {
    ...createDefaultDependencies(),
    ...providedDependencies,
  } satisfies SpeechRecorderDependencies;
  let liveStream: MediaStreamLike | null = null;
  let activeRecording: ActiveRecording | null = null;
  let lastStopPromise: Promise<RecordedSpeech> | null = null;
  let pendingStart: { cancelled: boolean } | null = null;
  let recording = false;

  return {
    get isRecording() {
      return recording;
    },

    async start(onAutoStop: () => void): Promise<void> {
      if (activeRecording !== null || pendingStart !== null) {
        throw new Error('Speech recorder is already active.');
      }

      lastStopPromise = null;
      const startAttempt = { cancelled: false };
      pendingStart = startAttempt;
      let stream = liveStream;
      let currentRecording: ActiveRecording | null = null;

      try {
        if (!hasLiveTracks(stream)) {
          stream = await dependencies.getUserMedia({ audio: true });
        }
        if (startAttempt.cancelled) {
          throw new Error('Speech recorder was disposed during startup.');
        }
        if (stream === null) {
          throw new Error('Failed to open microphone stream.');
        }
        liveStream = stream;

        const mimeType = selectRecordingMimeType(dependencies.isMimeTypeSupported);
        const recorder = dependencies.createMediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        const audioContext = dependencies.createAudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const startedAtMs = dependencies.now();
        const onDataAvailable: RecorderListener = (event) => {
          const chunk = event?.data;
          if (chunk instanceof Blob && chunk.size > 0) {
            currentRecording?.chunks.push(chunk);
          }
        };
        const onStop: RecorderListener = () => {
          void finalizeRecording(currentRecording);
        };
        const onError: RecorderListener = (event) => {
          const error = event?.error ?? new Error('Speech recording failed.');
          void finalizeRecording(currentRecording, error);
        };
        currentRecording = {
          stream,
          recorder,
          mimeType,
          chunks: [],
          analyser,
          source,
          sampleBuffer: new Float32Array(Math.max(analyser.fftSize || 0, 32)),
          onAutoStop,
          audioContext,
          animationFrameId: null,
          hardTimeoutId: null,
          silenceState: {
            recordingStartedAtMs: startedAtMs,
            speechStartedAtMs: null,
            silenceStartedAtMs: null,
            shouldStop: false,
          },
          stopPromise: null,
          resolveStop: null,
          rejectStop: null,
          closeAudioContextPromise: null,
          autoStopNotified: false,
          finalizing: false,
          stopStreamOnFinalize: false,
          onDataAvailable,
          onStop,
          onError,
        };

        recorder.addEventListener('dataavailable', onDataAvailable);
        recorder.addEventListener('stop', onStop);
        recorder.addEventListener('error', onError);

        activeRecording = currentRecording;
        recording = true;
        recorder.start();
        const recordingEntry = currentRecording;
        recordingEntry.hardTimeoutId = dependencies.setTimeout(() => {
          if (activeRecording !== recordingEntry || recordingEntry.autoStopNotified) return;
          recordingEntry.autoStopNotified = true;
          void stopRecording(recordingEntry).catch(() => {});
          recordingEntry.onAutoStop();
        }, MAX_RECORDING_MS);
        scheduleNextAnalysisFrame(recordingEntry);
      } catch (error) {
        recording = false;
        activeRecording = null;
        await cleanupFailedStart(currentRecording, stream);
        throw error;
      } finally {
        if (pendingStart === startAttempt) {
          pendingStart = null;
        }
      }
    },

    stop(): Promise<RecordedSpeech> {
      if (activeRecording !== null) {
        return stopRecording(activeRecording);
      }
      if (lastStopPromise !== null) {
        return lastStopPromise;
      }
      return Promise.reject(new Error('Speech recorder is not active.'));
    },

    dispose(): void {
      lastStopPromise = null;
      if (pendingStart !== null) {
        pendingStart.cancelled = true;
      }
      if (activeRecording !== null) {
        activeRecording.stopStreamOnFinalize = true;
        void stopRecording(activeRecording).catch(() => {});
        return;
      }
      stopTracks(liveStream);
      liveStream = null;
      recording = false;
    },
  };

  function scheduleNextAnalysisFrame(recordingState: ActiveRecording): void {
    recordingState.animationFrameId = dependencies.requestAnimationFrame(() => {
      if (activeRecording !== recordingState) return;

      recordingState.analyser.getFloatTimeDomainData(recordingState.sampleBuffer);
      const rms = rootMeanSquare(recordingState.sampleBuffer);
      recordingState.silenceState = updateSilenceState(
        recordingState.silenceState,
        rms,
        dependencies.now(),
      );

      if (recordingState.silenceState.shouldStop) {
        if (!recordingState.autoStopNotified) {
          recordingState.autoStopNotified = true;
          void stopRecording(recordingState).catch(() => {});
          recordingState.onAutoStop();
        }
        return;
      }

      scheduleNextAnalysisFrame(recordingState);
    });
  }

  function stopRecording(recordingState: ActiveRecording): Promise<RecordedSpeech> {
    if (recordingState.stopPromise !== null) {
      lastStopPromise = recordingState.stopPromise;
      return recordingState.stopPromise;
    }

    recording = false;
    recordingState.stopPromise = new Promise<RecordedSpeech>((resolve, reject) => {
      recordingState.resolveStop = resolve;
      recordingState.rejectStop = reject;
    });
    lastStopPromise = recordingState.stopPromise;

    void releaseAnalysisResources(recordingState);

    try {
      if (recordingState.recorder.state === 'inactive') {
        void finalizeRecording(recordingState);
      } else {
        recordingState.recorder.stop();
      }
    } catch (error) {
      void finalizeRecording(recordingState, error);
    }

    return recordingState.stopPromise;
  }

  async function finalizeRecording(
    recordingState: ActiveRecording | null,
    error?: unknown,
  ): Promise<void> {
    if (recordingState === null || recordingState.finalizing) return;
    recordingState.finalizing = true;
    recording = false;

    if (activeRecording === recordingState) {
      activeRecording = null;
    }

    if (recordingState.stopPromise === null) {
      recordingState.stopPromise = new Promise<RecordedSpeech>((resolve, reject) => {
        recordingState.resolveStop = resolve;
        recordingState.rejectStop = reject;
      });
      lastStopPromise = recordingState.stopPromise;
      void recordingState.stopPromise.catch(() => {});
    }

    const shouldStopRecordingStream = recordingState.stopStreamOnFinalize || error !== undefined;
    const streamToStop = shouldStopRecordingStream ? recordingState.stream : null;
    if (streamToStop !== null && liveStream === streamToStop) {
      liveStream = null;
    }

    await releaseAnalysisResources(recordingState);
    detachRecorderListeners(recordingState);

    if (recordingState.stopStreamOnFinalize) {
      stopTracks(streamToStop);
    }

    if (error !== undefined) {
      stopTracks(streamToStop);
      recordingState.rejectStop?.(asError(error));
      return;
    }

    const resolvedMimeType = recordingState.recorder.mimeType
      || recordingState.mimeType
      || recordingState.chunks.find((chunk) => chunk.type)?.type
      || '';
    const blob = new Blob(recordingState.chunks, resolvedMimeType ? { type: resolvedMimeType } : undefined);
    if (blob.size === 0) {
      recordingState.rejectStop?.(new Error('录音内容为空'));
      return;
    }

    recordingState.resolveStop?.({
      blob,
      mimeType: resolvedMimeType || blob.type,
    });
  }

  function detachRecorderListeners(recordingState: ActiveRecording): void {
    recordingState.recorder.removeEventListener('dataavailable', recordingState.onDataAvailable);
    recordingState.recorder.removeEventListener('stop', recordingState.onStop);
    recordingState.recorder.removeEventListener('error', recordingState.onError);
  }

  function releaseAnalysisResources(recordingState: ActiveRecording): Promise<void> {
    if (recordingState.animationFrameId !== null) {
      dependencies.cancelAnimationFrame(recordingState.animationFrameId);
      recordingState.animationFrameId = null;
    }
    if (recordingState.hardTimeoutId !== null) {
      dependencies.clearTimeout(recordingState.hardTimeoutId);
      recordingState.hardTimeoutId = null;
    }

    recordingState.source.disconnect?.();

    if (recordingState.closeAudioContextPromise !== null) {
      return recordingState.closeAudioContextPromise;
    }

    const audioContext = recordingState.audioContext;
    recordingState.audioContext = null;
    recordingState.closeAudioContextPromise = audioContext
      ? audioContext.close().catch(() => {})
      : Promise.resolve();
    return recordingState.closeAudioContextPromise;
  }

  function stopTracks(stream: MediaStreamLike | null): void {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }

  async function cleanupFailedStart(
    recordingState: ActiveRecording | null,
    stream: MediaStreamLike | null,
  ): Promise<void> {
    if (recordingState !== null) {
      detachRecorderListeners(recordingState);
      recordingState.source.disconnect?.();
      if (recordingState.audioContext !== null) {
        await recordingState.audioContext.close().catch(() => {});
        recordingState.audioContext = null;
      }
    }

    stopTracks(stream);
    if (liveStream === stream) {
      liveStream = null;
    }
  }
}

export function selectRecordingMimeType(isSupported: (mime: string) => boolean): string {
  for (const mimeType of MIME_TYPE_CANDIDATES) {
    if (isSupported(mimeType)) return mimeType;
  }
  return '';
}

export function updateSilenceState(
  state: SilenceState,
  signalRms: number,
  nowMs: number,
): SilenceState {
  if (state.shouldStop) return state;

  if (nowMs - state.recordingStartedAtMs >= MAX_RECORDING_MS) {
    return { ...state, shouldStop: true };
  }

  if (signalRms >= SPEECH_RMS_THRESHOLD) {
    return {
      ...state,
      speechStartedAtMs: state.speechStartedAtMs ?? nowMs,
      silenceStartedAtMs: null,
      shouldStop: false,
    };
  }

  if (state.speechStartedAtMs === null) {
    return {
      ...state,
      silenceStartedAtMs: null,
      shouldStop: false,
    };
  }

  const silenceStartedAtMs = state.silenceStartedAtMs ?? nowMs;
  return {
    ...state,
    silenceStartedAtMs,
    shouldStop: nowMs - silenceStartedAtMs >= SILENCE_MS,
  };
}

function rootMeanSquare(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sumSquares = 0;
  for (const value of values) {
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / values.length);
}

function hasLiveTracks(stream: MediaStreamLike | null): boolean {
  if (stream === null) return false;
  return stream.getTracks().some((track) => track.readyState !== 'ended');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Speech recording failed.', { cause: error });
}

function createDefaultDependencies(): SpeechRecorderDependencies {
  return {
    getUserMedia: async (constraints) => {
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support audio recording.');
      }
      return await mediaDevices.getUserMedia(constraints);
    },
    createMediaRecorder: (stream, options) => {
      const MediaRecorderConstructor = globalThis.MediaRecorder;
      if (!MediaRecorderConstructor) {
        throw new Error('This browser does not support audio recording.');
      }
      return new MediaRecorderConstructor(stream as MediaStream, options);
    },
    isMimeTypeSupported: (mime) => globalThis.MediaRecorder?.isTypeSupported?.(mime) ?? false,
    createAudioContext: () => {
      const AudioContextConstructor = globalThis.AudioContext
        ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error('This browser does not support microphone analysis.');
      }
      return new AudioContextConstructor();
    },
    requestAnimationFrame: (callback) => globalThis.requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => globalThis.cancelAnimationFrame(id),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    now: () => globalThis.performance.now(),
  };
}
