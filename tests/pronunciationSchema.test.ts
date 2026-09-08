import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../supabase/schema.sql', import.meta.url);

test('schema exposes only service-role pronunciation limiter RPCs with trusted policy', async () => {
  const sql = await readFile(schemaPath, 'utf8');

  assert.match(sql, /create table if not exists pronunciation_request_events/i);
  assert.match(sql, /create table if not exists pronunciation_request_leases/i);
  assert.match(sql, /add column if not exists resource_key text/i);
  assert.match(sql, /add column if not exists model_key text/i);
  assert.match(
    sql,
    /create or replace function acquire_pronunciation_request\(\s*p_owner uuid,\s*p_operation text,\s*p_ip_hash text\s*\)/i,
  );
  assert.match(
    sql,
    /create or replace function release_pronunciation_request\(\s*p_owner uuid,\s*p_lease_id uuid\s*\)/i,
  );
  assert.match(sql, /auth\.role\(\)\s+is distinct from\s+'service_role'/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /pronunciation:global:/i);
  assert.match(sql, /global_per_second := 3/i);
  assert.match(sql, /global_per_minute := 180/i);
  assert.match(sql, /resource_key := 'dashscope-tts'/i);
  assert.match(sql, /model_key := 'qwen3-tts-flash'/i);
  assert.doesNotMatch(sql, /\bp_(?:scope|endpoint|resource_key|model_key|global_per_second|global_per_minute|window_seconds|principal_limit|ip_limit|principal_concurrency|ip_concurrency|lease_seconds)\b/i);
  assert.match(sql, /request_time - interval '1 second'/i);
  assert.match(sql, /request_time - interval '1 minute'/i);
  assert.match(sql, /resource_key = policy_resource_key/i);
  assert.match(sql, /model_key = policy_model_key/i);
  assert.match(sql, /expires_at <= request_time/i);
  assert.match(sql, /'granted_at', request_time/i);
  assert.match(sql, /'expires_at', lease_expires_at/i);

  const acquireFunction = sql.slice(
    sql.indexOf('create or replace function acquire_pronunciation_request'),
    sql.indexOf('create or replace function release_pronunciation_request'),
  );
  const lastLock = acquireFunction.lastIndexOf('pg_advisory_xact_lock');
  const freshTimestamp = acquireFunction.indexOf('request_time := clock_timestamp()');
  assert.ok(lastLock >= 0);
  assert.ok(freshTimestamp > lastLock);

  assert.match(
    sql,
    /revoke all on function acquire_pronunciation_request\(\s*uuid,\s*text,\s*text\s*\) from public,\s*anon,\s*authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on function release_pronunciation_request\(\s*uuid,\s*uuid\s*\)\s*from public,\s*anon,\s*authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function acquire_pronunciation_request\(\s*uuid,\s*text,\s*text\s*\) to service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function release_pronunciation_request\(\s*uuid,\s*uuid\s*\)\s*to service_role/i,
  );
});
