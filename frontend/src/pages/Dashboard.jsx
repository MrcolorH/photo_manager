import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty } from 'antd';
import {
  PictureOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  DeleteOutlined,
  SettingOutlined,
  FolderOutlined,
  HddOutlined
} from '@ant-design/icons';
import { photoApi, importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';
import './Dashboard.css';

// 六步工作流（产品功能介绍，静态）
const WORKFLOW_STEPS = [
  { icon: '💾', title: '插入存储卡', desc: '自动识别 SD/CF/XQD' },
  { icon: '🗂', title: '选择仓库', desc: '本地盘/SSD/NAS' },
  { icon: '⤓', title: '一键导入', desc: 'CRC校验+断点续传' },
  { icon: '🔗', title: 'RAW/JPG 配对', desc: 'EXIF时间戳+文件名' },
  { icon: '🗑', title: '孤儿清理', desc: '一键找出缺另一半' },
  { icon: '👁', title: '大图预览', desc: '无需Lightroom看RAW' }
];

// 快捷操作
const QUICK_ACTIONS = [
  { key: '/import', icon: <DownloadOutlined />, title: '存储卡导入', desc: '一键从存储卡入库' },
  { key: '/gallery', icon: <PictureOutlined />, title: '照片浏览', desc: '查看管理所有照片' },
  { key: '/sync-delete', icon: <DeleteOutlined />, title: '清理孤儿 RAW', desc: '删除无配对的 RAW' },
  { key: '/settings', icon: <SettingOutlined />, title: '仓库配置', desc: '管理存储仓库' }
];

const Dashboard = () => {
  const navigate = useNavigate();
  const { setCurrentRepoId } = useRepo();
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState([]);
  const [stats, setStats] = useState({ jpg: 0, raw: 0, video: 0, total: 0, repos: 0 });
  const [recentPhotos, setRecentPhotos] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 获取仓库列表
      const reposRes = await importApi.getRepos();
      const repoList = reposRes.data.success ? reposRes.data.data : [];
      setRepos(repoList);

      // 并行获取各仓库存储信息，汇总统计
      const storageResults = await Promise.all(
        repoList.map((repo) => photoApi.getStorageInfo(repo.id).catch(() => null))
      );
      let jpg = 0, raw = 0, video = 0;
      const repoStats = {};
      storageResults.forEach((res, idx) => {
        const data = res && res.data.success ? res.data.data : null;
        const c = { jpg: 0, raw: 0, video: 0 };
        if (data) {
          c.jpg = data.jpg?.count || 0;
          c.raw = data.raw?.count || 0;
          c.video = data.video?.count || 0;
          jpg += c.jpg;
          raw += c.raw;
          video += c.video;
        }
        repoStats[repoList[idx].id] = c;
      });
      setStats({ jpg, raw, video, total: jpg + raw + video, repos: repoList.length, repoStats });

      // 并行获取各仓库最近 JPG 照片用于预览
      const photoResults = await Promise.all(
        repoList.map((repo) =>
          photoApi
            .getPhotos('jpg', {
              page: 1,
              pageSize: 3,
              sortBy: 'modifiedTime',
              sortOrder: 'desc',
              repoId: repo.id
            })
            .catch(() => null)
        )
      );
      let allRecent = [];
      photoResults.forEach((res, idx) => {
        if (res && res.data.success) {
          allRecent.push(
            ...res.data.data.photos.map((p) => ({
              ...p,
              repoId: repoList[idx].id,
              repoName: repoList[idx].name
            }))
          );
        }
      });
      allRecent.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
      setRecentPhotos(allRecent.slice(0, 8));
    } catch (error) {
      console.error('加载概览数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = (path) => {
    navigate(path);
  };

  const handlePhotoClick = (photo) => {
    setCurrentRepoId(photo.repoId);
    navigate('/gallery');
  };

  const handleRepoClick = (repo) => {
    setCurrentRepoId(repo.id);
    navigate('/gallery');
  };

  if (loading) {
    return (
      <div className="dash-page dash-loading">
        <div className="loading-spin" style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin 0.8s linear infinite' }} />
        <div>加载中...</div>
      </div>
    );
  }

  return (
    <div className="dash-page">
      {/* Hero 欢迎区 */}
      <div className="dash-hero">
        <h2>欢迎回来 👋</h2>
        <p>
          拾光舱 · 把时间，整齐地收回舱里。当前共管理 {stats.repos} 个仓库 · {stats.total} 个影像文件
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="dash-stats">
        <div className="dash-stat-card">
          <div className="dicon jpg"><FileImageOutlined /></div>
          <div className="dnum">{stats.jpg}<span className="unit">张</span></div>
          <div className="dlabel">JPG 照片</div>
        </div>
        <div className="dash-stat-card">
          <div className="dicon raw"><FolderOutlined /></div>
          <div className="dnum">{stats.raw}<span className="unit">张</span></div>
          <div className="dlabel">RAW 底片</div>
        </div>
        <div className="dash-stat-card">
          <div className="dicon video"><VideoCameraOutlined /></div>
          <div className="dnum">{stats.video}<span className="unit">个</span></div>
          <div className="dlabel">视频文件</div>
        </div>
        <div className="dash-stat-card">
          <div className="dicon repo"><DatabaseOutlined /></div>
          <div className="dnum">{stats.repos}<span className="unit">个</span></div>
          <div className="dlabel">存储仓库</div>
        </div>
      </div>

      {/* 快捷操作 */}
      <div className="dash-section-title">快捷操作</div>
      <div className="dash-actions">
        {QUICK_ACTIONS.map((action) => (
          <div key={action.key} className="dash-action" onClick={() => handleAction(action.key)}>
            <div className="da-icon">{action.icon}</div>
            <div className="da-title">{action.title}</div>
            <div className="da-desc">{action.desc}</div>
          </div>
        ))}
      </div>

      {/* 双栏：工作流 + 仓库概览 */}
      <div className="dash-grid">
        <div className="dash-panel">
          <div className="dash-section-title">六步工作流</div>
          <div className="dash-workflow">
            {WORKFLOW_STEPS.map((s, i) => (
              <div className="wf-step" key={i}>
                <div className="wf-dot">{s.icon}</div>
                <div className="wf-t">{i + 1}. {s.title}</div>
                <div className="wf-d">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="dash-panel">
          <div className="dash-section-title">仓库概览</div>
          {repos.length === 0 ? (
            <Empty description="暂无仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            repos.map((repo) => {
              const c = stats.repoStats?.[repo.id] || { jpg: 0, raw: 0, video: 0 };
              const total = c.jpg + c.raw + c.video;
              return (
                <div className="repo-overview-item" key={repo.id} onClick={() => handleRepoClick(repo)}>
                  <div className="ro-ico"><HddOutlined /></div>
                  <div className="ro-body">
                    <div className="ro-title">
                      {repo.name}
                      {repo.isDefault && <span className="ro-default-tag">默认</span>}
                    </div>
                    <div className="ro-path" title={repo.path}>{repo.path}</div>
                  </div>
                  <div className="ro-counts">
                    <div className="ro-total">{total}</div>
                    <div>{c.jpg} JPG · {c.raw} RAW · {c.video} 视频</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 最近照片 */}
      <div className="dash-panel">
        <div className="dash-section-title">最近照片</div>
        {recentPhotos.length === 0 ? (
          <Empty description="暂无照片" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="dash-photos">
            {recentPhotos.map((p) => (
              <div
                className="dash-photo"
                key={p.id}
                title={`${p.name} · ${p.repoName}`}
                onClick={() => handlePhotoClick(p)}
              >
                <img src={p.thumbnailUrl || p.url} alt={p.name} loading="lazy" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
