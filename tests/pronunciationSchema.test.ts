import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../supabase/schema.sql', import.meta.url);

test('schema provides authenticated distributed pronunciation rate and concurrency leases', async () => {
  const sql = await readFile(schemaPath, 'utf8');

  assert.match(sql, /create table if not exists pronunciation_request_events/i);
  assert.match(sql, /create table if not exists pronunciation_request_leases/i);
  assert.match(sql, /add column if not exists resource_key text/i);
  assert.match(sql, /add column if not exists model_key text/i);
  assert.match(sql, /create or replace function acquire_pronunciation_request/i);
  assert.match(sql, /create or replace function release_pronunciation_request/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /pronunciation:global:/i);
  assert.match(sql, /p_global_per_second/i);
  assert.match(sql, /p_global_per_minute/i);
  assert.match(sql, /coalesce\(p_global_per_second,\s*0\) not between 1 and 3/i);
  assert.match(sql, /coalesce\(p_global_per_minute,\s*0\) not between 1 and 180/i);
  assert.match(sql, /request_time - interval '1 second'/i);
  assert.match(sql, /request_time - interval '1 minute'/i);
  assert.match(sql, /resource_key = p_resource_key/i);
  assert.match(sql, /model_key = p_model_key/i);
  assert.match(sql, /expires_at <= request_time/i);
  assert.match(
    sql,
    /grant execute on function acquire_pronunciation_request[\s\S]*to authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function release_pronunciation_request[\s\S]*to authenticated/i,
  );
});
