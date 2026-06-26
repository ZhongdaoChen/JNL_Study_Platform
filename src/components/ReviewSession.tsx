import { useEffect, useRef, useState } from 'react';
import { repo } from '../lib/db';
import { getDueReviews, submitReview } from '../lib/wordService';
import { generateExampleSentence } from '../lib/ai';
import type { Grade, Lang, Word } from '../lib/types';
import { GRADE_LABELS } from '../lib/types';
import { today } from '../lib/date';
import { toChineseCount } from '../lib/chineseNumerals';

// 模块2 + 模块3：今日复习清单 + 逐词三档反馈 + AI 例句提示
export default function ReviewSession({ childId, lang, spellingOnly, countdownSec, dailyLimit, onChanged }: {
  childId: string;
  lang: Lang;
  spellingOnly: boolean;
  countdownSec: number;
  dailyLimit: number;
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [showExample, setShowExample] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 倒计时剩余毫秒（仅显示用）。0 或 countdownSec<=0 时不启用倒计时。
  const [remainMs, setRemainMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const remainRef = useRef(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const due = await getDueReviews(repo, childId, lang, spellingOnly, dailyLimit);
      if (!active) return;
      setQueue(due);
      setIdx(0);
      setDoneCount(0);
      setShowExample(false);
      setGenError(null);
      setSaveError(null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // 进入复习页/切换孩子/切换语言时各加载一次队列；
    // 评分过程中不重载，避免进度被重置（onChanged 只用于刷新其他标签）。
  }, [childId, lang, spellingOnly, dailyLimit]);

  const current = queue[idx];

  // 始终持有最新的 grade，供倒计时回调调用（避免把 grade 放进定时器依赖导致重置）
  const gradeRef = useRef<(g: Grade) => void>(() => {});

  // 切换词或修改配置时重置倒计时
  useEffect(() => {
    const totalMs = countdownSec * 1000;
    remainRef.current = current && countdownSec > 0 ? totalMs : 0;
    setRemainMs(remainRef.current);
    setIsPaused(false);
  }, [current?.id, countdownSec]);

  // 倒计时：每个词展示时启动；归零且用户未评分则自动判「彻底陌生」并跳下一个
  useEffect(() => {
    if (!current || countdownSec <= 0 || isPaused || remainRef.current <= 0) return;
    const startRemain = remainRef.current;
    const start = Date.now();
    const id = window.setInterval(() => {
      const left = startRemain - (Date.now() - start);
      if (left <= 0) {
        window.clearInterval(id);
        remainRef.current = 0;
        setRemainMs(0);
        gradeRef.current('forgotten');
      } else {
        remainRef.current = left;
        setRemainMs(left);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [current?.id, countdownSec, isPaused]);

  // 乐观更新：先切到下一张卡，保存放后台执行，失败再提示
  function grade(g: Grade) {
    if (!current) return;
    const todayStr = today();
    const isRetryAttempt = spellingOnly
      ? current.spellingPendingRetryCount > 0 && current.spellingDueDate <= todayStr
      : current.pendingRetryCount > 0 && current.dueDate <= todayStr;
    setDoneCount((c) => c + 1);
    setShowExample(false);
    setGenError(null);
    setSaveError(null);
    setIdx((i) => i + 1);
    submitReview(repo, current, g, spellingOnly, isRetryAttempt)
      .then((updated) => {
        setQueue((q) => {
          const next = q.map((w) => (w.id === updated.id ? updated : w));
          const pendingRetryCount = spellingOnly
            ? updated.spellingPendingRetryCount
            : updated.pendingRetryCount;
          return pendingRetryCount > 0 ? [...next, updated] : next;
        });
        onChanged();
      })
      .catch((e: any) => {
        setSaveError(`「${current.text}」保存失败：${e?.message || '请检查网络'}`);
      });
  }
  gradeRef.current = grade;

  // 在队列中前后切换，不评分
  function goTo(i: number) {
    setShowExample(false);
    setGenError(null);
    setIdx(Math.min(Math.max(i, 0), queue.length - 1));
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

  // 删除当前复习的词：从队列移除并跳到下一个
  async function deleteCurrent() {
    if (!current) return;
    if (!confirm(`确定删除「${current.text}」吗？此操作不可恢复。`)) return;
    const target = current;
    await repo.deleteWord(target.id);
    setQueue((q) => q.filter((w) => w.id !== target.id));
    setShowExample(false);
    setGenError(null);
    onChanged();
  }

  function togglePause() {
    if (countdownSec <= 0) return;
    setIsPaused((v) => !v);
  }

  const unit = lang === 'zh' ? '字' : '单词';
  const modeLabel = spellingOnly ? (lang === 'zh' ? '会写' : '拼写') : '复习';

  if (loading) return <div className="card"><p>加载中…</p></div>;

  if (queue.length === 0) {
    return (
      <div className="card">
        <h2>🔁 今日{modeLabel}</h2>
        <p className="hint">
          {spellingOnly
            ? `今天没有需要${modeLabel}的${unit}，太棒了！读熟悉度达到 4 后会自动进入这里。`
            : `今天没有需要复习的${unit}，太棒了！去录入新内容吧。`}
        </p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="card">
        <h2>🎉 {modeLabel}完成</h2>
        <p className="hint">今天{modeLabel}了 {doneCount} 个{unit}，已更新复习计划。</p>
      </div>
    );
  }

  const action = spellingOnly
    ? lang === 'zh'
      ? '让孩子写出这个字'
      : '让孩子拼出这个单词'
    : `让孩子读出这个${unit}`;
  const instantLabel = spellingOnly ? (lang === 'zh' ? '秒写' : '秒拼') : GRADE_LABELS.instant;

  return (
    <div className="card review-card">
      <div className="review-actions">
        {countdownSec > 0 && (
          <button
            className="review-icon-btn"
            onClick={togglePause}
            title={isPaused ? '继续倒计时' : '暂停倒计时'}
            aria-label={isPaused ? '继续倒计时' : '暂停倒计时'}
          >
            {isPaused ? '▶' : '⏸'}
          </button>
        )}
        <button
          className="review-icon-btn review-del-btn"
          onClick={deleteCurrent}
          title={`删除该${unit}`}
          aria-label={`删除该${unit}`}
        >
          🗑
        </button>
      </div>
      <h2>🔁 今日{modeLabel}（共 {toChineseCount(queue.length)} 个）</h2>
      <p className="hint">第 {toChineseCount(idx + 1)} / {toChineseCount(queue.length)} 个 · {action}</p>

      <div className="word-row">
        <button
          className="word-arrow"
          onClick={() => goTo(idx - 1)}
          disabled={idx === 0}
          title="上一个"
          aria-label="上一个"
        >
          ‹
        </button>

        <div className="word-card">
          <div className="big-word">{current.text}</div>

          {showExample ? (
            <div className="example-area">
              {genLoading ? (
                <p className="context">✨ AI正在生成例句…</p>
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
                {spellingOnly ? '看例句提示' : '看例句提示'}
            </button>
          )}
        </div>

        <button
          className="word-arrow"
          onClick={() => goTo(idx + 1)}
          disabled={idx >= queue.length - 1}
          title="下一个"
          aria-label="下一个"
        >
          ›
        </button>
      </div>

      {countdownSec > 0 && (() => {
        const pct = Math.max(0, Math.min(100, (remainMs / (countdownSec * 1000)) * 100));
        const hue = (pct / 100) * 120; // 120=绿(时间多) → 0=红(快超时)
        return (
          <div
            className={`countdown-bar${isPaused ? ' paused' : ''}`}
            title={isPaused ? '倒计时已暂停' : `${(remainMs / 1000).toFixed(1)} 秒后自动判彻底陌生`}
          >
            <div
              className="countdown-bar-fill"
              style={{ width: `${pct}%`, background: `hsl(${hue}, 80%, 50%)` }}
            />
          </div>
        );
      })()}

      <div className="grade-buttons">
        <button className="g-instant" onClick={() => grade('instant')}>
          {instantLabel}
        </button>
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

      {saveError && <p className="example-error">{saveError}</p>}
    </div>
  );
}
