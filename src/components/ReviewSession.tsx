import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import { getDueReviews, submitReview } from '../lib/wordService';
import { generateExampleSentence } from '../lib/ai';
import type { Grade, Lang, Word } from '../lib/types';
import { GRADE_LABELS } from '../lib/types';

// 模块2 + 模块3：今日复习清单 + 逐词三档反馈 + AI 例句提示
export default function ReviewSession({ childId, lang, onChanged }: {
  childId: string;
  lang: Lang;
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [showExample, setShowExample] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const due = await getDueReviews(repo, childId, lang);
      if (!active) return;
      setQueue(due);
      setIdx(0);
      setDoneCount(0);
      setShowExample(false);
      setGenError(null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // 进入复习页/切换孩子/切换语言时各加载一次队列；
    // 评分过程中不重载，避免进度被重置（onChanged 只用于刷新其他标签）。
  }, [childId, lang]);

  const current = queue[idx];

  async function grade(g: Grade) {
    if (!current) return;
    await submitReview(repo, current, g);
    setDoneCount((c) => c + 1);
    setShowExample(false);
    setGenError(null);
    setIdx((i) => i + 1);
    onChanged();
  }

  // 生成例句并落库；force=true 时强制重新生成（换一句）
  async function generate(force: boolean) {
    if (!current) return;
    if (!force && current.exampleSentence) return; // 已有则不重复生成
    setGenLoading(true);
    setGenError(null);
    try {
      const sentence = await generateExampleSentence(current.text, lang);
      const updated: Word = { ...current, exampleSentence: sentence };
      await repo.upsertWord(updated);
      setQueue((q) => q.map((w) => (w.id === updated.id ? updated : w)));
    } catch (e: any) {
      setGenError(e?.message || '生成失败');
    } finally {
      setGenLoading(false);
    }
  }

  function handleShowExample() {
    setShowExample(true);
    if (current && !current.exampleSentence) generate(false);
  }

  const unit = lang === 'zh' ? '字' : '单词';

  if (loading) return <div className="card"><p>加载中…</p></div>;

  if (queue.length === 0) {
    return (
      <div className="card">
        <h2>🔁 今日复习</h2>
        <p className="hint">今天没有需要复习的{unit}，太棒了！去录入新内容吧。</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="card">
        <h2>🎉 复习完成</h2>
        <p className="hint">今天复习了 {doneCount} 个{unit}，已更新复习计划。</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>🔁 今日复习（共 {queue.length} 个）</h2>
      <p className="hint">第 {idx + 1} / {queue.length} 个 · 让孩子读出这个{unit}</p>

      <div className="word-card">
        <div className="big-word">{current.text}</div>

        {showExample ? (
          <div className="example-area">
            {genLoading ? (
              <p className="context">✨ 正在生成例句…</p>
            ) : genError ? (
              <p className="example-error">{genError}</p>
            ) : (
              <p className="context">{current.exampleSentence ?? '（暂无例句）'}</p>
            )}
            <button className="link-btn" onClick={() => generate(true)} disabled={genLoading}>
              {genLoading ? '生成中…' : '🔄 换一句'}
            </button>
          </div>
        ) : (
          <button className="link-btn" onClick={handleShowExample}>
            看例句提示
          </button>
        )}
      </div>

      <div className="grade-buttons">
        <button className="g-mastered" onClick={() => grade('mastered')}>
          {GRADE_LABELS.mastered}
        </button>
        <button className="g-fuzzy" onClick={() => grade('fuzzy')}>
          {GRADE_LABELS.fuzzy}
        </button>
        <button className="g-forgotten" onClick={() => grade('forgotten')}>
          {GRADE_LABELS.forgotten}
        </button>
      </div>
    </div>
  );
}
