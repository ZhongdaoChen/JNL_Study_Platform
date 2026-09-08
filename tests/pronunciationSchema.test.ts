import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../supabase/schema.sql', import.meta.url);

test('schema provides authenticated distributed pronunciation rate and concurrency leases', async () => {
  const sql = await readFile(schemaPath, 'utf8');

  assert.match(sql, /create table if not exists pronunciation_request_events/i);
  assert.match(sql, /create table if not exists pronunciation_request_leases/i);
  assert.match(sql, /create or replace function acquire_pronunciation_request/i);
  assert.match(sql, /create or replace function release_pronunciation_request/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
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
