import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import type { Child } from '../lib/types';
import LearnInput from './LearnInput';
import ReviewSession from './ReviewSession';
import WordList from './WordList';
import StatsBoard from './StatsBoard';

type Tab = 'learn' | 'review' | 'words' | 'stats';

// 工作区：登录后（或本地模式）显示的主体。管理孩子档案与三大模块。
export default function Workspace() {
  const [children, setChildren] = useState<Child[]>([]);
  const [activeChild, setActiveChild] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('learn');
  const [refreshKey, setRefreshKey] = useState(0);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repo
      .listChildren()
      .then((cs) => {
        setChildren(cs);
        if (cs.length > 0) setActiveChild((prev) => prev ?? cs[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function addChild() {
    const name = newName.trim();
    if (!name) return;
    try {
      const c = await repo.addChild(name);
      setChildren((prev) => [...prev, c]);
      setActiveChild(c.id);
      setNewName('');
    } catch (e: any) {
      setError(e.message);
    }
  }

  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <>
      {error && <div className="card error-card">⚠️ {error}</div>}

      <div className="child-bar">
        {children.map((c) => (
          <button
            key={c.id}
            className={c.id === activeChild ? 'chip active' : 'chip'}
            onClick={() => setActiveChild(c.id)}
          >
            {c.name}
          </button>
        ))}
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新增孩子姓名"
          onKeyDown={(e) => e.key === 'Enter' && addChild()}
        />
        <button onClick={addChild} disabled={!newName.trim()}>＋</button>
      </div>

      {!activeChild ? (
        <div className="card">
          <p className="hint">请先在上方新增一个孩子，然后开始学习。</p>
        </div>
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === 'learn' ? 'active' : ''} onClick={() => setTab('learn')}>录入</button>
            <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>复习</button>
            <button className={tab === 'words' ? 'active' : ''} onClick={() => setTab('words')}>总览</button>
            <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>统计</button>
          </nav>

          {tab === 'learn' && <LearnInput childId={activeChild} onChanged={bump} />}
          {tab === 'review' && (
            <ReviewSession childId={activeChild} onChanged={bump} />
          )}
          {tab === 'words' && <WordList childId={activeChild} refreshKey={refreshKey} />}
          {tab === 'stats' && <StatsBoard childId={activeChild} refreshKey={refreshKey} />}
        </>
      )}
    </>
  );
}
