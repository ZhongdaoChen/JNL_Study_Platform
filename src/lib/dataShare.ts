import { supabase, usingCloud } from './supabase';

export interface ShareDataResult {
  created_children: number;
  inserted_sentences: number;
  upserted_words: number;
  inserted_logs: number;
}

export async function shareDataToEmail(targetEmail: string): Promise<ShareDataResult> {
  if (!usingCloud || !supabase) throw new Error('数据共享仅在云端模式可用');
  const email = targetEmail.trim();
  if (!email) throw new Error('请输入目标邮箱');

  const { data, error } = await supabase.rpc('share_data_to_email', {
    target_email: email,
  });
  if (error) throw new Error(error.message);
  return (data?.[0] ?? {
    created_children: 0,
    inserted_sentences: 0,
    upserted_words: 0,
    inserted_logs: 0,
  }) as ShareDataResult;
}
