import { useEffect, useState } from 'react';
import {
  Card,
  Button,
  List,
  Checkbox,
  Empty,
  Spin,
  Alert,
  Space,
  Tag,
  Modal,
  message,
  Tooltip,
  Progress,
  Row,
  Col,
  Statistic,
  Select,
  Image
} from 'antd';
import {
  DeleteOutlined,
  ReloadOutlined,
  WarningOutlined,
  FileOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  DatabaseOutlined
} from '@ant-design/icons';
import { photoApi, importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';

const { Option } = Select;

const SyncDeletePage = () => {
  const [orphanRaws, setOrphanRaws] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  
  // 仓库相关
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const { setCurrentRepoId } = useRepo();

  // 当仓库切换时同步到全局上下文
  useEffect(() => {
    if (selectedRepo) {
      setCurrentRepoId(selectedRepo);
    }
  }, [selectedRepo]);

  useEffect(() => {
    fetchRepos();
  }, []);

  useEffect(() => {
    if (selectedRepo) {
      fetchOrphanRaws();
    }
  }, [selectedRepo]);

  const fetchRepos = async () => {
    try {
      const res = await importApi.getRepos();
      if (res.data.success) {
        setRepos(res.data.data);
        const defaultRepo = res.data.data.find(r => r.isDefault);
        if (defaultRepo) {
          setSelectedRepo(defaultRepo.id);
        } else if (res.data.data.length > 0) {
          setSelectedRepo(res.data.data[0].id);
        }
      }
    } catch (error) {
      console.error('获取仓库列表失败:', error);
    }
  };

  const fetchOrphanRaws = async () => {
    if (!selectedRepo) return;
    
    setLoading(true);
    try {
      const res = await photoApi.getOrphanRaws(selectedRepo);
      if (res.data.success) {
        setOrphanRaws(res.data.data);
        setSelectedIds([]);
        setDeleteResult(null);
      }
    } catch (error) {
      message.error('获取孤立RAW文件失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(orphanRaws.map(item => item.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelect = (id, checked) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(itemId => itemId !== id));
    }
  };

  // 打开RAW文件（本机打开）
  const handleOpenRaw = async (item) => {
    try {
      await photoApi.openLocation(item.path, 'file');
      message.success('已打开文件');
    } catch (error) {
      message.error('打开失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDelete = () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要删除的文件');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>确定要删除选中的 <strong>{selectedIds.length}</strong> 个 RAW 文件吗？</p>
          <Alert
            message="此操作不可恢复"
            description="删除后文件将被永久移除，请确保这些 RAW 文件确实不需要了"
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        </div>
      ),
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true);
        try {
          const res = await photoApi.batchDeleteRaws(selectedIds, selectedRepo);
          if (res.data.success) {
            setDeleteResult(res.data.data);
            message.success(`成功删除 ${res.data.data.success.length} 个文件`);
            fetchOrphanRaws();
          }
        } catch (error) {
          message.error('删除失败');
          console.error(error);
        } finally {
          setDeleting(false);
        }
      }
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getTotalSize = () => {
    return orphanRaws
      .filter(item => selectedIds.includes(item.id))
      .reduce((sum, item) => sum + item.size, 0);
  };

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>同步删除 RAW 底片</h2>

      <Alert
        title="功能说明"
        description="此功能用于删除那些没有对应 JPG 照片的 RAW 底片。当你在浏览 JPG 时删除了一些照片，对应的 RAW 文件就变成了'孤立'文件，可以在这里一键清理。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card style={{ marginBottom: 24 }}>
        <Space>
          <span>选择存储仓库：</span>
          <Select
            value={selectedRepo}
            onChange={setSelectedRepo}
            style={{ width: 300 }}
            placeholder="选择存储仓库"
          >
            {repos.map(repo => (
              <Option key={repo.id} value={repo.id}>
                <Space>
                  <DatabaseOutlined />
                  {repo.name}
                  {repo.isDefault && <Tag color="blue">默认</Tag>}
                </Space>
              </Option>
            ))}
          </Select>
        </Space>
      </Card>

      <Card style={{ marginBottom: 24 }}>
        <Row gutter={24} align="middle">
          <Col span={6}>
            <Statistic
              title="孤立 RAW 文件"
              value={orphanRaws.length}
              prefix={<FileOutlined />}
              suffix="个"
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="已选择"
              value={selectedIds.length}
              styles={{ content: { color: selectedIds.length > 0 ? '#1890ff' : '#999' } }}
              suffix="个"
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="选中文件大小"
              value={formatFileSize(getTotalSize())}
              styles={{ content: { fontSize: 16 } }}
            />
          </Col>
          <Col span={6} style={{ textAlign: 'right', paddingRight: 16 }}>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchOrphanRaws}
                loading={loading}
              >
                刷新
              </Button>
              <Button
                type="primary"
                danger
                icon={<DeleteOutlined />}
                onClick={handleDelete}
                disabled={selectedIds.length === 0 || deleting}
                loading={deleting}
              >
                删除选中
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {deleteResult && (
        <Alert
          message="删除结果"
          description={
            <Space>
              <Tag color="success" icon={<CheckCircleOutlined />}>
                成功: {deleteResult.success.length}
              </Tag>
              {deleteResult.failed.length > 0 && (
                <Tag color="error" icon={<WarningOutlined />}>
                  失败: {deleteResult.failed.length}
                </Tag>
              )}
            </Space>
          }
          type={deleteResult.failed.length > 0 ? 'warning' : 'success'}
          showIcon
          closable
          style={{ marginBottom: 24 }}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}>
          <Spin size="large" />
          <p style={{ marginTop: 16, color: '#999' }}>正在扫描孤立 RAW 文件...</p>
        </div>
      ) : orphanRaws.length === 0 ? (
        <Empty
          description="没有发现孤立的 RAW 文件"
          style={{ padding: 100 }}
        >
          <p style={{ color: '#999', marginTop: 16 }}>
            所有 RAW 文件都有对应的 JPG 照片，无需清理
          </p>
        </Empty>
      ) : (
        <Card
          title={
            <Checkbox
              checked={selectedIds.length === orphanRaws.length && orphanRaws.length > 0}
              indeterminate={selectedIds.length > 0 && selectedIds.length < orphanRaws.length}
              onChange={handleSelectAll}
            >
              全选
            </Checkbox>
          }
        >
          <List
            dataSource={orphanRaws}
            renderItem={item => (
              <List.Item
                key={item.id}
                actions={[
                  <Tag color="orange">{item.extension ? item.extension.toUpperCase() : 'RAW'}</Tag>,
                  <Tag>{formatFileSize(item.size)}</Tag>
                ]}
              >
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  onChange={(e) => handleSelect(item.id, e.target.checked)}
                  style={{ marginRight: 12 }}
                />
                {/* RAW缩略图 */}
                <div 
                  style={{ 
                    marginRight: 16,
                    cursor: 'pointer',
                    width: 80,
                    height: 60,
                    borderRadius: 4,
                    overflow: 'hidden',
                    background: '#f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onClick={() => handleOpenRaw(item)}
                >
                  <Image
                    src={`/api/photos/thumbnail?path=${encodeURIComponent(item.path)}&width=160`}
                    alt={item.name}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover' 
                    }}
                    preview={false}
                    fallback="/placeholder-raw.svg"
                    placeholder={
                      <div style={{ 
                        width: 80,
                        height: 60,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Spin size="small" />
                      </div>
                    }
                  />
                </div>
                <List.Item.Meta
                  title={
                    <span 
                      style={{ cursor: 'pointer', color: '#1890ff' }}
                      onClick={() => handleOpenRaw(item)}
                    >
                      {item.name}
                    </span>
                  }
                  description={
                    <Tooltip title={item.path}>
                      <span style={{ color: '#999', fontSize: 12 }}>
                        {item.path}
                      </span>
                    </Tooltip>
                  }
                />
              </List.Item>
            )}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100']
            }}
          />
        </Card>
      )}
    </div>
  );
};

export default SyncDeletePage;
