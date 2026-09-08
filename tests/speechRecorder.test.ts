import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeechRecorderSession,
  selectRecordingMimeType,
  updateSilenceState,
} from '../src/lib/speechRecorder.ts';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';

  stopCalls = 0;

  stop(): void {
    this.stopCalls += 1;
    this.readyState = 'ended';
  }
}

class FakeMediaStream {
  readonly tracks: FakeTrack[];

  constructor(tracks: FakeTrack[] = [new FakeTrack()]) {
    this.tracks = tracks;
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

type RecorderListener = (event?: { data?: Blob; error?: unknown }) => void;

class FakeMediaRecorder {
  readonly stream: FakeMediaStream;

  readonly mimeType: string;

  state: 'inactive' | 'recording' = 'inactive';

  stopCalls = 0;

  readonly #listeners = new Map<string, Set<RecorderListener>>();

  constructor(stream: FakeMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? '';
  }

  addEventListener(type: string, listener: RecorderListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<RecorderListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: RecorderListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.stopCalls += 1;
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    queueMicrotask(() => this.emit('stop'));
  }

  emitData(blob: Blob): void {
    this.emit('dataavailable', { data: blob });
  }

  emitError(error: unknown): void {
    this.emit('error', { error });
  }

  private emit(type: string, event: { data?: Blob; error?: unknown } = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

class FakeAnalyser {
  fftSize = 32;

  #index = 0;

  private readonly rmsValues: number[];

  constructor(rmsValues: number[]) {
    this.rmsValues = rmsValues;
  }

  getFloatTimeDomainData(buffer: Float32Array): void {
    const amplitude = this.rmsValues[this.#index] ?? this.rmsValues.at(-1) ?? 0;
    buffer.fill(amplitude);
    this.#index += 1;
  }
}

class FakeMediaStreamSource {
  disconnected = false;

  readonly stream: FakeMediaStream;

  constructor(stream: FakeMediaStream) {
    this.stream = stream;
  }

  connect(_target: FakeAnalyser): void {}

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeAudioContext {
  readonly analyser: FakeAnalyser;

  source: FakeMediaStreamSource | null = null;

  closeCalls = 0;

  constructor(rmsValues: number[]) {
    this.analyser = new FakeAnalyser(rmsValues);
  }

  createAnalyser(): FakeAnalyser {
    return this.analyser;
  }

  createMediaStreamSource(stream: FakeMediaStream): FakeMediaStreamSource {
    this.source = new FakeMediaStreamSource(stream);
    return this.source;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeAnimationFrames {
  currentTime = 0;

  nextId = 1;

  readonly pending = new Map<number, FrameRequestCallback>();

  readonly cancelled = new Set<number>();

  request = (callback: FrameRequestCallback): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, callback);
    return id;
  };

  cancel = (id: number): void => {
    this.cancelled.add(id);
    this.pending.delete(id);
  };

  tick(time: number): void {
    this.currentTime = time;
    const callbacks = [...this.pending.entries()];
    this.pending.clear();
    for (const [, callback] of callbacks) callback(time);
  }
}

class FakeTimeouts {
  nextId = 1;

  readonly pending = new Map<number, () => void>();

  readonly cancelled = new Set<number>();

  setTimeout = (callback: () => void): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, callback);
    return id;
  };

  clearTimeout = (id: number): void => {
    this.cancelled.add(id);
    this.pending.delete(id);
  };

  runAll(): void {
    const callbacks = [...this.pending.entries()];
    this.pending.clear();
    for (const [, callback] of callbacks) callback();
  }
}

function createHarness(options: {
  supportedMimeTypes?: string[];
  rmsRuns?: number[][];
  getUserMedia?: () => Promise<FakeMediaStream>;
  createAudioContext?: () => FakeAudioContext;
} = {}) {
  const stream = new FakeMediaStream();
  const mediaDevices = {
    calls: 0,
    async getUserMedia(): Promise<FakeMediaStream> {
      this.calls += 1;
      if (options.getUserMedia) return options.getUserMedia();
      return stream;
    },
  };
  const frames = new FakeAnimationFrames();
  const timeouts = new FakeTimeouts();
  const recorders: FakeMediaRecorder[] = [];
  const audioContexts: FakeAudioContext[] = [];
  let runIndex = 0;
  const session = createSpeechRecorderSession({
    getUserMedia: () => mediaDevices.getUserMedia(),
    createMediaRecorder: (liveStream, recorderOptions) => {
      const recorder = new FakeMediaRecorder(liveStream as FakeMediaStream, recorderOptions);
      recorders.push(recorder);
      return recorder;
    },
    isMimeTypeSupported: (mime) => (options.supportedMimeTypes ?? ['audio/webm;codecs=opus']).includes(mime),
    createAudioContext: () => {
      if (options.createAudioContext) return options.createAudioContext();
      const audioContext = new FakeAudioContext(options.rmsRuns?.[runIndex] ?? []);
      audioContexts.push(audioContext);
      runIndex += 1;
      return audioContext;
    },
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
    setTimeout: timeouts.setTimeout,
    clearTimeout: timeouts.clearTimeout,
    now: () => frames.currentTime,
  });

  return {
    session,
    stream,
    mediaDevices,
    frames,
    timeouts,
    recorders,
    audioContexts,
  };
}

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushTasks(): Promise<void> {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('selectRecordingMimeType prefers opus webm, then mp4, then webm, then ogg opus', () => {
  assert.equal(
    selectRecordingMimeType((mime) => mime === 'audio/mp4' || mime === 'audio/webm'),
    'audio/mp4',
  );
  assert.equal(
    selectRecordingMimeType((mime) => mime === 'audio/ogg;codecs=opus'),
    'audio/ogg;codecs=opus',
  );
});

test('silence before speech does not stop', () => {
  const state = updateSilenceState(
    {
      recordingStartedAtMs: 0,
      speechStartedAtMs: null,
      silenceStartedAtMs: null,
      shouldStop: false,
    },
    0.01,
    200,
  );

  assert.deepEqual(state, {
    recordingStartedAtMs: 0,
    speechStartedAtMs: null,
    silenceStartedAtMs: null,
    shouldStop: false,
  });
});

test('signal over threshold marks speech as started', () => {
  const state = updateSilenceState(
    {
      recordingStartedAtMs: 0,
      speechStartedAtMs: null,
      silenceStartedAtMs: null,
      shouldStop: false,
    },
    0.04,
    300,
  );

  assert.deepEqual(state, {
    recordingStartedAtMs: 0,
    speechStartedAtMs: 300,
    silenceStartedAtMs: null,
    shouldStop: false,
  });
});

test('799ms silence after speech does not stop', () => {
  const state = updateSilenceState(
    {
      recordingStartedAtMs: 0,
      speechStartedAtMs: 100,
      silenceStartedAtMs: 200,
      shouldStop: false,
    },
    0.01,
    999,
  );

  assert.equal(state.shouldStop, false);
  assert.equal(state.silenceStartedAtMs, 200);
});

test('800ms silence after speech requests stop', () => {
  const state = updateSilenceState(
    {
      recordingStartedAtMs: 0,
      speechStartedAtMs: 100,
      silenceStartedAtMs: 200,
      shouldStop: false,
    },
    0.01,
    1_000,
  );

  assert.equal(state.shouldStop, true);
});

test('6 seconds requests stop regardless of signal', () => {
  const state = updateSilenceState(
    {
      recordingStartedAtMs: 0,
      speechStartedAtMs: 100,
      silenceStartedAtMs: null,
      shouldStop: false,
    },
    0.3,
    6_000,
  );

  assert.equal(state.shouldStop, true);
});

test('start reuses an existing live stream across recordings', async () => {
  const harness = createHarness();

  await harness.session.start(() => {});
  harness.recorders[0].emitData(new Blob(['first']));
  await harness.session.stop();

  await harness.session.start(() => {});
  harness.recorders[1].emitData(new Blob(['second']));
  await harness.session.stop();

  assert.equal(harness.mediaDevices.calls, 1);
  assert.equal(harness.recorders.length, 2);
  assert.equal(harness.recorders[0].stream, harness.stream);
  assert.equal(harness.recorders[1].stream, harness.stream);
});

test('manual stop resolves recorded speech and closes current analysis resources', async () => {
  const harness = createHarness();

  await harness.session.start(() => {});
  harness.recorders[0].emitData(new Blob(['abc']));

  const result = await harness.session.stop();

  assert.equal(result.mimeType, 'audio/webm;codecs=opus');
  assert.equal(result.blob.type, 'audio/webm;codecs=opus');
  assert.equal(await result.blob.text(), 'abc');
  assert.equal(harness.session.isRecording, false);
  assert.equal(harness.audioContexts[0].closeCalls, 1);
  assert.ok(harness.audioContexts[0].source?.disconnected);
  assert.equal(harness.frames.pending.size, 0);
});

test('stop rejects empty recordings', async () => {
  const harness = createHarness();

  await harness.session.start(() => {});

  await assert.rejects(
    () => harness.session.stop(),
    /录音内容为空/,
  );
});

test('post-speech silence auto-stops once and stop returns the finished recording', async () => {
  const harness = createHarness({
    rmsRuns: [[0.05, 0.01, 0.01]],
  });
  let autoStopCalls = 0;

  await harness.session.start(() => {
    autoStopCalls += 1;
  });
  harness.recorders[0].emitData(new Blob(['speech']));

  harness.frames.tick(100);
  harness.frames.tick(200);
  harness.frames.tick(1_000);
  await flushMicrotasks();

  const result = await harness.session.stop();

  assert.equal(autoStopCalls, 1);
  assert.equal(harness.recorders[0].stopCalls, 1);
  assert.equal(await result.blob.text(), 'speech');
});

test('hard timeout auto-stops once even while speech continues', async () => {
  const harness = createHarness({
    rmsRuns: [[0.08, 0.08]],
  });
  let autoStopCalls = 0;

  await harness.session.start(() => {
    autoStopCalls += 1;
  });
  harness.recorders[0].emitData(new Blob(['timeout']));

  harness.frames.tick(100);
  harness.frames.tick(6_000);
  await flushMicrotasks();

  const result = await harness.session.stop();

  assert.equal(autoStopCalls, 1);
  assert.equal(harness.recorders[0].stopCalls, 1);
  assert.equal(await result.blob.text(), 'timeout');
});

test('dispose stops recorder, closes audio context, cancels frames, and stops stream tracks', async () => {
  const harness = createHarness();

  await harness.session.start(() => {});
  const pendingFrameIds = [...harness.frames.pending.keys()];

  harness.session.dispose();
  await flushMicrotasks();

  assert.equal(harness.recorders[0].stopCalls, 1);
  assert.equal(harness.audioContexts[0].closeCalls, 1);
  assert.deepEqual([...harness.frames.cancelled], pendingFrameIds);
  assert.equal(harness.stream.tracks[0].stopCalls, 1);
  assert.equal(harness.session.isRecording, false);
});

test('second start rejects while microphone access is still pending', async () => {
  const pendingStream = deferredPromise<FakeMediaStream>();
  const harness = createHarness({
    getUserMedia: () => pendingStream.promise,
  });

  const firstStart = harness.session.start(() => {});

  await assert.rejects(
    () => harness.session.start(() => {}),
    /already active/,
  );

  pendingStream.resolve(harness.stream);
  await firstStart;
  harness.recorders[0].emitData(new Blob(['ok']));
  await harness.session.stop();
});

test('dispose during pending start prevents recorder creation and stops the acquired stream', async () => {
  const pendingStream = deferredPromise<FakeMediaStream>();
  const harness = createHarness({
    getUserMedia: () => pendingStream.promise,
  });

  const startPromise = harness.session.start(() => {});
  harness.session.dispose();
  pendingStream.resolve(harness.stream);

  await assert.rejects(
    () => startPromise,
    /disposed during startup/,
  );

  assert.equal(harness.recorders.length, 0);
  assert.equal(harness.stream.tracks[0].stopCalls, 1);
  assert.equal(harness.session.isRecording, false);
});

test('failed setup after getUserMedia stops the stream to avoid microphone leaks', async () => {
  const harness = createHarness({
    createAudioContext: () => {
      throw new Error('audio setup failed');
    },
  });

  await assert.rejects(
    () => harness.session.start(() => {}),
    /audio setup failed/,
  );

  assert.equal(harness.stream.tracks[0].stopCalls, 1);
  assert.equal(harness.recorders.length, 1);
  assert.equal(harness.session.isRecording, false);
});

test('recorder errors stop the microphone and stay catchable through stop without unhandled rejections', async () => {
  const harness = createHarness();
  const unhandledErrors: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledErrors.push(reason);
  };

  process.on('unhandledRejection', onUnhandledRejection);

  try {
    await harness.session.start(() => {});
    harness.recorders[0].emitError(new Error('boom'));
    await flushTasks();

    await assert.rejects(
      () => harness.session.stop(),
      /boom/,
    );

    assert.equal(harness.stream.tracks[0].stopCalls, 1);
    assert.equal(harness.session.isRecording, false);
    assert.deepEqual(unhandledErrors, []);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});

test('stop preserves chunk mime type when no preferred recording mime type is supported', async () => {
  const harness = createHarness({
    supportedMimeTypes: [],
  });

  await harness.session.start(() => {});
  harness.recorders[0].emitData(new Blob(['fallback'], { type: 'audio/webm' }));

  const result = await harness.session.stop();

  assert.equal(result.mimeType, 'audio/webm');
  assert.equal(result.blob.type, 'audio/webm');
});

test('hard timeout auto-stops even when no animation frame runs', async () => {
  const harness = createHarness();
  let autoStopCalls = 0;

  await harness.session.start(() => {
    autoStopCalls += 1;
  });
  harness.recorders[0].emitData(new Blob(['timer'], { type: 'audio/webm' }));

  harness.timeouts.runAll();
  await flushTasks();

  const result = await harness.session.stop();

  assert.equal(autoStopCalls, 1);
  assert.equal(harness.recorders[0].stopCalls, 1);
  assert.equal(await result.blob.text(), 'timer');
});

test('dispose cleanup does not stop a new stream started before the old close finishes', async () => {
  const firstStream = new FakeMediaStream();
  const secondStream = new FakeMediaStream();
  const firstClose = deferredPromise<void>();
  let getUserMediaCalls = 0;
  let audioContextCalls = 0;

  const harness = createHarness({
    getUserMedia: async () => {
      getUserMediaCalls += 1;
      return getUserMediaCalls === 1 ? firstStream : secondStream;
    },
    createAudioContext: () => {
      const context = new FakeAudioContext([]);
      audioContextCalls += 1;
      if (audioContextCalls === 1) {
        context.close = async () => {
          context.closeCalls += 1;
          await firstClose.promise;
        };
      }
      return context;
    },
  });

  await harness.session.start(() => {});
  harness.session.dispose();
  await flushMicrotasks();

  await harness.session.start(() => {});
  assert.equal(getUserMediaCalls, 2);
  assert.equal(harness.recorders[1].stream, secondStream);
  harness.recorders[1].emitData(new Blob(['fresh'], { type: 'audio/webm' }));

  firstClose.resolve();
  await flushTasks();

  assert.equal(firstStream.tracks[0].stopCalls, 1);
  assert.equal(secondStream.tracks[0].stopCalls, 0);

  await harness.session.stop();
});
