import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import { supabase, usingCloud } from '../lib/supabase';
import { ADMIN_EMAIL } from '../lib/admin';
import type { Child, Lang } from '../lib/types';
import { LANG_LABELS } from '../lib/types';
import { loadUserSettings, saveUserSettings, type ReviewLimits } from '../lib/userSettings';
import LearnInput from './LearnInput';
import ReviewSession from './ReviewSession';
import WordList from './WordList';
import StatsBoard from './StatsBoard';
import Settings from './Settings';
import Changelog from './Changelog';
import AdminPanel from './AdminPanel';

type Tab = 'learn' | 'review' | 'words' | 'stats' | 'settings' | 'admin';

// 复习模式：英文/中文 × 读/拼写。"拼写/会写"模式只复习已达到读熟悉阈值的词。
type ReviewMode = 'en-read' | 'en-spell' | 'zh-read' | 'zh-write';
const REVIEW_MODES: { key: ReviewMode; label: string; lang: Lang; spellingOnly: boolean }[] = [
  { key: 'en-read', label: '英文读', lang: 'en', spellingOnly: false },
  { key: 'en-spell', label: '英文拼', lang: 'en', spellingOnly: true },
  { key: 'zh-read', label: '中文读', lang: 'zh', spellingOnly: false },
  { key: 'zh-write', label: '中文写', lang: 'zh', spellingOnly: true },
];

// 工作区：登录后（或本地模式）显示的主体。管理孩子档案与三大模块。
export default function Workspace({ onCompactChange }: { onCompactChange: (compact: boolean) => void }) {
  const [children, setChildren] = useState<Child[]>([]);
  const [activeChild, setActiveChild] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('learn');
  // 复习模块的子标签（英文读/英文拼/中文读/中文写）。
  const [reviewMode, setReviewMode] = useState<ReviewMode>('en-read');
  // 总览模块内的语言子标签（英文/中文）。
  const [subLang, setSubLang] = useState<Lang>('en');
  const [refreshKey, setRefreshKey] = useState(0);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsSaveBusy, setSettingsSaveBusy] = useState(false);
  const [settingsSaveMsg, setSettingsSaveMsg] = useState<string | null>(null);
  // 复习倒计时时长（秒），0=关闭。全局设置，持久化到 localStorage。
  const [countdownSec, setCountdownSecState] = useState<number>(() => {
    const v = Number(localStorage.getItem('review-countdown-sec'));
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const [dailyLimits, setDailyLimits] = useState<ReviewLimits>(() => ({
    'en-read': readStoredPositiveInt('review-limit-en-read'),
    'en-spell': readStoredPositiveInt('review-limit-en-spell'),
    'zh-read': readStoredPositiveInt('review-limit-zh-read'),
    'zh-write': readStoredPositiveInt('review-limit-zh-write'),
  }));
  const applySettings = (nextCountdownSec: number, nextDailyLimits: ReviewLimits) => {
    const normalizedCountdownSec = normalizeNonNegativeInt(nextCountdownSec);
    const normalizedDailyLimits: ReviewLimits = {
      'en-read': normalizeNonNegativeInt(nextDailyLimits['en-read']),
      'en-spell': normalizeNonNegativeInt(nextDailyLimits['en-spell']),
      'zh-read': normalizeNonNegativeInt(nextDailyLimits['zh-read']),
      'zh-write': normalizeNonNegativeInt(nextDailyLimits['zh-write']),
    };
    setCountdownSecState(normalizedCountdownSec);
    setDailyLimits(normalizedDailyLimits);
    localStorage.setItem('review-countdown-sec', String(normalizedCountdownSec));
    localStorage.setItem('review-limit-en-read', String(normalizedDailyLimits['en-read']));
    localStorage.setItem('review-limit-en-spell', String(normalizedDailyLimits['en-spell']));
    localStorage.setItem('review-limit-zh-read', String(normalizedDailyLimits['zh-read']));
    localStorage.setItem('review-limit-zh-write', String(normalizedDailyLimits['zh-write']));
  };
  const setCountdownSec = (n: number) => {
    applySettings(n, dailyLimits);
    setSettingsSaveMsg(null);
  };
  const setDailyLimit = (mode: ReviewMode, n: number) => {
    applySettings(countdownSec, { ...dailyLimits, [mode]: n });
    setSettingsSaveMsg(null);
  };

  useEffect(() => {
    repo
      .listChildren()
      .then((cs) => {
        setChildren(cs);
        if (cs.length > 0) setActiveChild((prev) => prev ?? cs[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!usingCloud || !supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setIsAdmin(data.user?.email === ADMIN_EMAIL);
    });
  }, []);

  useEffect(() => {
    if (!usingCloud) return;
    let active = true;
    loadUserSettings()
      .then((settings) => {
        if (!active || !settings) return;
        applySettings(settings.countdownSec, settings.dailyLimits);
      })
      .catch((e: any) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  // 非「录入」标签时进入精简模式，由 App 隐藏标题行
  useEffect(() => {
    onCompactChange(tab !== 'learn');
  }, [tab, onCompactChange]);

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

  async function handleSaveSettings() {
    if (!usingCloud) {
      setSettingsSaveMsg('当前是本地模式，登录云端后才可跨设备同步配置。');
      return;
    }
    setSettingsSaveBusy(true);
    setSettingsSaveMsg(null);
    try {
      await saveUserSettings({ countdownSec, dailyLimits });
      setSettingsSaveMsg('配置已提交并落库，之后该用户在任意设备登录都会使用这份最新配置。');
    } catch (e: any) {
      setSettingsSaveMsg(`提交配置失败：${e?.message || '请稍后重试'}`);
    } finally {
      setSettingsSaveBusy(false);
    }
  }

  return (
    <>
      {error && <div className="card error-card">⚠️ {error}</div>}

      {tab === 'learn' && (
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
          {children.length === 0 && (
            <>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新增孩子姓名"
                onKeyDown={(e) => e.key === 'Enter' && addChild()}
              />
              <button onClick={addChild} disabled={!newName.trim()}>＋</button>
            </>
          )}
        </div>
      )}

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
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>配置</button>
            {isAdmin && (
              <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>管理员</button>
            )}
          </nav>

          {tab === 'learn' && <LearnInput childId={activeChild} onChanged={bump} />}
          {tab === 'learn' && <Changelog />}

          {tab === 'review' && (
            <>
              <div className="lang-switch">
                {REVIEW_MODES.map((m) => (
                  <button
                    key={m.key}
                    className={reviewMode === m.key ? 'lang-btn active' : 'lang-btn'}
                    onClick={() => setReviewMode(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {(() => {
                const m = REVIEW_MODES.find((x) => x.key === reviewMode)!;
                return (
                  <ReviewSession
                    key={reviewMode}
                    childId={activeChild}
                    lang={m.lang}
                    spellingOnly={m.spellingOnly}
                    countdownSec={countdownSec}
                    dailyLimit={dailyLimits[m.key]}
                    onChanged={bump}
                  />
                );
              })()}
            </>
          )}

          {tab === 'words' && (
            <>
              <div className="lang-switch">
                {(['en', 'zh'] as Lang[]).map((l) => (
                  <button
                    key={l}
                    className={subLang === l ? 'lang-btn active' : 'lang-btn'}
                    onClick={() => setSubLang(l)}
                  >
                    {LANG_LABELS[l]}
                  </button>
                ))}
              </div>
              <WordList
                childId={activeChild}
                lang={subLang}
                refreshKey={refreshKey}
              />
            </>
          )}
          {tab === 'stats' && <StatsBoard childId={activeChild} refreshKey={refreshKey} />}
          {tab === 'settings' && (
            <Settings
              countdownSec={countdownSec}
              onCountdownChange={setCountdownSec}
              dailyLimits={dailyLimits}
              onDailyLimitChange={setDailyLimit}
              onSaveConfig={handleSaveSettings}
              saveBusy={settingsSaveBusy}
              saveMsg={settingsSaveMsg}
            />
          )}
          {tab === 'admin' && isAdmin && <AdminPanel />}
        </>
      )}
    </>
  );
}

function readStoredPositiveInt(key: string): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function normalizeNonNegativeInt(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}
