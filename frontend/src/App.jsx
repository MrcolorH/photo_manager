import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RepoProvider } from './contexts/RepoContext';
import { useTheme } from './contexts/ThemeContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import PhotoGallery from './pages/PhotoGallery';
import ImportPage from './pages/ImportPage';
import SyncDeletePage from './pages/SyncDeletePage';
import RepoSettings from './pages/RepoSettings';
import LightHunt from './pages/LightHunt';
import './App.css';

const darkTokens = {
  colorPrimary: '#d4a574',
  colorBgBase: '#0d0c0b',
  colorBgContainer: '#171411',
  colorBgElevated: '#171411',
  colorBorder: '#2a241e',
  colorText: '#e8ddd0',
  colorTextSecondary: '#c4b8aa',
  colorTextTertiary: '#8a7e72',
};

const lightTokens = {
  colorPrimary: '#4a80b1',
  colorBgBase: '#f8fafc',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#e2e8f0',
  colorText: '#0f172a',
  colorTextSecondary: '#334155',
  colorTextTertiary: '#94a3b8',
};

function App() {
  const { isDark } = useTheme();

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          ...(isDark ? darkTokens : lightTokens),
          borderRadius: 8,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        }
      }}
      getPopupContainer={() => document.getElementById('app-root')}
    >
      <div id="app-root" style={{ minHeight: '100vh' }}>
        <Router>
          <Routes>
            <Route path="/" element={<RepoProvider><Layout /></RepoProvider>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="gallery" element={<PhotoGallery />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="sync-delete" element={<SyncDeletePage />} />
              <Route path="settings" element={<RepoSettings />} />
              <Route path="light-hunt" element={<LightHunt />} />
            </Route>
          </Routes>
        </Router>
      </div>
    </ConfigProvider>
  );
}

export default App;
