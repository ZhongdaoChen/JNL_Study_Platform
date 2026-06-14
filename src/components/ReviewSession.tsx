import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import { getDueReviews, submitReview } from '../lib/wordService';
import type { Grade, Sentence, Word } from '../lib/types';
import { GRADE_LABELS } from '../lib/types';

// 模块2 + 模块3：今日复习清单 + 逐词三档反馈
export default function ReviewSession({ childId, onChanged }: {
  childId: string;
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<Word[]>([]);
  const [sentences, setSentences] = useState<Record<string, Sentence>>({});
  const [idx, setIdx] = useState(0);
  const [showContext, setShowContext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const due = await getDueReviews(repo, childId);
      const sents = await repo.getSentences(childId);
      if (!active) return;
      setQueue(due);
      setSentences(Object.fromEntries(sents.map((s) => [s.id, s])));
      setIdx(0);
      setDoneCount(0);
      setShowContext(false);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // 仅在进入复习页/切换孩子时加载一次队列；
    // 评分过程中不重载，避免进度被重置（onChanged 只用于刷新其他标签）。
  }, [childId]);

  const current = queue[idx];

  async function grade(g: Grade) {
    if (!current) return;
    await submitReview(repo, current, g);
    setDoneCount((c) => c + 1);
    setShowContext(false);
    setIdx((i) => i + 1);
    onChanged();
  }

  if (loading) return <div className="card"><p>加载中…</p></div>;

  if (queue.length === 0) {
    return (
      <div className="card">
        <h2>🔁 今日复习</h2>
        <p className="hint">今天没有需要复习的单词，太棒了！去录入新内容吧。</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="card">
        <h2>🎉 复习完成</h2>
        <p className="hint">今天复习了 {doneCount} 个单词，已更新复习计划。</p>
      </div>
    );
  }

  const contextSentence = current.sentenceIds
    .map((id) => sentences[id]?.text)
    .find(Boolean);

  return (
    <div className="card">
      <h2>🔁 今日复习（共 {queue.length} 个）</h2>
      <p className="hint">第 {idx + 1} / {queue.length} 个 · 让孩子读出这个词</p>

      <div className="word-card">
        <div className="big-word">{current.text}</div>
        {showContext ? (
          <p className="context">{contextSentence ?? '（无语境句子）'}</p>
        ) : (
          <button className="link-btn" onClick={() => setShowContext(true)}>
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
