# Final Pronunciation Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the latest pronunciation-practice final-review findings around trusted limiter access, signed TTS URLs, lease timing, and asynchronous queue reconciliation.

**Architecture:** Keep browser authentication verification separate from limiter authorization: validate each endpoint request, verify the bearer token with the Supabase anon key, then call service-role-only limiter RPCs with only the verified owner, operation, and IP hash. Put all policy constants and trusted resource/model keys in SQL, return post-lock grant/expiry timestamps, and derive a conservative provider deadline from the actual remaining lease. Keep TTS URL normalization and queue field reconciliation as small pure helpers with direct regression tests.

**Tech Stack:** TypeScript 6, Vercel Serverless Functions, Node test runner, Supabase Postgres/PLpgSQL, React 19.

## Global Constraints

- Follow TDD: add a failing regression before each implementation change.
- Preserve all prior pronunciation fixes and public API response shapes.
- Do not change dependencies or `package-lock.json`.
- Validate request bodies before acquiring paid-provider capacity.
- Limiter RPC execution must be unavailable to `public`, `anon`, and `authenticated`.
- Commit the completed work with the required Copilot co-author trailer.

---

### Task 1: Service-role-only limiter policy

**Files:**
- Modify: `tests/pronunciationSchema.test.ts`
- Modify: `tests/pronunciationSecurity.test.ts`
- Modify: `tests/pronunciationApiHandlers.test.ts`
- Modify: `supabase/schema.sql`
- Modify: `api/pronunciationSecurity.ts`
- Modify: `api/assess-pronunciation.ts`
- Modify: `api/generate-pronunciation-examples.ts`
- Modify: `api/synthesize-pronunciation.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: verified Supabase user ID, `PronunciationEndpoint`, HMAC IP hash.
- Produces: `acquire_pronunciation_request(p_owner uuid, p_operation text, p_ip_hash text)` and `release_pronunciation_request(p_owner uuid, p_lease_id uuid)`, executable only by `service_role`.

- [x] **Step 1: Write failing security and schema tests**

Add assertions that missing `SUPABASE_SERVICE_ROLE_KEY` returns 503 without network work; Auth uses the anon key and browser bearer token; limiter RPCs use the service-role key; acquire payload keys are exactly `p_owner`, `p_operation`, and `p_ip_hash`; release payload keys are exactly `p_owner` and `p_lease_id`; invalid request bodies never call acquire. Assert SQL revokes `public`, `anon`, and `authenticated`, grants only `service_role`, and contains no caller-supplied limit/resource/model parameters.

- [x] **Step 2: Run the regressions and confirm RED**

Run:

```bash
node --experimental-strip-types --test \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSchema.test.ts
```

Expected: failures show missing service-role configuration support, untrusted RPC headers/payload, authenticated SQL grants, and validation occurring after acquisition.

- [x] **Step 3: Implement trusted limiter flow**

Change endpoint handlers to parse and validate request data before calling `withPronunciationSecurity`. Verify bearer sessions with the anon key, retain only the verified `user.id`, and call acquire/release using `SUPABASE_SERVICE_ROLE_KEY`. Remove caller-controlled rate, concurrency, lease, resource, and model inputs from TypeScript and SQL.

In SQL, map `assessment`, `examples`, and `synthesis` to fixed policy values; map synthesis to the fixed global `dashscope-tts` / `qwen3-tts-flash` key and 3/second plus 180/minute limits. Check `auth.role() = 'service_role'` defensively.

- [x] **Step 4: Run the targeted tests and confirm GREEN**

Run the Step 2 command. Expected: all selected tests pass.

### Task 2: Signed Aliyun OSS result URL normalization

**Files:**
- Modify: `api/synthesize-pronunciation.ts`
- Modify: `tests/pronunciationApiHandlers.test.ts`

**Interfaces:**
- Produces: a pure URL normalizer that accepts HTTPS or upgrades HTTP only for exact documented Aliyun/DashScope result host suffixes; rejects credentials, non-default ports, non-HTTP schemes, and unrelated hosts.

- [x] **Step 1: Replace the old HTTPS-only tests with failing allowlist tests**

Cover a documented signed Aliyun OSS HTTP URL upgraded to HTTPS, an already-HTTPS allowlisted URL, unrelated HTTP/HTTPS hosts, suffix-confusion hosts, credentials, and non-HTTP schemes.

- [x] **Step 2: Run the synthesis handler tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/pronunciationApiHandlers.test.ts
```

Expected: the legitimate HTTP OSS URL is rejected and the prior arbitrary HTTPS URL behavior is too permissive.

- [x] **Step 3: Implement strict host normalization**

Parse with `URL`, require `http:` or `https:`, reject username/password and non-default ports, compare a lower-case hostname against exact trusted suffix boundaries, force `https:`, and return the normalized signed URL without changing path/query/signature values.

- [x] **Step 4: Run the handler tests and confirm GREEN**

Run the Step 2 command. Expected: all handler tests pass.

### Task 3: Post-lock lease time and remaining-budget deadline

**Files:**
- Modify: `tests/pronunciationSchema.test.ts`
- Modify: `tests/pronunciationSecurity.test.ts`
- Modify: `tests/pronunciationApiHandlers.test.ts`
- Modify: `supabase/schema.sql`
- Modify: `api/pronunciationSecurity.ts`

**Interfaces:**
- RPC success result includes `granted_at` and `expires_at`.
- A pure exported helper validates timestamps and returns a provider timeout strictly smaller than the remaining lease, or `null` when the remaining budget is unsafe.

- [x] **Step 1: Write failing timing tests**

Assert SQL assigns `request_time := clock_timestamp()` only after all advisory locks and uses it for event and expiry timestamps. Assert malformed/expired/too-short leases fail closed, and an older grant produces a shorter provider timeout than the configured upstream timeout.

- [x] **Step 2: Run timing regressions and confirm RED**

Run:

```bash
node --experimental-strip-types --test \
  tests/pronunciationSchema.test.ts \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts
```

Expected: failures show pre-lock timestamp capture, absent RPC timestamps, and nominal-lease provider deadlines.

- [x] **Step 3: Implement post-lock timing and deadline calculation**

Acquire global/user/IP advisory locks first, capture one fresh `clock_timestamp()`, and use it for cleanup windows, events, and lease expiry. Return both timestamps. Parse them server-side, calculate remaining milliseconds at acquisition completion, reserve a fixed safety margin, choose `min(configuredUpstreamTimeout, remaining - margin)`, and reject before provider work if no safe positive budget remains.

- [x] **Step 4: Run timing tests and confirm GREEN**

Run the Step 2 command. Expected: all selected tests pass.

### Task 4: Queue reconciliation race

**Files:**
- Modify: `tests/reviewQueue.test.ts`
- Modify: `src/lib/reviewQueue.ts`

**Interfaces:**
- `applyReviewToQueue(queue, updated, options)` keeps review-state fields from `updated` while preserving the newest matching queue entry’s `exampleSentence` and `pronunciationExamples` for every replacement and newly inserted retry copy.

- [x] **Step 1: Write failing queue race tests**

Create queues where generated fields arrive after review submission starts but before it resolves. Cover no-retry replacement, first retry insertion, existing retry copies, and retry-attempt append; assert all resulting copies retain the newest generated values.

- [x] **Step 2: Run queue tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/reviewQueue.test.ts
```

Expected: generated fields revert to the stale values in `updated`.

- [x] **Step 3: Implement field-preserving reconciliation**

Find the latest matching queue entry, merge only its generated fields over `updated`, use that reconciled object for every matching replacement, and use it for inserted/appended retry copies.

- [x] **Step 4: Run queue tests and confirm GREEN**

Run the Step 2 command. Expected: all queue regressions pass.

### Task 5: Documentation, report, validation, and commit

**Files:**
- Modify: `.superpowers/sdd/final-fix-report.md`
- Modify: `.env.example`
- Modify: `README.md`

- [x] **Step 1: Update operator documentation**

Document `SUPABASE_SERVICE_ROLE_KEY` as server-only, remove configurable limiter policy variables, explain schema-first deployment and fail-closed behavior, and state that browser clients cannot execute limiter RPCs.

- [x] **Step 2: Run complete validation**

Run:

```bash
node --experimental-strip-types --test tests/*.test.ts
npm run build
npx eslint --quiet \
  api/pronunciationSecurity.ts \
  api/assess-pronunciation.ts \
  api/generate-pronunciation-examples.ts \
  api/synthesize-pronunciation.ts \
  src/lib/reviewQueue.ts \
  tests/pronunciationSecurity.test.ts \
  tests/pronunciationApiHandlers.test.ts \
  tests/pronunciationSchema.test.ts \
  tests/reviewQueue.test.ts
git diff --check
git diff -- package-lock.json
```

Expected: tests, build, and lint pass; diff check is clean; package-lock diff is empty.

- [x] **Step 3: Append final evidence**

Append the RED/GREEN evidence, final test/build/lint output, deployment requirements, and remaining concerns to `.superpowers/sdd/final-fix-report.md`.

- [x] **Step 4: Review and commit**

Review `git diff --stat`, `git diff`, and `git status --short`. Commit all intended files with:

```text
fix: harden pronunciation final review

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Then verify `git status --short` is empty and record `git rev-parse HEAD`.
