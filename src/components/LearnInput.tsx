import { useState } from 'react';
import { repo } from '../lib/db';
import { addLearning } from '../lib/wordService';
import { today } from '../lib/date';

// 模块1：录入今日学习的新句子，自动拆词
export default function LearnInput({ childId, onChanged }: { childId: string; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [learnedOn, setLearnedOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ newWords: string[]; reviewedExisting: string[] } | null>(null);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const r = await addLearning(repo, childId, trimmed, learnedOn);
      setResult({ newWords: r.newWords, reviewedExisting: r.reviewedExisting });
      setText('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>📝 录入新句子</h2>
      <p className="hint">输入一句英文，应用会自动拆成单词并开始跟踪记忆。</p>

      <label className="field-label">学习日期</label>
      <input
        className="date-input"
        type="date"
        value={learnedOn}
        max={today()}
        onChange={(e) => setLearnedOn(e.target.value)}
      />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例如：The cat is sleeping on the bed."
        rows={3}
      />
      <button onClick={handleSubmit} disabled={busy || !text.trim()}>
        {busy ? '处理中…' : '拆词并保存'}
      </button>

      {result && (
        <div className="result">
          {result.newWords.length > 0 && (
            <p>
              ✅ 新增 {result.newWords.length} 个单词：
              {result.newWords.map((w) => (
                <span key={w} className="tag tag-new">{w}</span>
              ))}
            </p>
          )}
          {result.reviewedExisting.length > 0 && (
            <p>
              🔁 已学过的词：
              {result.reviewedExisting.map((w) => (
                <span key={w} className="tag">{w}</span>
              ))}
            </p>
          )}
          {result.newWords.length === 0 && result.reviewedExisting.length === 0 && (
            <p>没有可识别的单词。</p>
          )}
        </div>
      )}
    </div>
  );
}
