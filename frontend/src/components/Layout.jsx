import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout as AntLayout, Menu, Statistic, Row, Col, Card, Collapse } from 'antd';
import {
  PictureOutlined,
  ImportOutlined,
  DeleteOutlined,
  CameraOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { photoApi } from '../api';

const { Header, Sider, Content } = AntLayout;

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [storageInfo, setStorageInfo] = useState({
    jpg: { count: 0, sizeFormatted: '0 B' },
    raw: { count: 0, sizeFormatted: '0 B' },
    video: { count: 0, sizeFormatted: '0 B' }
  });

  useEffect(() => {
    fetchStorageInfo();
  }, []);

  const fetchStorageInfo = async () => {
    try {
      const res = await photoApi.getStorageInfo();
      if (res.data.success) {
        setStorageInfo(res.data.data);
      }
    } catch (error) {
      console.error('获取存储信息失败:', error);
    }
  };

  const menuItems = [
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

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{ 
        background: '#001529', 
        display: 'flex', 
        alignItems: 'center',
        padding: '0 24px'
      }}>
        <CameraOutlined style={{ fontSize: 24, color: '#fff', marginRight: 12 }} />
        <h1 style={{ color: '#fff', margin: 0, fontSize: 18 }}>相机照片管理系统</h1>
      </Header>
      
      <AntLayout>
        <Sider 
          width={250} 
          theme="light" 
          style={{ 
            boxShadow: '2px 0 8px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ flex: 1, borderRight: 0, overflowY: 'auto' }}
          />
          
          <div style={{ borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
            <Collapse 
              ghost 
              defaultActiveKey={[]}
              items={[
                {
                  key: '1',
                  label: '存储统计',
                  children: (
                    <Row gutter={[0, 12]}>
                      <Col span={24}>
                        <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
                          <Statistic
                            title="JPG 照片"
                            value={storageInfo.jpg.count}
                            suffix={`张 (${storageInfo.jpg.sizeFormatted})`}
                            styles={{ content: { fontSize: 14 } }}
                          />
                        </Card>
                      </Col>
                      <Col span={24}>
                        <Card size="small" style={{ background: '#fff7e6', borderColor: '#ffd591' }}>
                          <Statistic
                            title="RAW 底片"
                            value={storageInfo.raw.count}
                            suffix={`张 (${storageInfo.raw.sizeFormatted})`}
                            styles={{ content: { fontSize: 14 } }}
                          />
                        </Card>
                      </Col>
                      <Col span={24}>
                        <Card size="small" style={{ background: '#e6f7ff', borderColor: '#91d5ff' }}>
                          <Statistic
                            title="视频文件"
                            value={storageInfo.video.count}
                            suffix={`个 (${storageInfo.video.sizeFormatted})`}
                            styles={{ content: { fontSize: 14 } }}
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
        
        <Content style={{ 
          padding: 24, 
          background: '#fff',
          overflow: 'auto',
          height: 'calc(100vh - 64px)',
          flex: 1
        }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
};

export default Layout;
