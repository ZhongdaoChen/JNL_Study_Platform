import './App.css';
import { useState } from 'react';
import { usingCloud } from './lib/db';
import AuthGate from './components/AuthGate';
import Workspace from './components/Workspace';

export default function App() {
  // 精简模式：在「录入」以外的标签时隐藏标题行，保持界面简单
  const [compact, setCompact] = useState(false);

  return (
    <div className="app">
      {!compact && (
        <header>
          <h1>🌟 JNL学习小助手</h1>
          <span className={`badge ${usingCloud ? 'cloud' : 'local'}`}>
            {usingCloud ? '云端同步' : '本地存储'}
          </span>
        </header>
      )}

      <AuthGate>
        <Workspace onCompactChange={setCompact} />
      </AuthGate>
    </div>
  );
}
