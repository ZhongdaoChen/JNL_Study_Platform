import './App.css';
import { usingCloud } from './lib/db';
import AuthGate from './components/AuthGate';
import Workspace from './components/Workspace';

export default function App() {
  return (
    <div className="app">
      <header>
        <h1>🌟 JNL学习小助手</h1>
        <span className={`badge ${usingCloud ? 'cloud' : 'local'}`}>
          {usingCloud ? '云端同步' : '本地存储'}
        </span>
      </header>

      <AuthGate>
        <Workspace />
      </AuthGate>
    </div>
  );
}
