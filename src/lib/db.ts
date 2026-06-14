import type { Repo } from './repo';
import { LocalRepo } from './localRepo';
import { SupabaseRepo } from './supabaseRepo';
import { supabase, usingCloud } from './supabase';

export { usingCloud };

// 仓储单例：配置了 Supabase 密钥则用云端同步，否则用浏览器本地存储。
export const repo: Repo =
  usingCloud && supabase ? new SupabaseRepo(supabase) : new LocalRepo();
