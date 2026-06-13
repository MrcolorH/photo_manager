import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RepoProvider } from './contexts/RepoContext';
import Layout from './components/Layout';
import PhotoGallery from './pages/PhotoGallery';
import ImportPage from './pages/ImportPage';
import SyncDeletePage from './pages/SyncDeletePage';
import RepoSettings from './pages/RepoSettings';
import './App.css';

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1890ff',
          borderRadius: 6
        }
      }}
    >
      <Router>
        <Routes>
          <Route path="/" element={<RepoProvider><Layout /></RepoProvider>}>
            <Route index element={<Navigate to="/gallery" replace />} />
            <Route path="gallery" element={<PhotoGallery />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="sync-delete" element={<SyncDeletePage />} />
            <Route path="settings" element={<RepoSettings />} />
          </Route>
        </Routes>
      </Router>
    </ConfigProvider>
  );
}

export default App;
