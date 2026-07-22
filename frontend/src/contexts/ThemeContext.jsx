import { createContext, useContext, useState, useEffect } from 'react';
import { Spin } from 'antd';
import { settingsApi } from '../api';

const ThemeContext = createContext();

const THEME_STORAGE_KEY = 'shiguang-theme';

function applyTheme(isDark) {
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved === 'dark';
    } catch {
      return false;
    }
  });
  const [initialized, setInitialized] = useState(false);

  // 首次挂载时从后端读取最后一次保存的主题偏好，
  // 在拿到结果前不渲染子树，避免 CSS 变量与 antd 主题短暂不同步。
  useEffect(() => {
    let cancelled = false;
    settingsApi.getTheme()
      .then(res => {
        if (cancelled) return;
        const backendTheme = res.data.theme;
        const nextIsDark = backendTheme === 'dark';
        // 在触发渲染前先把 CSS 变量同步到目标主题，避免子树首次渲染时样式撕裂
        applyTheme(nextIsDark);
        setIsDark(nextIsDark);
      })
      .catch(() => {
        // 后端不可用时保持 localStorage 兜底
      })
      .finally(() => {
        if (!cancelled) setInitialized(true);
      });
    return () => { cancelled = true; };
  }, []);

  // 主题变化时同步到 DOM、localStorage 和后端
  useEffect(() => {
    applyTheme(isDark);
    if (initialized) {
      settingsApi.setTheme(isDark ? 'dark' : 'light').catch(() => {
        // 后端保存失败不影响本地使用
      });
    }
  }, [isDark, initialized]);

  const toggleTheme = () => setIsDark(prev => !prev);

  if (!initialized) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)'
      }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
