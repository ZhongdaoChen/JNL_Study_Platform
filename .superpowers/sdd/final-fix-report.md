# Chinese Pronunciation Practice — Final Review Fix Report

Date: 2026-09-08
Branch: `feature/chinese-pronunciation-practice`
Commit: `f7c0c247a0f0b390ea3575d24c0f05a3b1c07ae6` (`fix: address final pronunciation review`)

## Result

All four final review findings were fixed in one coherent commit. The stable
application assessment response remains:

```json
{
  "correct": true,
  "recognizedText": "中",
  "acceptedReading": "zhòng"
}
```

No audio is persisted or logged.

## Official Alibaba Cloud References

Research was completed before changing the provider contract:

- ASR model selection and audio specifications:
  https://help.aliyun.com/zh/model-studio/asr-model
- Synchronous Qwen-Audio-3.0-ASR-Flash HTTP request/response contract:
  https://help.aliyun.com/zh/model-studio/non-real-time-speech-recognition-for-fun-asr-flash
- Qwen-ASR API reference and supported synchronous protocols:
  https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
- Structured JSON / JSON Schema output:
  https://help.aliyun.com/zh/model-studio/qwen-structured-output
- Model lifecycle and retirement policy:
  https://www.alibabacloud.com/help/zh/model-studio/model-depreciation
- Model rate limits, including qwen3-tts-flash at 180 RPM (3 RPS):
  https://help.aliyun.com/zh/model-studio/rate-limit
- Qwen3.8-Flash model information:
  https://help.aliyun.com/en/model-studio/qwen3-8-flash

## Finding 1 — Assessment Provider Contract

### Selected models and protocol

- Primary recognition: `qwen-audio-3.0-asr-flash`.
- Protocol: synchronous DashScope multimodal-generation HTTP request.
- Request:
  - `POST /api/v1/services/aigc/multimodal-generation/generation`
  - `X-DashScope-SSE: disable`
  - `input.messages[].content[]` uses
    `{"type":"input_audio","input_audio":{"data":"data:<mime>;base64,..."}}`
  - `parameters.format` is mapped from the actual browser MIME/container.
  - `parameters.language_hints` is `["zh"]`.
- Response: reads the documented `output.text` and optional
  `output.sentence.words[]`; it no longer expects an invented
  `output.choices[].message.content` assessment object from the ASR service.
- Multi-character words/sentences are compared deterministically after the
  existing punctuation/whitespace normalization.
- Single characters use a second bounded `qwen3.8-flash` judgment because ASR
  transcription alone does not reliably expose a polyphonic reading. The call
  uses `response_format.type=json_schema`, `strict=true`, no extra properties,
  `temperature=0`, and `max_tokens=100`. Runtime validation additionally
  enforces the status enum, nullability rules, and a bounded pinyin value.

### RED

```text
SyntaxError: ../api/pronunciationShared.ts does not provide an export named
'audioFormatForMimeType'
tests 1, pass 0, fail 1
```

The invalid-reading regression initially returned:

```text
actual:   200 { correct: true, acceptedReading: "<script>" }
expected: 502 { error: "发音评估结果无效" }
```

### GREEN

```text
node --experimental-strip-types --test tests/pronunciationApiHandlers.test.ts
tests 20
pass 20
fail 0
```

## Finding 2 — Authentication and Distributed Limits

### Implementation

- Every paid pronunciation handler now requires a Supabase session bearer
  token before validating or forwarding a paid provider request.
- The server verifies the token through Supabase Auth
  (`GET /auth/v1/user`) using the configured anon key.
- The frontend obtains the current Supabase session token and adds
  `Authorization: Bearer <token>` to each pronunciation request.
- Local/no-cloud mode fails explicitly with
  `语音服务仅在云端登录模式可用`; server-side missing configuration fails
  closed with HTTP 503.
- Cross-instance limits are stored atomically in Supabase Postgres through
  `acquire_pronunciation_request` and `release_pronunciation_request`.
- Defaults:
  - 30 requests/minute per principal.
  - 90 requests/minute per IP fingerprint.
  - 2 concurrent requests per principal.
  - 6 concurrent requests per IP fingerprint.
  - 30-second crash-safe lease expiry.
- IP addresses are HMAC-SHA-256 fingerprinted before being sent to Supabase.
- PostgreSQL advisory transaction locks serialize acquisitions across Vercel
  instances. RLS is enabled and direct table access is revoked.
- Leases are released in `finally`; expiration prevents permanent leaks if an
  instance terminates before cleanup.

### RED

```text
ERR_MODULE_NOT_FOUND: api/pronunciationSecurity.ts
frontend Authorization header: expected Bearer session-token, got undefined
local-mode request: expected explicit cloud-mode error, got endpoint response
```

Handler integration initially failed:

```text
all paid pronunciation handlers reject missing authentication
expected 401, received 502
```

Schema regression initially failed:

```text
schema.sql did not contain pronunciation_request_events
```

### GREEN

```text
node --experimental-strip-types --test \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApi.test.ts
tests 13
pass 13
fail 0
```

Coverage includes missing auth, invalid auth, rate-limit `429` with
`Retry-After`, HMAC IP handling, release after thrown work, empty-secret
fallback, and fail-closed no-cloud behavior.

## Finding 3 — Example Sentence Race

### Implementation

- Added `Repo.updateExampleSentence(wordId, sentence)`.
- `LocalRepo` and `SupabaseRepo` now perform a field-only example sentence
  update.
- General `upsertWord` preserves the stored/server `exampleSentence`, matching
  the existing ownership rule for `pronunciationExamples`.
- Automatic and manual sentence generation now use the field-only method.
- Queue updates use `mergeExampleSentenceInQueue`, changing only
  `exampleSentence` on every copy of the word and preserving concurrent review
  and pronunciation state.

### RED

```text
TypeError: repo.updateExampleSentence is not a function
../pronunciationSession.ts does not provide an export named
'mergeExampleSentenceInQueue'
tests 15, pass 10, fail 5
```

### GREEN

```text
node --experimental-strip-types --test \
  tests/localRepo.test.ts \
  tests/supabaseRepo.test.ts \
  tests/pronunciationSession.test.ts \
  tests/wordService.test.ts
tests 34
pass 34
fail 0
```

## Finding 4 — TTS Prefetch Throttling and Partial Recovery

### Implementation

- Replaced four concurrent `Promise.all` TTS calls with a sequential queue.
- Each successful URL is written to the cache immediately.
- A failed item does not discard earlier or later successful URLs.
- A retry skips cached items and requests only missing audio.
- Word changes replace the cache map, preventing stale in-flight work from
  populating the next word's cache.

### RED

```text
SyntaxError: ../pronunciationSession.ts does not provide an export named
'fillPronunciationAudioCache'
tests 1, pass 0, fail 1
```

### GREEN

```text
node --experimental-strip-types --test tests/pronunciationSession.test.ts
tests 13
pass 13
fail 0
```

The tests assert call order, maximum concurrency of one, independent caching
after partial failure, and retrying only the missing item.

## Files

### Provider and access control

- `api/assess-pronunciation.ts`
- `api/generate-pronunciation-examples.ts`
- `api/pronunciationShared.ts`
- `api/pronunciationSecurity.ts`
- `api/synthesize-pronunciation.ts`
- `src/lib/pronunciationApi.ts`
- `src/lib/supabase.ts`
- `supabase/schema.sql`

### Race and playback fixes

- `src/lib/repo.ts`
- `src/lib/localRepo.ts`
- `src/lib/supabaseRepo.ts`
- `src/components/ReviewSession.tsx`
- `src/components/pronunciationSession.ts`
- `src/components/PronunciationPractice.tsx`

### Tests and documentation

- `tests/pronunciationApiHandlers.test.ts`
- `tests/pronunciationApi.test.ts`
- `tests/pronunciationSecurity.test.ts`
- `tests/pronunciationSchema.test.ts`
- `tests/localRepo.test.ts`
- `tests/supabaseRepo.test.ts`
- `tests/pronunciationSession.test.ts`
- `tests/wordService.test.ts`
- `.env.example`
- `README.md`
- `src/lib/changelog.ts`

## Final Verification

Full tests:

```text
node --experimental-strip-types --test tests/*.test.ts
tests 135
pass 135
fail 0
cancelled 0
skipped 0
todo 0
```

Production build:

```text
npm run build
tsc -b && vite build
96 modules transformed
completed successfully
```

Targeted lint:

```text
npx eslint --quiet <all changed TypeScript files>
npx eslint --quiet --rule '@typescript-eslint/no-explicit-any: off' \
  src/lib/supabaseRepo.ts tests/supabaseRepo.test.ts
exit code 0
```

Repository checks:

```text
git diff --check HEAD^ HEAD
exit code 0

package-lock.json
unchanged
```

## Deployment Notes and Remaining Concerns

1. Re-run the idempotent `supabase/schema.sql` before deploying the new
   serverless handlers. Until the rate-limit tables/RPCs exist, pronunciation
   requests intentionally fail closed with HTTP 503.
2. Set the existing Supabase URL/anon-key variables and `QWEN_API_KEY` in the
   Vercel environment. `PRONUNCIATION_RATE_LIMIT_SECRET` is optional and falls
   back to `QWEN_API_KEY`.
3. No live paid-provider request was made in this environment. The contract
   tests use the exact request and response structures documented by Alibaba
   Cloud, but deployment should still receive one short smoke test with real
   credentials.
4. The second-stage single-character decision is transcript-based rather than
   phoneme-score-based. It preserves the requirement that any common reading of
   a polyphonic character can pass, but borderline tone recognition can still
   become `unclear` and ask the child to retry.
5. Real microphone permission, MediaRecorder container behavior, and autoplay
   still require the planned iOS Safari/PWA, Android Chrome, and desktop browser
   acceptance pass.

---

# Latest Final-Review Findings — Completion Addendum

Date: 2026-09-08
Commit: `48cb1f59bd33266a87950e4cbb9145ff9c7a291c`
(`fix: harden pronunciation final review`)

## Status

All four latest final-review findings are implemented. The limiter trust
boundary now terminates at the Serverless layer, documented DashScope OSS
audio URLs are normalized safely, provider work uses the actual remaining
database lease, and delayed review writes no longer erase generated queue
fields.

## 1. Service-role-only limiter RPCs

- `acquire_pronunciation_request` now accepts only the server-verified
  `p_owner`, a validated `p_operation`, and the HMAC `p_ip_hash`.
- `release_pronunciation_request` accepts only `p_owner` and `p_lease_id`.
- Both functions revoke execution from `public`, `anon`, and `authenticated`,
  grant execution only to `service_role`, and defensively require
  `auth.role() = 'service_role'`.
- Rate, concurrency, lease, resource, and model policy is selected inside SQL.
  Callers cannot submit or raise those values.
- Browser bearer credentials are used only with Supabase Auth. Limiter
  acquisition and release use `SUPABASE_SERVICE_ROLE_KEY`.
- Missing service-role configuration fails closed before any network call.
- All request bodies are parsed and validated before a limiter lease is
  acquired, so malformed synthesis requests consume no provider capacity.

### TDD evidence

The new tests initially failed because RPC calls still used the anon/browser
credentials, acquire still sent caller-controlled policy fields, the schema
still granted `authenticated`, missing service-role configuration did not fail
closed, and invalid request bodies acquired leases. After implementation:

```text
node --experimental-strip-types --test \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSchema.test.ts \
  tests/reviewQueue.test.ts
pass
```

## 2. Signed DashScope OSS TTS URLs

- The handler now accepts only the documented result hosts:
  - `dashscope-result-bj.oss-cn-beijing.aliyuncs.com`
  - `dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com`
- A valid signed `http:` result URL is upgraded to `https:` without changing
  its path or query signature.
- Arbitrary HTTPS hosts, unrelated OSS buckets, suffix-confusion hosts,
  credentials, custom ports, malformed URLs, and non-HTTP schemes are rejected.
- Source checked:
  https://help.aliyun.com/en/model-studio/qwen-tts-api

### TDD evidence

```text
RED: tests 24, pass 22, fail 2
- documented signed HTTP result was rejected
- arbitrary HTTPS result was accepted

GREEN: tests/pronunciationApiHandlers.test.ts passed
```

## 3. Fresh grant time and remaining lease budget

- The SQL function now acquires the global, owner, and IP advisory locks before
  capturing `clock_timestamp()`.
- Cleanup windows, rate events, and lease expiry all use that fresh post-lock
  timestamp.
- Successful acquisition returns both `granted_at` and `expires_at`.
- The server validates both timestamps and calculates a conservative remaining
  lease using the absolute expiry and acquisition round-trip duration.
- The provider deadline is the lower of the configured timeout and the
  remaining lease minus a one-second safety margin, so it is always strictly
  below the remaining lease.
- Unsafe or malformed lease timing fails closed; an already-created lease is
  released before returning the error.

### TDD evidence

The deadline helper regression initially failed because no remaining-lease
calculator existed. The insufficient-budget regression then exposed an
unreleased lease; after the fix all 13 security tests passed.

## 4. Review queue reconciliation

- `applyReviewToQueue` now merges review state from the async save result with
  `exampleSentence` and `pronunciationExamples` from the current queue state.
- Every existing queue copy and every newly inserted/appended retry copy uses
  the reconciled word.

### TDD evidence

```text
RED: tests 9, pass 7, fail 2
- delayed review completion erased the generated sentence/examples
- retry copies inherited the stale generated fields

GREEN: tests/reviewQueue.test.ts passed
```

## Final validation

```text
Baseline before changes:
tests 145
pass 145
fail 0

Final full suite:
tests 152
pass 152
fail 0
cancelled 0
skipped 0
todo 0

npm run build
TypeScript build passed; Vite transformed 96 modules and produced dist.

npx eslint --quiet <changed TypeScript files>
exit code 0

Independent final code review:
No significant issues found.
```

## Deployment requirements and concerns

1. Apply `supabase/schema.sql` before deploying the Serverless functions. This
   removes the old authenticated RPC overloads and installs the new
   service-role-only signatures.
2. Add `SUPABASE_SERVICE_ROLE_KEY` only to the server environment. Never expose
   it through a `VITE_` variable or client bundle.
3. No live Supabase migration or paid DashScope request was run here. Automated
   tests validate the request boundaries and official documented response
   hosts; production still needs a short credentialed smoke test.

---

# Remaining Important Findings — Completion Addendum

Date: 2026-09-08
Commit: `9d69ab4c91a5411710dad51c221e04f289c329f0`
(`fix: close pronunciation review gaps`)

## Status

All three remaining Important findings are implemented and committed.
`package-lock.json` was not changed.

## 1. Server deadlines remain inside the lease

- Added abortable Supabase Auth, acquire-RPC, and release-RPC deadlines.
- Added one shared protected-work deadline for all DashScope calls in a request.
  The two assessment calls therefore share one budget rather than receiving
  separate full-length budgets.
- Default security and provider deadlines are 5 seconds and 20 seconds. Both
  are capped below the configured lease duration.
- Assessment ASR, single-character judgment, helper generation, and synthesis
  all use the protected context's abort signal, including response-body JSON
  reads.
- Timeouts return explicit HTTP 504 messages. Other upstream failures retain
  their endpoint-specific, secret-safe HTTP 502 responses.
- Lease release remains in `finally`; cleanup itself is deadline-bound.

### TDD evidence

Initial deadline regression run:

```text
node --experimental-strip-types --test \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts
tests 30
pass 26
fail 4

Expected 504 timeout responses, received 502/503.
Hanging Auth/acquire/release/provider fetches were not aborted.
```

Green run:

```text
tests 30
pass 30
fail 0
```

Coverage includes hanging Supabase Auth, acquire RPC, release RPC, both
assessment upstream calls, helper generation, synthesis, and a hanging
DashScope response body. Provider timeout tests also assert one release-RPC
call per acquired lease.

## 2. Account-wide qwen3-tts-flash pacing

- Added explicit `resource_key` and `model_key` event columns through
  idempotent `alter table ... add column if not exists` statements.
- The synthesis handler identifies the resource as `dashscope-tts` and the
  model as `qwen3-tts-flash` by default.
- The RPC serializes global model acquisition with a provider/model advisory
  lock and checks starts across every owner and IP.
- Hard schema-side maxima are 3 starts per rolling second and 180 starts per
  rolling minute. Existing user/IP frequency and concurrency gates remain.
- The old RPC signature is dropped before the new signature is installed, so
  rerunning `supabase/schema.sql` upgrades an existing project idempotently.

### TDD evidence

Initial global-gate regressions:

```text
the fourth global TTS start in one second is rejected across principals and recovers
actual status: 200
expected status: 429

synthesis uses default model and voice and returns an HTTPS audio URL
actual p_resource_key: undefined
expected p_resource_key: dashscope-tts

schema provides authenticated distributed pronunciation rate and concurrency leases
missing resource_key/model_key and rolling-window SQL
```

Green run:

```text
node --experimental-strip-types --test \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSchema.test.ts
tests 32
pass 32
fail 0
```

The stateful cross-principal test admits the first three starts, rejects the
fourth with HTTP 429 and `Retry-After: 1`, then admits a new principal after
the rolling one-second window expires. Tests also pin the 3/second and
180/minute RPC parameters and SQL bounds.

## 3. Cancelable, reconciling TTS worker

- `assessPronunciation`, example generation, and synthesis now accept an
  optional external `AbortSignal`; cancellation is preserved as `AbortError`
  rather than being mislabeled as a client timeout.
- `PronunciationPractice` now owns one serialized current-word worker.
- Invalidating requests or changing words aborts the active synthesis. The
  next word cannot start synthesis until the canceled call settles, preventing
  cross-word overlap.
- The worker re-reads the desired item list after every item. Late helper words
  join the active target-only run, and cached target audio is not requested
  again.
- Partial successes remain cached and retries request only missing audio.
- The previous exported cache filler remains available for compatibility, but
  the component no longer uses its snapshot loop.

### TDD evidence

Initial regressions:

```text
synthesis forwards cancellation to the active pronunciation request
Error: test request was not canceled

pronunciationSession.test.ts
SyntaxError: module does not provide export createPronunciationAudioWorker
```

Green worker/API run:

```text
node --experimental-strip-types --test \
  tests/pronunciationApi.test.ts \
  tests/pronunciationSession.test.ts
tests 24
pass 24
fail 0
```

Coverage proves active cancellation stops remaining items, a new word waits
for the canceled request to settle (maximum concurrency one), late helper
examples are added, target audio is requested once, and partial retries only
request missing items.

## Final verification

Full tests:

```text
node --experimental-strip-types --test tests/*.test.ts
tests 145
pass 145
fail 0
cancelled 0
skipped 0
todo 0
```

Production build:

```text
npm run build
tsc -b && vite build
96 modules transformed
completed successfully
```

Targeted lint:

```text
npx eslint --quiet \
  api/assess-pronunciation.ts \
  api/generate-pronunciation-examples.ts \
  api/pronunciationSecurity.ts \
  api/synthesize-pronunciation.ts \
  src/lib/pronunciationApi.ts \
  src/components/pronunciationSession.ts \
  src/components/PronunciationPractice.tsx \
  tests/pronunciationApi.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationSession.test.ts \
  tests/pronunciationSchema.test.ts
exit code 0
```

Repository checks:

```text
git diff --check
exit code 0

package-lock.json
unchanged

git status --short --branch
## feature/chinese-pronunciation-practice
```

## Deployment requirement and residual concerns

1. Run the updated idempotent `supabase/schema.sql` before deploying commit
   `9d69ab4`; the server sends the new RPC arguments immediately and therefore
   intentionally fails closed with 503 against the old function signature.
2. No live Supabase or paid DashScope request was made. Automated tests cover
   abort propagation, safe status mapping, lease release attempts, RPC payloads,
   rolling-window behavior, and worker serialization with deterministic mocks.
3. Browser microphone permission, MediaRecorder formats, audio autoplay, and
   real provider latency still require the planned device smoke tests.

---

# Last Release-Review Findings — Completion Addendum

Date: 2026-09-08
Commit: `95dfe59f40cd586048472fe2d4b5fa15fd7b47e1`
(`fix: close pronunciation release findings`)

## Status

All three last release-review findings are implemented. `package-lock.json`
was not changed.

## 1. TTS model and limiter policy

- The synthesis handler now uses the immutable model
  `qwen3-tts-flash`.
- The obsolete `QWEN_TTS_MODEL` override was removed from active code,
  `.env.example`, README, and tests, so it cannot diverge from the
  schema-owned `dashscope-tts / qwen3-tts-flash` limiter policy.
- `QWEN_TTS_VOICE` remains configurable; changing the voice does not change
  the provider/model quota identity.

## 2. Confidence-bearing direct audio assessment

### Provider research and selected contract

- ASR remains `qwen-audio-3.0-asr-flash` over the synchronous native
  DashScope multimodal-generation endpoint.
- Final pronunciation decisions use the fixed `qwen3.5-omni-plus` model over
  the documented OpenAI-compatible Chat Completions protocol.
- The request supplies the original Base64 PCM WAV through `input_audio`,
  plus the target and ASR transcript as text context. It sets
  `modalities: ["text"]`, `stream: true`, and
  `response_format: {"type":"json_object"}`.
- Qwen3.5-Omni-Plus is the current production alternative for audio
  understanding, accepts audio plus text, and is documented as supporting
  JSON Object output. Alibaba currently limits JSON Schema mode to selected
  text Qwen models, so the server additionally enforces an exact three-field
  schema: `status`, `confidence`, and `acceptedReading`.
- `status` must be `correct`, `incorrect`, or `unclear`; confidence must be a
  finite number from 0 through 1; extra/missing fields and invalid reading
  values are rejected.
- A decision is gradeable only at confidence `>= 0.90`. `unclear` and every
  lower-confidence decision return HTTP 422, so the client never submits a
  review grade. Only an explicit high-confidence `incorrect` can return
  `correct:false`.
- Single-character prompts retain the rule that any common modern Mandarin
  reading is acceptable. Multi-character ASR mismatches are always sent to
  the original-audio assessor instead of being converted directly into
  `forgotten`.

### Official Alibaba Cloud sources checked

- Qwen-Omni capabilities, audio input, model selection, and streaming:
  https://help.aliyun.com/en/model-studio/qwen-omni
- OpenAI-compatible Chat Completions `input_audio` contract:
  https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions
- Structured output support (JSON Object for Qwen3.5-Omni-Plus; JSON Schema
  support matrix):
  https://help.aliyun.com/en/model-studio/qwen-structured-output
- Current Model Studio base URLs; the legacy DashScope domain remains
  supported and workspace-dedicated domains are recommended:
  https://help.aliyun.com/en/model-studio/base-url
- Qwen-Audio capabilities and its recommendation to use Qwen-Omni for
  production:
  https://help.aliyun.com/en/model-studio/audio-language-model
- Qwen ASR models and supported audio formats:
  https://help.aliyun.com/en/model-studio/asr-model
- Alibaba's separate education speech-assessment capabilities:
  https://help.aliyun.com/en/document_detail/2996297.html
- Chinese single-character/word assessment reference:
  https://help.aliyun.com/en/document_detail/2996317.html
- Qwen3 TTS request contract:
  https://help.aliyun.com/en/model-studio/qwen-tts-api
- Model rate limits:
  https://help.aliyun.com/en/model-studio/rate-limit

## 3. Short recording rejection

- The recorder records elapsed time using its monotonic clock and includes
  `durationMs` in `RecordedSpeech`.
- The client rejects recordings shorter than 250ms before audio conversion or
  any API request.
- Accepted browser recordings are decoded and re-encoded as mono 16-bit PCM
  WAV, a documented Qwen-Omni input format.
- Server validation rejects decoded payloads below 256 bytes before
  authentication, limiter acquisition, or provider work.
- Boundary tests cover 249ms/250ms and 255-byte/256-byte behavior. The old
  one-byte success fixtures were replaced.

## TDD evidence

Initial regression run:

```text
node --experimental-strip-types --test \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationApi.test.ts \
  tests/speechRecorder.test.ts
tests 58
pass 48
fail 10
```

The failures showed the missing confidence field, automatic false result for
a multi-character mismatch, absent minimum payload check, configurable TTS
model, and missing recording duration guard.

PCM WAV regression before implementation:

```text
node --experimental-strip-types --test tests/speechRecorder.test.ts
tests 21
pass 20
fail 1
```

Targeted green run:

```text
node --experimental-strip-types --test \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationApi.test.ts \
  tests/speechRecorder.test.ts \
  tests/pronunciationSecurity.test.ts
tests 71
pass 71
fail 0
```

## Final validation

```text
node --experimental-strip-types --test tests/*.test.ts
tests 160
pass 160
fail 0
cancelled 0
skipped 0
todo 0

npm run build
TypeScript build passed; Vite transformed 96 modules and produced dist.

npx eslint --quiet <changed TypeScript files>
exit code 0

git diff --check
exit code 0

package-lock.json
unchanged

Independent code review
No significant issues found.
```

## Remaining concerns

1. No paid-provider call was made. A credentialed deployment smoke test must
   confirm the current account can invoke `qwen3.5-omni-plus` and receive its
   streaming JSON Object response through the selected Beijing endpoint.
2. The 0.90 value is a conservative application threshold over model-reported
   confidence, not a calibrated phoneme score. Ambiguous results intentionally
   become HTTP 422 rather than a negative grade.
3. Alibaba also documents a dedicated education speech-assessment product
   with phoneme/tone scores, but it has a separate product/credential and SDK
   integration path. This change keeps the existing Model Studio credential
   boundary and uses the documented production Qwen-Omni path.
4. Browser MediaRecorder decode behavior still needs the planned iOS
   Safari/PWA, Android Chrome, and desktop smoke tests. The submitted provider
   payload is normalized to documented mono PCM WAV before upload.

---

# Three Remaining Release Blockers — Completion Addendum

Date: 2026-09-08
Commit: `04b9d3928e8cdbaf66b05670fca9f796b8ef773a`
(`fix: close remaining pronunciation blockers`)

## Status

All three remaining release blockers are fixed. The changes keep the
service-role limiter boundary, reject untrusted audio before any authentication
or paid-provider work, and serialize voice grading with the review save.
`package-lock.json` is unchanged.

## 1. Account-wide Qwen Omni quota

- The initial `assessment` lease still protects the authenticated assessment
  request and its user/IP limits.
- After ASR succeeds and produces usable Chinese text, the handler now acquires
  a second `omni_assessment` lease immediately before starting
  `qwen3.5-omni-plus`.
- SQL owns the immutable `dashscope-omni / qwen3.5-omni-plus` policy:
  1 start per rolling second and 60 starts per rolling minute account-wide,
  plus the existing 30/min user, 90/min IP, 2/user concurrency, 6/IP
  concurrency, and 30-second lease controls in a separate
  `pronunciation-omni` scope.
- Both RPCs remain executable only by `service_role`. The nested acquisition
  reuses only the server-verified owner and HMAC IP fingerprint.
- The nested provider timeout is calculated from that gate's returned
  `granted_at` / `expires_at`, is combined with the remaining outer assessment
  deadline, and its lease is released in `finally`. The outer assessment lease
  is then released independently.
- The cross-principal regression admits one Omni start, rejects a different
  principal inside the same rolling second with HTTP 429, and admits another
  principal after the window expires.

### TDD evidence

RED included these exact failures:

```text
TypeError: context.withProviderGate is not a function
expected: /when 'omni_assessment' then/i
```

GREEN:

```text
node --experimental-strip-types --test \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSchema.test.ts
tests 46
pass 46
fail 0
```

## 2. Server-enforced PCM WAV contract

- The assessment endpoint now accepts only `audio/wav`.
- The server decodes Base64 before authentication and parses the RIFF/WAVE
  container, including chunk boundaries, RIFF size, one `fmt ` chunk, and one
  `data` chunk.
- Accepted audio must be PCM format 1, mono, 16-bit, 8–48 kHz, with consistent
  block alignment and byte rate.
- Duration is calculated from `data` bytes divided by the validated byte rate.
  The exact accepted interval is 250ms through 6,000ms inclusive.
- Container-spoofed, truncated, inconsistent, shorter, longer, unsupported, and
  oversized uploads return HTTP 400 before Supabase Auth, limiter RPCs, or
  DashScope calls.
- README and `.env.example` now document the normalized `audio/wav` contract.

### TDD evidence

Initial regression run:

```text
node --experimental-strip-types --test tests/pronunciationApiHandlers.test.ts
tests 31
pass 25
fail 6
```

The failures showed that WebM was still accepted, arbitrary bytes were trusted
as WAV, unsupported PCM metadata passed, 249ms and 6001ms were not enforced,
and malformed/overlong requests reached protected work.

GREEN:

```text
tests 31
pass 31
fail 0
```

## 3. Serialized pronunciation auto-grading

- `PronunciationPractice.onVoiceGrade` now returns a promise and every
  automatic grade awaits it.
- Correct results reserve the ReviewSession grade coordinator immediately,
  save once, retain the success feedback for at least the existing 1.2-second
  interval, and advance exactly once only after persistence succeeds.
- While an automatic save is pending, grade buttons, ASDF shortcuts, delete,
  previous, and next actions are disabled; synchronous coordinator guards also
  reject stale clicks or key events before React can rerender.
- After a committed incorrect voice grade, manual grade buttons and shortcuts
  remain disabled for that word. Navigation, pronunciation retry, helper words,
  and correct-pronunciation playback remain available.
- Changing words clears the committed incorrect-word lock.

### TDD evidence

RED:

```text
ERR_MODULE_NOT_FOUND:
src/components/reviewGradeSession.ts
tests 1
pass 0
fail 1
```

GREEN:

```text
node --experimental-strip-types --test \
  tests/reviewGradeSession.test.ts \
  tests/reviewKeyboard.test.ts \
  tests/pronunciationSession.test.ts
tests 28
pass 28
fail 0
```

The regressions prove one persistence submission despite immediate manual and
keyboard input, retention of the incorrect-word manual lock, reset on the next
word, and one post-save advance for a correct result.

## Final validation

Full suite:

```text
node --experimental-strip-types --test tests/*.test.ts
tests 166
pass 166
fail 0
cancelled 0
skipped 0
todo 0
```

Production build:

```text
npm run build
tsc -b && vite build
97 modules transformed
completed successfully
```

Targeted lint:

```text
npx eslint --quiet \
  api/pronunciationSecurity.ts \
  api/pronunciationShared.ts \
  api/assess-pronunciation.ts \
  src/components/reviewGradeSession.ts \
  src/components/ReviewSession.tsx \
  src/components/PronunciationPractice.tsx \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationApi.test.ts \
  tests/pronunciationSchema.test.ts \
  tests/reviewGradeSession.test.ts
exit code 0
```

Repository checks:

```text
git diff --check
exit code 0

git diff -- package-lock.json
no output (unchanged)
```

---

# Scoped double-grade race follow-up — 2026-09-08

## Status

Fixed the remaining scoped pronunciation grading races without changing the
global Omni quota or server WAV-duration validation:

- While an earlier automatic grade is pending, the next word's microphone is
  disabled and the coordinator still rejects any stale voice submission.
- Pronunciation first-attempt state is committed only after the coordinator
  accepts and persists the automatic grade; rejected submissions release the
  pending attempt.
- An incorrect automatic grade installs its manual-grade lock only if that word
  is still current and was not left through forward navigation.
- A normal incorrect completion on the same word continues to lock manual
  grading.

## TDD evidence

The new regressions were run before implementation and failed in the expected
three places:

```text
node --experimental-strip-types --test \
  tests/reviewGradeSession.test.ts \
  tests/pronunciationSession.test.ts
tests 26
pass 23
fail 3

Failures:
- rejected coordinator submission consumed the new word's first attempt
- new-word microphone busy policy was absent
- delayed incorrect completion installed a stale old-word lock
```

After the implementation, the focused coverage passed:

```text
node --experimental-strip-types --test \
  tests/reviewGradeSession.test.ts \
  tests/reviewKeyboard.test.ts \
  tests/pronunciationSession.test.ts
tests 35
pass 35
fail 0
```

## Final validation

```text
node --experimental-strip-types --test tests/*.test.ts
tests 170
pass 170
fail 0
cancelled 0
skipped 0
todo 0

npm run build
tsc -b && vite build
97 modules transformed
completed successfully

npx eslint --quiet \
  src/components/reviewGradeSession.ts \
  src/components/ReviewSession.tsx \
  src/components/pronunciationSession.ts \
  src/components/PronunciationPractice.tsx \
  tests/reviewGradeSession.test.ts \
  tests/pronunciationSession.test.ts
exit code 0

git diff --check
exit code 0

git diff --name-only -- package-lock.json
no output (unchanged)
```

## Remaining concerns

None identified in the requested scope. Deployment still depends on the
existing pronunciation provider and Supabase configuration documented above.

---

# Scoped Double-Grade Follow-up

Date: 2026-09-08
Commit: `fix: allow next during automatic grade save` (this commit)

## Status

- NEXT remains available while an automatic pronunciation grade is pending.
- Previous navigation, manual grades, ASDF shortcuts, deletion, and other
  conflicting actions remain blocked until the automatic submission finishes.
- Forward navigation is recorded synchronously in the review-grade
  coordinator, so a late save cannot advance again or reset the newly visible
  word's UI.
- Correct-result feedback now waits the full 1.2 seconds after persistence
  resolves instead of subtracting network time.
- Pronunciation retry and help controls remain independent of the review action
  lock.
- No global Omni quota or server WAV-duration code was changed.

## TDD evidence

The first focused run failed because the navigation and post-persistence delay
controller APIs did not exist:

```text
SyntaxError: reviewGradeSession.ts does not provide an export named
'beginReviewGradeNavigation'
tests 1
pass 0
fail 1
```

The follow-up regression then failed because previous navigation and manual
grading became available after moving forward while the earlier save was still
pending:

```text
pending automatic grade allows forward navigation but keeps previous
navigation blocked
expected false, actual true
```

Final focused regressions:

```text
node --experimental-strip-types --test \
  tests/reviewGradeSession.test.ts \
  tests/reviewKeyboard.test.ts \
  tests/pronunciationSession.test.ts
tests 31
pass 31
fail 0
```

## Final validation

Full suite:

```text
node --experimental-strip-types --test tests/*.test.ts
tests 166
pass 166
fail 0
cancelled 0
skipped 0
todo 0
```

Production build:

```text
npm run build
tsc -b && vite build
97 modules transformed
completed successfully
```

Targeted lint:

```text
npx eslint --quiet \
  src/components/reviewGradeSession.ts \
  src/components/ReviewSession.tsx \
  tests/reviewGradeSession.test.ts
exit code 0
```

Repository checks:

```text
git diff --check
exit code 0

git diff -- package-lock.json
no output (unchanged)
```

## Remaining concern

The regression coverage exercises the session controller and its timing
contract. No browser-level click automation was available in the existing test
suite, so the arrow disabled states were also validated through the production
controller calls used by `ReviewSession`.

## Deployment requirements and remaining concerns

1. Apply the updated idempotent `supabase/schema.sql` before deploying the
   Serverless functions so `omni_assessment` is recognized. Deploying handlers
   first intentionally fails the second gate closed.
2. No live Supabase migration or paid DashScope request was run. Production
   still needs a credentialed smoke test for both limiter acquisitions and the
   current `qwen3.5-omni-plus` streaming response.
3. Browser microphone decoding and PCM output still need the planned iOS
   Safari/PWA, Android Chrome, and desktop acceptance pass. Server validation
   now rejects any client output outside the documented contract.

---

# Final Scope Correction — Issue 3 Only

Date: 2026-09-08

## Scope decision

The final requested scope ignores issue 1 (global Omni account quota) and
issue 2 (server PCM WAV duration/container validation). Their production,
schema, test, and documentation changes from `04b9d39` were restored to the
exact `95dfe59` behavior.

Only issue 3 remains:

- `ReviewSession` serializes and awaits grade persistence per word.
- A pending automatic voice grade blocks manual buttons, ASDF shortcuts,
  deletion, and conflicting navigation from submitting another grade.
- A committed incorrect automatic grade keeps manual grading disabled while
  leaving pronunciation retry/help and navigation available.
- The lock resets when the current word changes.
- Correct automatic grades save once and advance once after persistence and
  the remaining success-feedback delay.
- Immediate manual or keyboard input cannot create duplicate review
  log/upsert submissions.

The retained implementation and regressions are in:

- `src/components/PronunciationPractice.tsx`
- `src/components/ReviewSession.tsx`
- `src/components/reviewGradeSession.ts`
- `tests/reviewGradeSession.test.ts`

`README.md` retains only the issue 3 user-visible save/lock behavior. The
issue 1 and issue 2 portions of `.env.example`, `README.md`,
`api/assess-pronunciation.ts`, `api/pronunciationSecurity.ts`,
`api/pronunciationShared.ts`, `supabase/schema.sql`,
`tests/pronunciationApi.test.ts`, `tests/pronunciationApiHandlers.test.ts`,
`tests/pronunciationSchema.test.ts`, and
`tests/pronunciationSecurity.test.ts` were removed or restored.

## Validation

Focused double-grade/session regressions:

```text
node --experimental-strip-types --test \
  tests/reviewGradeSession.test.ts \
  tests/reviewKeyboard.test.ts \
  tests/pronunciationSession.test.ts
tests 28
pass 28
fail 0
```

Full suite:

```text
node --experimental-strip-types --test tests/*.test.ts
tests 163
pass 163
fail 0
cancelled 0
skipped 0
todo 0
```

Production build:

```text
npm run build
tsc -b && vite build
97 modules transformed
completed successfully
```

Targeted lint:

```text
npx eslint --quiet \
  api/assess-pronunciation.ts \
  api/pronunciationSecurity.ts \
  api/pronunciationShared.ts \
  src/components/reviewGradeSession.ts \
  src/components/ReviewSession.tsx \
  src/components/PronunciationPractice.tsx \
  tests/pronunciationApi.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSchema.test.ts \
  tests/pronunciationSecurity.test.ts \
  tests/reviewGradeSession.test.ts
exit code 0
```

Repository checks:

```text
git diff --check
exit code 0

git diff -- package-lock.json
no output (unchanged)
```
