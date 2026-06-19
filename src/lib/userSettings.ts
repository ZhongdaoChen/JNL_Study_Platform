import { supabase, usingCloud } from './supabase';

export type ReviewMode = 'en-read' | 'en-spell' | 'zh-read' | 'zh-write';
export type ReviewLimits = Record<ReviewMode, number>;

export interface UserSettingsConfig {
  countdownSec: number;
  dailyLimits: ReviewLimits;
}

export async function loadUserSettings(): Promise<UserSettingsConfig | null> {
  if (!usingCloud || !supabase) return null;
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    countdownSec: data.countdown_sec ?? 0,
    dailyLimits: {
      'en-read': data.review_limit_en_read ?? 0,
      'en-spell': data.review_limit_en_spell ?? 0,
      'zh-read': data.review_limit_zh_read ?? 0,
      'zh-write': data.review_limit_zh_write ?? 0,
    },
  };
}

export async function saveUserSettings(settings: UserSettingsConfig): Promise<void> {
  if (!usingCloud || !supabase) throw new Error('当前未启用云端同步');
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  const userId = authData.user?.id;
  if (!userId) throw new Error('请先登录');

  const { error } = await supabase
    .from('user_settings')
    .upsert({
      owner: userId,
      countdown_sec: settings.countdownSec,
      review_limit_en_read: settings.dailyLimits['en-read'],
      review_limit_en_spell: settings.dailyLimits['en-spell'],
      review_limit_zh_read: settings.dailyLimits['zh-read'],
      review_limit_zh_write: settings.dailyLimits['zh-write'],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner' });
  if (error) throw new Error(error.message);
}
