import { useEffect, useState, useRef } from 'react';
import {
  Card,
  Button,
  Table,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Checkbox,
  message,
  Popconfirm,
  Alert,
  Row,
  Col,
  Statistic,
  Progress,
  Select,
  Tooltip
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  DatabaseOutlined,
  FolderOutlined,
  CheckCircleOutlined,
  FolderAddOutlined,
  ThunderboltOutlined,
  ClearOutlined,
  ReloadOutlined,
  HddOutlined,
  LoadingOutlined,
  CheckOutlined
} from '@ant-design/icons';
import { importApi, photoApi } from '../api';

const { Option } = Select;

const RepoSettings = () => {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRepo, setEditingRepo] = useState(null);
  const [form] = Form.useForm();
  const [repoPath, setRepoPath] = useState('');

  // 缩略图缓存管理相关状态
  const [selectedCacheRepo, setSelectedCacheRepo] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [loadingCacheStats, setLoadingCacheStats] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // 缩略图预热相关状态
  const [preloadModalVisible, setPreloadModalVisible] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(null);
  const preloadTimerRef = useRef(null);

  useEffect(() => {
    fetchRepos();
    return () => {
      if (preloadTimerRef.current) clearInterval(preloadTimerRef.current);
    };
  }, []);

  // 仓库数据加载后，默认选中一个仓库查询缓存
  useEffect(() => {
    if (repos.length > 0) {
      if (!selectedCacheRepo || !repos.some(r => r.id === selectedCacheRepo)) {
        const def = repos.find(r => r.isDefault) || repos[0];
        setSelectedCacheRepo(def.id);
      }
    } else {
      setSelectedCacheRepo(null);
      setCacheStats(null);
    }
  }, [repos]);

  // 切换仓库时刷新缓存统计
  useEffect(() => {
    if (selectedCacheRepo) {
      fetchCacheStats(selectedCacheRepo);
    }
  }, [selectedCacheRepo]);

  const fetchCacheStats = async (repoId) => {
    if (!repoId) return;
    setLoadingCacheStats(true);
    try {
      const res = await photoApi.getCacheStats(repoId);
      if (res.data.success) {
        setCacheStats(res.data.data);
      }
    } catch (err) {
      console.error('获取缓存统计失败:', err);
    } finally {
      setLoadingCacheStats(false);
    }
  };

  const handleClearCache = async () => {
    if (!selectedCacheRepo) return;
    setClearingCache(true);
    try {
      const res = await photoApi.clearCache(selectedCacheRepo);
      if (res.data.success) {
        message.success(`已清空缓存，释放 ${res.data.data.formattedFreed || '0 B'} 空间`);
        fetchCacheStats(selectedCacheRepo);
      }
    } catch (err) {
      message.error('清空缓存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setClearingCache(false);
    }
  };

  const handleStartPreload = async () => {
    if (!selectedCacheRepo) return;
    try {
      const res = await photoApi.preloadThumbnails(selectedCacheRepo);
      if (res.data.success) {
        setPreloadProgress(res.data.data);
        setPreloadModalVisible(true);
        startPollingPreloadProgress(selectedCacheRepo);
      }
    } catch (err) {
      message.error('启动预热失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const startPollingPreloadProgress = (repoId) => {
    if (preloadTimerRef.current) clearInterval(preloadTimerRef.current);
    preloadTimerRef.current = setInterval(async () => {
      try {
        const res = await photoApi.getPreloadProgress(repoId);
        if (res.data.success) {
          const data = res.data.data;
          setPreloadProgress(data);
          if (['completed', 'cancelled', 'error'].includes(data.status)) {
            clearInterval(preloadTimerRef.current);
            preloadTimerRef.current = null;
            if (data.status === 'completed') {
              message.success(`预热完成！共处理 ${data.processed} 张，复用 ${data.skipped} 张`);
              fetchCacheStats(repoId);
            }
          }
        }
      } catch (err) {
        // ignore polling errors
      }
    }, 800);
  };

  const handleCancelPreload = async () => {
    if (!selectedCacheRepo) return;
    try {
      await photoApi.cancelPreload(selectedCacheRepo);
      if (preloadTimerRef.current) {
        clearInterval(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }
      setPreloadProgress(prev => prev ? { ...prev, status: 'cancelled' } : null);
      message.info('已取消预热任务');
      fetchCacheStats(selectedCacheRepo);
    } catch (err) {
      message.error('取消失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const fetchRepos = async () => {
    setLoading(true);
    try {
      const res = await importApi.getRepos();
      if (res.data.success) {
        setRepos(res.data.data);
      }
    } catch (error) {
      message.error('获取仓库列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingRepo(null);
    form.resetFields();
    setRepoPath('');
    form.setFieldsValue({ isDefault: false });
    setModalVisible(true);
  };

  const handleEdit = (repo) => {
    setEditingRepo(repo);
    setRepoPath(repo.path);
    form.setFieldsValue({
      name: repo.name,
      path: repo.path,
      isDefault: repo.isDefault
    });
    setModalVisible(true);
  };

  const handleSubmit = async (values) => {
    try {
      if (editingRepo) {
        // 编辑模式：先删除旧仓库，再添加新仓库（简化处理）
        await importApi.deleteRepo(editingRepo.id);
      }
      
      const res = await importApi.addRepo({ ...values, path: repoPath });
      if (res.data.success) {
        message.success(editingRepo ? '修改成功' : '添加成功');
        setModalVisible(false);
        form.resetFields();
        setRepoPath('');
        fetchRepos();
      }
    } catch (error) {
      message.error((editingRepo ? '修改' : '添加') + '失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 使用后端接口选择文件夹
  const handleSelectFolder = async () => {
    try {
      message.loading('正在打开文件夹选择对话框...', 0);
      
      const res = await importApi.selectFolder();
      
      message.destroy();
      
      if (res.data.success) {
        const selectedPath = res.data.data.path;
        setRepoPath(selectedPath);
        form.setFieldsValue({ path: selectedPath });
        message.success('已选择: ' + selectedPath);
      } else {
        if (res.data.error !== '用户取消选择') {
          message.error(res.data.error || '选择失败');
        }
      }
    } catch (error) {
      message.destroy();
      console.error('选择文件夹失败:', error);
      message.error('选择文件夹失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDelete = async (repo) => {
    try {
      const res = await importApi.deleteRepo(repo.id);
      if (res.data.success) {
        message.success('删除成功');
        fetchRepos();
      }
    } catch (error) {
      message.error('删除失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSetDefault = async (repoId) => {
    try {
      const res = await importApi.setDefaultRepo(repoId);
      if (res.data.success) {
        message.success('设置成功');
        fetchRepos();
      }
    } catch (error) {
      message.error('设置失败');
    }
  };

  const columns = [
    {
      title: '仓库名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Space>
          <DatabaseOutlined style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 500 }}>{text}</span>
          {record.isDefault && (
            <Tag color="blue" icon={<CheckCircleOutlined />}>默认</Tag>
          )}
        </Space>
      )
    },
    {
      title: '存储路径',
      dataIndex: 'path',
      key: 'path',
      render: (text) => (
        <Space>
          <FolderOutlined style={{ color: 'var(--muted)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{text}</span>
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_, record) => (
        <Space>
          {!record.isDefault && (
            <Button
              type="link"
              size="small"
              onClick={() => handleSetDefault(record.id)}
            >
              设为默认
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description={`确定要删除仓库 "${record.name}" 吗？\n注意：这不会删除实际文件，只是移除配置。`}
            onConfirm={() => handleDelete(record)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="link"
              danger
              size="small"
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16, fontFamily: 'var(--font-serif)' }}>存储仓库配置</h2>

      <Alert
        message="仓库说明"
        description={
          <div>
            <p>存储仓库是照片文件的存放目录，每个仓库包含 jpg、raw、video 三个子文件夹。</p>
            <p>你可以创建多个仓库来分类管理不同相机或不同项目的照片。</p>
            <p>默认仓库会作为照片浏览和导入的默认选择。</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card
        title="仓库列表"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
          >
            添加仓库
          </Button>
        }
      >
        <Table
          dataSource={repos}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      {/* 随盘缩略图多级缓存管理 */}
      <Card
        title={
          <Space>
            <ThunderboltOutlined style={{ color: 'var(--accent, #1890ff)' }} />
            <span>随盘缩略图与多级缓存</span>
          </Space>
        }
        extra={
          <Space>
            <Select
              style={{ width: 180 }}
              value={selectedCacheRepo}
              onChange={setSelectedCacheRepo}
              placeholder="选择仓库"
            >
              {repos.map(r => (
                <Option key={r.id} value={r.id}>
                  {r.name} {r.isDefault ? '(默认)' : ''}
                </Option>
              ))}
            </Select>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchCacheStats(selectedCacheRepo)}
              loading={loadingCacheStats}
            >
              刷新
            </Button>
          </Space>
        }
        style={{ marginTop: 24 }}
      >
        <Row gutter={[24, 24]}>
          <Col xs={24} sm={8}>
            <Statistic
              title="已缓存缩略图"
              value={cacheStats ? cacheStats.count : 0}
              suffix="张"
              valueStyle={{ fontWeight: 600 }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="缓存占用空间"
              value={cacheStats ? cacheStats.formattedSize : '0 B'}
              valueStyle={{ fontWeight: 600, color: '#52c41a' }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <div style={{ fontSize: 13, color: 'var(--muted, #8c8c8c)', marginBottom: 4 }}>存储策略</div>
            <div style={{ marginTop: 6 }}>
              {cacheStats?.isExternal ? (
                <Tag color="success" icon={<HddOutlined />}>随盘持久化（0 占用系统盘）</Tag>
              ) : (
                <Tag color="warning" icon={<HddOutlined />}>本地系统缓存</Tag>
              )}
            </div>
          </Col>
        </Row>

        <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-elevated, #fafafa)', borderRadius: 6, fontSize: 13 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div>
              <span style={{ color: 'var(--muted, #8c8c8c)' }}>当前存放路径：</span>
              <span style={{ fontFamily: 'monospace' }}>{cacheStats?.cacheDir || '尚未生成'}</span>
            </div>
            <div style={{ color: 'var(--muted, #8c8c8c)', fontSize: 12 }}>
              💡 缩略图以 WebP 高压缩率格式持久化保存在外置盘 <code>.shiguang/thumbnails/</code> 中。拔插至其它设备可直接免重算秒开浏览。
            </div>
          </Space>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Popconfirm
            title="确认清空缓存？"
            description="清空后，相册首次浏览时会按需重新从原图快速生成缩略图。"
            onConfirm={handleClearCache}
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<ClearOutlined />} loading={clearingCache} disabled={!cacheStats || cacheStats.count === 0}>
              清理缓存
            </Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleStartPreload}
            disabled={!selectedCacheRepo}
          >
            一键预热缩略图
          </Button>
        </div>
      </Card>

      {/* 预热缩略图模态弹窗 */}
      <Modal
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#1890ff' }} />
            <span>缩略图后台预热</span>
          </Space>
        }
        open={preloadModalVisible}
        onCancel={() => {
          if (preloadProgress && preloadProgress.status === 'running') {
            Modal.confirm({
              title: '预热任务正在后台运行',
              content: '关闭弹窗后预热仍会在后台继续。如果需要彻底停止，请点击“取消任务”。',
              okText: '保持后台运行',
              cancelText: '取消任务',
              onOk: () => setPreloadModalVisible(false),
              onCancel: handleCancelPreload
            });
          } else {
            setPreloadModalVisible(false);
          }
        }}
        footer={[
          preloadProgress?.status === 'running' ? (
            <Button key="cancel" danger onClick={handleCancelPreload}>
              取消任务
            </Button>
          ) : null,
          <Button
            key="close"
            type="primary"
            onClick={() => setPreloadModalVisible(false)}
          >
            {preloadProgress?.status === 'running' ? '后台继续运行' : '完成并关闭'}
          </Button>
        ]}
      >
        <div style={{ padding: '16px 0' }}>
          <Progress
            percent={preloadProgress?.percentage || 0}
            status={
              preloadProgress?.status === 'completed'
                ? 'success'
                : preloadProgress?.status === 'error' || preloadProgress?.status === 'cancelled'
                ? 'exception'
                : 'active'
            }
          />
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>状态：
              {preloadProgress?.status === 'running' && <Tag color="processing" icon={<LoadingOutlined />}>正在处理</Tag>}
              {preloadProgress?.status === 'completed' && <Tag color="success" icon={<CheckOutlined />}>预热完成</Tag>}
              {preloadProgress?.status === 'cancelled' && <Tag color="default">已取消</Tag>}
              {preloadProgress?.status === 'error' && <Tag color="error">出错</Tag>}
            </span>
            <span>已处理：{(preloadProgress?.processed || 0) + (preloadProgress?.skipped || 0)} / {preloadProgress?.total || 0}</span>
          </div>
          {preloadProgress?.skipped > 0 && (
            <div style={{ marginTop: 8, color: 'var(--muted, #8c8c8c)', fontSize: 12 }}>
              ✓ 已复用已有缓存：{preloadProgress.skipped} 张
            </div>
          )}
          {preloadProgress?.currentFile && (
            <div style={{ marginTop: 8, color: 'var(--muted, #8c8c8c)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              当前文件：{preloadProgress.currentFile}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        title={editingRepo ? '编辑仓库' : '添加仓库'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setRepoPath('');
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingRepo ? '保存' : '添加'}
        cancelText="取消"
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="仓库名称"
            name="name"
            rules={[{ required: true, message: '请输入仓库名称' }]}
          >
            <Input placeholder="例如：索尼照片库、工作项目A" />
          </Form.Item>

          <Form.Item
            label="存储路径"
            required
            rules={[{ required: true, message: '请输入存储路径' }]}
            extra="路径如果不存在会自动创建"
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="例如：/Users/colorh/Pictures/索尼照片"
                value={repoPath}
                onChange={(e) => {
                  setRepoPath(e.target.value);
                  form.setFieldsValue({ path: e.target.value });
                }}
                style={{ flex: 1 }}
              />
              <Button
                icon={<FolderAddOutlined />}
                onClick={handleSelectFolder}
              >
                选择文件夹
              </Button>
            </Space.Compact>
            <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
              点击"选择文件夹"按钮打开系统对话框，自动获取完整路径
            </div>
          </Form.Item>

          <Form.Item
            name="isDefault"
            valuePropName="checked"
          >
            <Checkbox>设为默认仓库</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RepoSettings;
