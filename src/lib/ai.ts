// 前端调用内部 Serverless 接口生成例句。
// 真正的 Qwen API Key 只存在服务端(Vercel 环境变量)，前端拿不到，保证安全。
// lang=en：生成简单英文例句；lang=zh：生成包含该汉字的简单中文句子。
export async function generateExampleSentence(
  word: string,
  lang: 'en' | 'zh' = 'en',
): Promise<string> {
  const res = await fetch('/api/generate-sentence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, lang }),
  });

  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      detail = data.error || detail;
    } catch {
      // 本地 npm run dev 时没有 Serverless 接口，会落到这里
      detail = '例句服务不可用（本地开发请用 vercel dev，或部署到 Vercel）';
    }
    throw new Error(detail);
  }

  const data = await res.json();
  const sentence = (data.sentence ?? '').trim();
  if (!sentence) throw new Error('未生成例句，请重试');
  return sentence;
}
