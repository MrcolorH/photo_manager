import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout as AntLayout, Menu, Statistic, Row, Col, Card, Collapse, Modal } from 'antd';
import {
  PictureOutlined,
  ImportOutlined,
  DeleteOutlined,
  CameraOutlined,
  SettingOutlined,
  DashboardOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { photoApi, importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';
import { useTheme } from '../contexts/ThemeContext';

const { Header, Sider, Content } = AntLayout;

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentRepoId, storageVersion } = useRepo();
  const { isDark, toggleTheme } = useTheme();
  const [storageInfo, setStorageInfo] = useState({
    jpg: { count: 0, sizeFormatted: '0 B' },
    raw: { count: 0, sizeFormatted: '0 B' },
    video: { count: 0, sizeFormatted: '0 B' }
  });

  // 仓库切换或仓库内数据变化（导入/删除/重建清单等）时刷新存储统计
  useEffect(() => {
    fetchStorageInfo();
  }, [currentRepoId, storageVersion]);

  // 首次使用引导：仅在 Layout 挂载时检查一次，仓库列表为空时弹窗提醒用户手动添加
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await importApi.getRepos();
        if (cancelled) return;
        if (res.data.success && (!res.data.data || res.data.data.length === 0)) {
          Modal.warning({
            title: '欢迎使用「拾光舱」',
            icon: <ExclamationCircleOutlined />,
            content: (
              <div style={{ lineHeight: 1.7 }}>
                <p style={{ marginBottom: 8 }}>
                  检测到尚未配置任何照片存储仓库。为了正常使用导入和浏览功能，请先添加一个仓库目录。
                </p>
                <p style={{ marginBottom: 0, color: 'var(--muted)', fontSize: 13 }}>
                  提示：建议选择非系统盘（如 D 盘、外接硬盘）作为照片存储位置；本应用不会为你预设备用仓库。
                </p>
              </div>
            ),
            okText: '去配置仓库',
            cancelText: '稍后',
            okCancel: true,
            onOk: () => navigate('/settings'),
            centered: true
          });
        }
      } catch (err) {
        console.error('首次使用检查失败:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchStorageInfo = async () => {
    try {
      const res = await photoApi.getStorageInfo(currentRepoId);
      if (res.data.success) {
        setStorageInfo(res.data.data);
      }
    } catch (error) {
      console.error('获取存储信息失败:', error);
    }
  };

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '概览'
    },
    {
      key: '/gallery',
      icon: <PictureOutlined />,
      label: '照片浏览'
    },
    {
      key: '/import',
      icon: <ImportOutlined />,
      label: '存储卡导入'
    },
    {
      key: '/sync-delete',
      icon: <DeleteOutlined />,
      label: '同步删除RAW'
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: '仓库配置'
    }
  ];

  const handleMenuClick = ({ key }) => {
    navigate(key);
  };

  const isLightHuntActive = location.pathname === '/light-hunt';
  const siderRef = useRef(null);
  const lightHuntWrapperRef = useRef(null);
  const [lightHuntPortal, setLightHuntPortal] = useState(null);

  useEffect(() => {
    const sider = siderRef.current;
    if (!sider) return;

    const children = sider.querySelector('.ant-layout-sider-children');
    if (!children) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'lh-sidebar-extension-host';
    sider.appendChild(wrapper);
    lightHuntWrapperRef.current = wrapper;
    setLightHuntPortal(wrapper);

    const updateHeight = () => {
      const height = wrapper.getBoundingClientRect().height;
      children.style.height = `calc(100% - ${height}px)`;
      children.style.minHeight = `calc(100% - ${height}px)`;
    };

    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(wrapper);

    return () => {
      ro.disconnect();
      if (wrapper.parentNode === sider) {
        sider.removeChild(wrapper);
      }
    };
  }, []);

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{ 
        background: 'var(--card)', 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        borderBottom: '1px solid var(--border)',
        height: 64
      }}>
        {/* 左侧：品牌标识 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--gold-light), var(--gold) 60%, var(--gold-dark))',
            boxShadow: '0 0 12px rgba(212,165,116,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <CameraOutlined style={{ fontSize: 14, color: '#1a1410' }} />
          </div>
          <span style={{
            fontFamily: "Georgia, serif",
            fontSize: '1.15rem',
            color: 'var(--text)',
            fontWeight: 700,
            letterSpacing: '0.02em'
          }}>
            拾光舱
          </span>
          <span style={{
            fontSize: '0.65rem',
            letterSpacing: '0.12em',
            color: 'var(--gold)',
            padding: '2px 10px',
            border: isDark ? '1px solid var(--gold-dark)' : 'none',
            borderRadius: 999,
            marginLeft: 4
          }}>
            ShíGuāng
          </span>
        </div>

        {/* 右侧：主题切换 */}
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={isDark ? '切换到明亮主题' : '切换到暗色主题'}
        >
          {isDark ? '☀' : '☾'}
        </button>
      </Header>
      
      <AntLayout>
        <Sider
          ref={siderRef}
          width={210}
          theme="dark"
          style={{
            borderRight: '1px solid var(--border)',
            background: 'var(--card)',
            overflow: 'hidden'
          }}
        >
          {/* 菜单区域 - 固定高度，不产生滚动条 */}
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden' 
          }}>
            <Menu
              mode="inline"
              theme="dark"
              selectedKeys={[location.pathname]}
              items={menuItems}
              onClick={handleMenuClick}
              style={{ 
                flex: 1, 
                borderRight: 0, 
                background: 'transparent',
                overflow: 'hidden'
              }}
            />
          </div>
          
          {/* 存储统计 - 固定在底部 */}
          <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <Collapse
              ghost
              defaultActiveKey={['1']}
              items={[
                {
                  key: '1',
                  label: <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>存储统计</span>,
                  children: (
                    <Row gutter={[0, 10]}>
                      <Col span={24}>
                        <Card size="small" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
                          <Statistic
                            title={<span style={{ color: 'var(--muted)' }}>JPG 照片</span>}
                            value={storageInfo.jpg.count}
                            suffix={<span style={{ fontSize: 12, color: 'var(--muted)' }}>张 ({storageInfo.jpg.sizeFormatted})</span>}
                            styles={{ content: { fontSize: 14, color: 'var(--accent-light)' } }}
                          />
                        </Card>
                      </Col>
                      <Col span={24}>
                        <Card size="small" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
                          <Statistic
                            title={<span style={{ color: 'var(--muted)' }}>RAW 底片</span>}
                            value={storageInfo.raw.count}
                            suffix={<span style={{ fontSize: 12, color: 'var(--muted)' }}>张 ({storageInfo.raw.sizeFormatted})</span>}
                            styles={{ content: { fontSize: 14, color: 'var(--accent)' } }}
                          />
                        </Card>
                      </Col>
                      <Col span={24}>
                        <Card size="small" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
                          <Statistic
                            title={<span style={{ color: 'var(--muted)' }}>视频文件</span>}
                            value={storageInfo.video.count}
                            suffix={<span style={{ fontSize: 12, color: 'var(--muted)' }}>个 ({storageInfo.video.sizeFormatted})</span>}
                            styles={{ content: { fontSize: 14, color: 'var(--text-secondary)' } }}
                          />
                        </Card>
                      </Col>
                    </Row>
                  )
                }
              ]}
            />
          </div>

        </Sider>

        {lightHuntPortal && createPortal(
          <div className="lh-sidebar-extension">
            <div className="lh-sidebar-extension-label">扩展功能</div>
            <button
              type="button"
              onClick={() => navigate('/light-hunt')}
              className={`lh-sidebar-bottom ${isLightHuntActive ? 'active' : ''}`}
            >
              <ThunderboltOutlined style={{ fontSize: 15, opacity: 0.9 }} />
              <span>追光百宝箱</span>
              <span className="lh-sidebar-badge">BETA</span>
            </button>
          </div>,
          lightHuntPortal
        )}

        <Content style={{
          padding: '20px 28px',
          background: 'var(--bg)',
          overflow: 'auto',
          height: 'calc(100vh - 64px)',
          flex: 1,
          maxWidth: '100%'
        }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
};

export default Layout;
