import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import type { Lang, Word } from '../lib/types';
import { GRADE_LABELS } from '../lib/types';
import { today } from '../lib/date';

// 概览：单词/单字记忆状态一览，支持单个删除与批量多选删除
export default function WordList({ childId, lang, refreshKey, countdownSec, onCountdownChange }: {
  childId: string;
  lang: Lang;
  refreshKey: number;
  countdownSec: number;
  onCountdownChange: (sec: number) => void;
}) {
  const [words, setWords] = useState<Word[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function reload() {
    repo.getWords(childId).then((ws) => {
      setWords(
        ws
          .filter((w) => w.lang === lang)
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
      );
      setSelected(new Set());
    });
  }

  useEffect(reload, [childId, lang, refreshKey]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === words.length ? new Set() : new Set(words.map((w) => w.id)),
    );
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`确定删除选中的 ${ids.length} 个${unit}吗？它们的复习记录也会一并删除。`)) return;
    await repo.deleteWords(ids);
    const removed = new Set(ids);
    setWords((prev) => prev.filter((w) => !removed.has(w.id)));
    setSelected(new Set());
  }

  async function deleteOne(w: Word) {
    if (!confirm(`确定删除${unit} “${w.text}” 吗？该${unit}的复习记录也会一并删除。`)) return;
    await repo.deleteWord(w.id);
    setWords((prev) => prev.filter((x) => x.id !== w.id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(w.id);
      return next;
    });
  }

  async function toggleSpelling(w: Word) {
    const updated = { ...w, needsSpelling: !w.needsSpelling };
    setWords((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    await repo.upsertWord(updated);
  }

  const unit = lang === 'zh' ? '字' : '单词';
  const spellLabel = lang === 'zh' ? '需会写' : '需拼写';
  const t = today();
  const dueCount = words.filter((w) => w.dueDate <= t).length;
  const allChecked = words.length > 0 && selected.size === words.length;

  const countdownConfig = (
    <div className="countdown-config">
      <label className="field-label">复习倒计时（秒，0=关闭）</label>
      <input
        className="date-input"
        type="number"
        min={0}
        max={600}
        value={countdownSec}
        onChange={(e) => onCountdownChange(Number(e.target.value))}
      />
      <span className="hint">超时未评分将自动判为「彻底陌生」并跳到下一个。</span>
    </div>
  );

  if (words.length === 0) {
    return (
      <div className="card">
        <h2>📚 {unit}总览</h2>
        {countdownConfig}
        <p className="hint">还没有{unit}，先去录入今日学习内容吧。</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>📚 {unit}总览</h2>
      {countdownConfig}
      <p className="hint">共 {words.length} 个{unit} · 今天到期 {dueCount} 个</p>

      <div className="batch-bar">
        <label className="batch-all">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          全选
        </label>
        <button className="batch-del" onClick={deleteSelected} disabled={selected.size === 0}>
          🗑️ 删除选中 ({selected.size})
        </button>
      </div>

      <table className="word-table">
        <thead>
          <tr>
            <th></th>
            <th>{unit}</th>
            <th>{spellLabel}</th>
            <th>下次复习</th>
            <th>间隔(天)</th>
            <th>连对</th>
            <th>上次</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {words.map((w) => (
            <tr
              key={w.id}
              className={selected.has(w.id) ? 'row-selected' : w.dueDate <= t ? 'row-due' : ''}
            >
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(w.id)}
                  onChange={() => toggle(w.id)}
                />
              </td>
              <td>{w.text}</td>
              <td>
                <input
                  type="checkbox"
                  checked={w.needsSpelling}
                  onChange={() => toggleSpelling(w)}
                  title={spellLabel}
                />
              </td>
              <td>{w.dueDate}</td>
              <td>{w.interval}</td>
              <td>{w.repetitions}</td>
              <td>{w.lastGrade ? GRADE_LABELS[w.lastGrade] : '—'}</td>
              <td>
                <button className="del-btn" onClick={() => deleteOne(w)} title="删除单词">
                  🗑️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
