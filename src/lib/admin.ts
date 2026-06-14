import { supabase } from './supabase';

// 管理员邮箱：只有该用户登录后才显示管理员页面。
export const ADMIN_EMAIL = 'chenzhongdao0730@gmail.com';

export interface AdminUserStat {
  email: string;
  last_sign_in_at: string | null;
  created_at: string;
  word_count: number;
  en_count: number;
  zh_count: number;
}

export interface AdminWord {
  email: string;
  child_name: string;
  lang: string;
  word: string;
  repetitions: number;
  due_date: string;
  first_learned_at: string;
}

export interface AdminFeedback {
  email: string;
  content: string;
  created_at: string;
}

async function rpc<T>(fn: string): Promise<T[]> {
  if (!supabase) throw new Error('管理员页面仅在云端模式可用');
  const { data, error } = await supabase.rpc(fn);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export const getAdminUserStats = () => rpc<AdminUserStat>('admin_user_stats');
export const getAdminWords = () => rpc<AdminWord>('admin_words');
export const getAdminFeedback = () => rpc<AdminFeedback>('admin_feedback');
