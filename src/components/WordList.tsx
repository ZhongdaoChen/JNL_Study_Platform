import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import type { Lang, Word } from '../lib/types';
import { GRADE_LABELS } from '../lib/types';
import { today } from '../lib/date';
import { READ_FAMILIAR_THRESHOLD, SPELLING_FAMILIAR_THRESHOLD } from '../lib/sm2';

type WordFilter = 'all' | 'read-unfamiliar' | 'read-familiar' | 'spell-unfamiliar' | 'spell-familiar';

// 概览：单词/单字记忆状态一览，支持单个删除与批量多选删除
export default function WordList({ childId, lang, refreshKey }: {
  childId: string;
  lang: Lang;
  refreshKey: number;
}) {
  const [words, setWords] = useState<Word[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<WordFilter>('all');

  function reload() {
    repo.getWords(childId).then((ws) => {
      const nextWords = ws
        .filter((w) => w.lang === lang)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      setWords(nextWords);
      setSelected(new Set());
    });
  }

  useEffect(reload, [childId, lang, refreshKey]);
  useEffect(() => {
    setFilter('all');
  }, [lang, childId]);

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
      allChecked
        ? (() => {
            const next = new Set(prev);
            for (const w of filteredWords) next.delete(w.id);
            return next;
          })()
        : (() => {
            const next = new Set(prev);
            for (const w of filteredWords) next.add(w.id);
            return next;
          })(),
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

  const unit = lang === 'zh' ? '字' : '单词';
  const t = today();
  const dueCount = words.filter((w) => w.dueDate <= t).length;
  const filteredWords = words.filter((w) => matchFilter(w, filter));
  const visibleSelected = filteredWords.filter((w) => selected.has(w.id)).length;
  const allChecked = filteredWords.length > 0 && visibleSelected === filteredWords.length;

  if (words.length === 0) {
    return (
      <div className="card">
        <h2>📚 {unit}总览</h2>
        <p className="hint">还没有{unit}，先去录入今日学习内容吧。</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>📚 {unit}总览</h2>
      <p className="hint">共 {words.length} 个{unit} · 今天到期 {dueCount} 个 · 波动率越高说明最近越反复</p>

      <div className="lang-switch">
        <button className={filter === 'all' ? 'lang-btn active' : 'lang-btn'} onClick={() => setFilter('all')}>
          全部
        </button>
        <button
          className={filter === 'read-unfamiliar' ? 'lang-btn active' : 'lang-btn'}
          onClick={() => setFilter('read-unfamiliar')}
        >
          未熟悉读
        </button>
        <button
          className={filter === 'read-familiar' ? 'lang-btn active' : 'lang-btn'}
          onClick={() => setFilter('read-familiar')}
        >
          已熟悉读
        </button>
        <button
          className={filter === 'spell-unfamiliar' ? 'lang-btn active' : 'lang-btn'}
          onClick={() => setFilter('spell-unfamiliar')}
        >
          未熟悉拼
        </button>
        <button
          className={filter === 'spell-familiar' ? 'lang-btn active' : 'lang-btn'}
          onClick={() => setFilter('spell-familiar')}
        >
          已熟悉拼
        </button>
      </div>

      <div className="batch-bar">
        <label className="batch-all">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          全选
        </label>
        <button className="batch-del" onClick={deleteSelected} disabled={selected.size === 0}>
          🗑️ 删除选中 ({selected.size})
        </button>
      </div>

      {filteredWords.length === 0 ? (
        <p className="hint">当前筛选下没有符合条件的{unit}。</p>
      ) : (
        <table className="word-table">
          <thead>
            <tr>
              <th></th>
              <th>{unit}</th>
              <th>下次复习</th>
              <th>间隔(天)</th>
              <th>读熟练度</th>
              <th>拼写熟练度</th>
              <th>熟练度波动率</th>
              <th>上次</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredWords.map((w) => (
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
                <td>{w.dueDate}</td>
                <td>{w.interval}</td>
                <td>{formatReadProficiency(w.repetitions)}</td>
                <td>{formatSpellingProficiency(w.spellingRepetitions)}</td>
                <td>{formatVolatilityRate(w.volatilityRate)}</td>
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
      )}
    </div>
  );
}

function matchFilter(w: Word, filter: WordFilter): boolean {
  switch (filter) {
    case 'read-unfamiliar':
      return w.repetitions < READ_FAMILIAR_THRESHOLD;
    case 'read-familiar':
      return w.repetitions >= READ_FAMILIAR_THRESHOLD;
    case 'spell-unfamiliar':
      return w.repetitions >= READ_FAMILIAR_THRESHOLD
        && w.spellingRepetitions < SPELLING_FAMILIAR_THRESHOLD;
    case 'spell-familiar':
      return w.repetitions >= READ_FAMILIAR_THRESHOLD
        && w.spellingRepetitions >= SPELLING_FAMILIAR_THRESHOLD;
    default:
      return true;
  }
}

function formatReadProficiency(repetitions: number): string {
  const pct = Math.min(100, Math.max(0, repetitions) * 25);
  return `${pct}%`;
}

function formatSpellingProficiency(repetitions: number): string {
  const pct = Math.min(100, Math.max(0, repetitions) * 20);
  return `${pct}%`;
}

function formatVolatilityRate(rate: number): string {
  return `${Math.max(0, Math.min(100, Math.round(rate)))}%`;
}
