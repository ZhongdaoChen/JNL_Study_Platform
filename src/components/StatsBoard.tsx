import { useEffect, useState } from 'react';
import { repo } from '../lib/db';
import { computeStats, type Stats } from '../lib/statsService';

// 学习统计看板：打卡、掌握进度、近 7 天复习趋势
export default function StatsBoard({ childId, refreshKey }: { childId: string; refreshKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [words, logs] = await Promise.all([
        repo.getWords(childId),
        repo.getReviewLogs(childId),
      ]);
      if (active) setStats(computeStats(words, logs));
    })();
    return () => {
      active = false;
    };
  }, [childId, refreshKey]);

  if (!stats) return <div className="card"><p>加载中…</p></div>;

  const masterRate =
    stats.totalWords > 0 ? Math.round((stats.masteredWords / stats.totalWords) * 100) : 0;
  const maxTrend = Math.max(1, ...stats.trend.map((d) => d.count));

  return (
    <div className="card">
      <h2>📊 学习统计</h2>

      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-num">🔥 {stats.streak}</div>
          <div className="stat-label">连续学习天数</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{stats.totalWords}</div>
          <div className="stat-label">累计单词</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{stats.masteredWords}</div>
          <div className="stat-label">已掌握</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{stats.dueToday}</div>
          <div className="stat-label">今日待复习</div>
        </div>
      </div>

      <div className="master-bar-wrap">
        <div className="master-bar-head">
          <span>掌握进度</span>
          <span>{stats.masteredWords} / {stats.totalWords}（{masterRate}%）</span>
        </div>
        <div className="master-bar">
          <div className="master-bar-fill" style={{ width: `${masterRate}%` }} />
        </div>
        <p className="hint">连续答对 3 次即视为「已掌握」。</p>
      </div>

      <h3 className="trend-title">近 7 天复习</h3>
      <div className="trend-chart">
        {stats.trend.map((d) => (
          <div key={d.date} className="trend-col">
            <div className="trend-bar-area">
              <div
                className="trend-bar"
                style={{ height: `${(d.count / maxTrend) * 100}%` }}
                title={`${d.date}：${d.count} 次`}
              >
                {d.count > 0 && <span className="trend-count">{d.count}</span>}
              </div>
            </div>
            <div className="trend-day">{d.date.slice(5)}</div>
          </div>
        ))}
      </div>

      <p className="hint">
        累计复习 {stats.reviewsTotal} 次 · 熟练 {stats.gradeBreakdown.mastered} ·
        略陌生 {stats.gradeBreakdown.fuzzy} · 彻底陌生 {stats.gradeBreakdown.forgotten}
      </p>
    </div>
  );
}
