import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// 云端是否已配置（填了密钥即启用 Supabase 同步）
export const usingCloud = Boolean(url && anonKey);

// 仅在配置了密钥时创建客户端，否则为 null（本地存储模式）
export const supabase = usingCloud
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true, // 记住登录状态，换标签/重开仍在线
        autoRefreshToken: true,
      },
    })
  : null;
