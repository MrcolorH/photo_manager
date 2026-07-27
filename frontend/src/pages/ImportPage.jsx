import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Input,
  Button,
  Steps,
  List,
  Progress,
  message,
  Alert,
  Space,
  Tag,
  Empty,
  Spin,
  Divider,
  Statistic,
  Row,
  Col,
  Select,
  Modal,
  Form,
  Radio,
  Table,
  Switch
} from 'antd';
import {
  FolderOpenOutlined,
  ImportOutlined,
  CheckCircleOutlined,
  FileImageOutlined,
  FileOutlined,
  VideoCameraOutlined,
  PlusOutlined,
  DeleteOutlined,
  SettingOutlined,
  DatabaseOutlined,
  FolderAddOutlined,
  MinusCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined
} from '@ant-design/icons';
import { importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';

const { Option } = Select;

const { Step } = Steps;

const initialProgress = {
  total: 0,
  processed: 0,
  remaining: 0,
  currentFile: '',
  estimatedTimeRemaining: 0,
  percentage: 0
};

const initialMirrorProgress = {
  total: 0,
  processed: 0,
  currentFile: '',
  percentage: 0
};

const ImportPage = () => {
  const [modal, modalContextHolder] = Modal.useModal();
  const [sourcePath, setSourcePath] = useState('');
  const [defaultPath, setDefaultPath] = useState('/Volumes');
  const [currentStep, setCurrentStep] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // 进度信息
  const [progressInfo, setProgressInfo] = useState(initialProgress);
  // 镜像阶段进度
  const [mirrorProgress, setMirrorProgress] = useState(initialMirrorProgress);

  // 任务管理相关状态
  const [taskId, setTaskId] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);     // running | paused | completed | cancelled | failed
  const [taskPhase, setTaskPhase] = useState('pending');  // pending | scan | import | mirror | done | error
  const [actionLoading, setActionLoading] = useState(false); // 暂停/恢复/取消按钮 loading
  const eventSourceRef = useRef(null);

  // 存储仓库相关
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const { setCurrentRepoId } = useRepo();
  const [repoModalVisible, setRepoModalVisible] = useState(false);
  const [manageModalVisible, setManageModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [repoPath, setRepoPath] = useState('');
  const [repoPathSelecting, setRepoPathSelecting] = useState(false);
  const [smartNaming, setSmartNaming] = useState(false);
  // Task 7.1：导入归档与镜像备份相关状态
  const [archiveByExif, setArchiveByExif] = useState(false);
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [mirrorPath, setMirrorPath] = useState('');
  const [mirrorPathSelecting, setMirrorPathSelecting] = useState(false);

  // 当仓库切换时同步到全局上下文
  useEffect(() => {
    if (selectedRepo) {
      setCurrentRepoId(selectedRepo);
    }
  }, [selectedRepo]);

  // 存储卡路径选择
  const [sourcePathSelecting, setSourcePathSelecting] = useState(false);

  // 建立 SSE 订阅任务进度
  const attachSSE = (id) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = importApi.streamTaskProgress(id, {
      onMessage: (data, source) => {
        if (data.type === 'progress') {
          setTaskStatus(data.data.status);
          setTaskPhase(data.data.phase);
          if (data.data.progress) setProgressInfo(data.data.progress);
          if (data.data.mirrorProgress) setMirrorProgress(data.data.mirrorProgress);
        } else if (data.type === 'complete') {
          setTaskStatus('completed');
          setTaskPhase('done');
          setImportResult(data.data);
          setCurrentStep(2);
          setImporting(false);
          source.close();
          eventSourceRef.current = null;
          localStorage.removeItem('importTaskId');
          setTaskId(null);
        } else if (data.type === 'cancelled') {
          setTaskStatus('cancelled');
          setImporting(false);
          source.close();
          eventSourceRef.current = null;
          localStorage.removeItem('importTaskId');
          setTaskId(null);
          message.info('任务已取消，已复制文件保留在仓库中');
          setCurrentStep(0);
        } else if (data.type === 'error') {
          setTaskStatus('failed');
          setImporting(false);
          source.close();
          eventSourceRef.current = null;
          localStorage.removeItem('importTaskId');
          setTaskId(null);
          message.error('任务失败: ' + (data.error || '未知错误'));
          setCurrentStep(0);
        }
      },
      onError: (err) => {
        console.error('SSE 错误:', err.message);
      }
    });
    eventSourceRef.current = es;
  };

  // 组件挂载时检查是否有活跃任务（切 tab/刷新/应用重启后自动恢复进度）
  useEffect(() => {
    (async () => {
      try {
        const res = await importApi.getActiveTask();
        if (res.data.success && res.data.data) {
          const task = res.data.data;
          setTaskId(task.taskId);
          setTaskStatus(task.status);
          setTaskPhase(task.phase || 'pending');
          setProgressInfo(task.progress || initialProgress);
          setMirrorProgress(task.mirrorProgress || initialMirrorProgress);
          localStorage.setItem('importTaskId', task.taskId);
          // 进入"导入中"步骤
          setCurrentStep(1);
          setImporting(true);
          // 建立 SSE 接续进度
          attachSSE(task.taskId);
        } else {
          // 没有活跃任务，清理 localStorage
          localStorage.removeItem('importTaskId');
        }
      } catch (err) {
        console.error('获取活跃任务失败:', err);
      }
    })();

    // 卸载时关闭 SSE（切 tab/刷新场景，任务在后端继续执行）
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // 处理存储卡路径的文件夹选择（使用后端接口）
  const handleSourceFolderSelect = async () => {
    try {
      setSourcePathSelecting(true);
      message.loading('正在打开文件夹选择对话框...', 0);
      
      const res = await importApi.selectFolder();
      
      message.destroy();
      
      if (res.data.success) {
        const selectedPath = res.data.data.path;
        setSourcePath(selectedPath);
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
    } finally {
      setSourcePathSelecting(false);
    }
  };

  useEffect(() => {
    fetchDefaultPath();
    fetchRepos();
  }, []);

  const fetchDefaultPath = async () => {
    try {
      const res = await importApi.getDefaultPath();
      if (res.data.success) {
        setDefaultPath(res.data.data.defaultPath);
      }
    } catch (error) {
      console.error('获取默认路径失败:', error);
    }
  };

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

  const handleAddRepo = async (values) => {
    try {
      const res = await importApi.addRepo({ ...values, path: repoPath });
      if (res.data.success) {
        message.success('添加成功');
        setRepoModalVisible(false);
        form.resetFields();
        setRepoPath('');
        fetchRepos();
      }
    } catch (error) {
      message.error('添加失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDeleteRepo = (repo) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除仓库 "${repo.name}" 吗？\n注意：这不会删除实际文件，只是移除配置。`,
      onOk: async () => {
        try {
          const res = await importApi.deleteRepo(repo.id);
          if (res.data.success) {
            message.success('删除成功');
            fetchRepos();
          }
        } catch (error) {
          message.error('删除失败');
        }
      }
    });
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

  // 处理仓库路径的文件夹选择（使用后端接口）
  const handleRepoFolderSelect = async () => {
    try {
      setRepoPathSelecting(true);
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
    } finally {
      setRepoPathSelecting(false);
    }
  };

  // Task 7.2：处理镜像路径的文件夹选择（参考 handleRepoFolderSelect）
  const handleMirrorFolderSelect = async () => {
    try {
      setMirrorPathSelecting(true);
      message.loading('正在打开文件夹选择对话框...', 0);

      const res = await importApi.selectFolder();

      message.destroy();

      if (res.data.success) {
        const selectedPath = res.data.data.path;
        setMirrorPath(selectedPath);
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
    } finally {
      setMirrorPathSelecting(false);
    }
  };

  // Task 7.3：计算镜像路径是否与主仓库路径冲突
  const mirrorPathConflict = (() => {
    if (!mirrorEnabled || !mirrorPath) return false;
    const selectedRepoObj = repos.find(r => r.id === selectedRepo);
    return !!(selectedRepoObj && selectedRepoObj.path && mirrorPath === selectedRepoObj.path);
  })();

  const handleImport = async () => {
    if (!sourcePath.trim()) {
      message.error('请输入存储卡路径');
      return;
    }

    if (!selectedRepo) {
      message.error('请选择目标存储仓库');
      return;
    }

    // Task 7.3：镜像路径与主仓库路径相同时禁止导入
    if (mirrorEnabled && mirrorPath) {
      const selectedRepoObj = repos.find(r => r.id === selectedRepo);
      if (selectedRepoObj && selectedRepoObj.path && mirrorPath === selectedRepoObj.path) {
        message.error('镜像路径不能与主仓库路径相同');
        return;
      }
    }

    setImporting(true);
    setCurrentStep(1);
    setImportResult(null);
    setTaskPhase('pending');
    setTaskStatus('running');
    // 重置进度信息
    setProgressInfo(initialProgress);
    setMirrorProgress(initialMirrorProgress);

    try {
      const effectiveMirrorPath = mirrorEnabled ? mirrorPath.trim() : null;
      const res = await importApi.createTask(
        sourcePath.trim(),
        selectedRepo,
        smartNaming,
        archiveByExif,
        effectiveMirrorPath
      );

      if (res.data.success) {
        const newTaskId = res.data.data.taskId;
        setTaskId(newTaskId);
        localStorage.setItem('importTaskId', newTaskId);
        // 建立 SSE 订阅进度
        attachSSE(newTaskId);
      } else {
        message.error(res.data.error || '创建导入任务失败');
        setImporting(false);
        setCurrentStep(0);
      }
    } catch (error) {
      message.error('创建导入任务失败: ' + (error.response?.data?.error || error.message));
      setImporting(false);
      setCurrentStep(0);
    }
  };

  // 暂停任务
  const handlePause = async () => {
    if (!taskId) return;
    setActionLoading(true);
    try {
      await importApi.pauseTask(taskId);
      setTaskStatus('paused');
      message.success('任务已暂停');
    } catch (err) {
      message.error('暂停失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(false);
    }
  };

  // 恢复任务
  const handleResume = async () => {
    if (!taskId) return;
    setActionLoading(true);
    try {
      await importApi.resumeTask(taskId);
      setTaskStatus('running');
      message.success('任务已恢复');
    } catch (err) {
      message.error('恢复失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(false);
    }
  };

  // 取消任务（带确认）
  const handleCancel = () => {
    if (!taskId) return;
    modal.confirm({
      title: '确认取消导入任务',
      content: '取消后任务将停止，但已复制的文件会保留在仓库中，下次重新导入会自动跳过这些文件。是否确认取消？',
      okText: '确认取消',
      cancelText: '继续导入',
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionLoading(true);
        try {
          await importApi.cancelTask(taskId);
          // SSE 会推送 cancelled 消息，由 onMessage 处理后续 UI 切换
        } catch (err) {
          message.error('取消失败: ' + (err.response?.data?.error || err.message));
        } finally {
          setActionLoading(false);
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

  // Task 7.5：格式化 EXIF 拍摄时间用于文件列表小标签
  const formatExifDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (e) {
      return '';
    }
  };

  const getTotalSize = (files) => {
    return files.reduce((sum, f) => sum + (f.size || 0), 0);
  };

  return (
    <div>
      {/* 页面头部 */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <ImportOutlined style={{ fontSize: 20, color: 'var(--accent)' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: 20 }}>存储卡导入</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
              一键将相机存储卡的 RAW、JPG 和视频收入仓库
            </p>
          </div>
        </div>
        <Steps current={currentStep} size="small">
          <Step title="选择路径" description="输入存储卡路径" />
          <Step title="导入中" description="扫描并复制文件" />
          <Step title="完成" description="导入结果" />
        </Steps>
      </Card>

      {currentStep === 0 && (
        <Card>
          <Space direction="vertical" style={{ width: '100%' }} size={20}>
            <Alert
              message="使用说明"
              description={
                <div>
                  <p>1. 将相机存储卡插入电脑</p>
                  <p>2. 输入存储卡的根目录路径（如 /Volumes/SD_CARD）</p>
                  <p>3. 系统会自动扫描所有 JPG、RAW 和视频文件</p>
                  <p>4. 文件将按类型分类存储到对应目录</p>
                  <p style={{ color: 'var(--success)', fontWeight: 500 }}>✓ 支持增量导入：已存在的文件不会被覆盖</p>
                </div>
              }
              type="info"
              showIcon
            />

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                目标存储仓库
              </label>
              <Space>
                <Select
                  value={selectedRepo}
                  onChange={setSelectedRepo}
                  style={{ width: 300 }}
                  size="large"
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
                <Button 
                  icon={<PlusOutlined />} 
                  onClick={() => setRepoModalVisible(true)}
                  size="large"
                >
                  添加仓库
                </Button>
                <Button 
                  icon={<SettingOutlined />} 
                  onClick={() => setManageModalVisible(true)}
                  size="large"
                >
                  管理
                </Button>
              </Space>
              <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                照片将导入到选中的仓库中
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                存储卡路径
              </label>
              <Space.Compact style={{ width: '100%', maxWidth: 500 }}>
                <Input
                  placeholder={`例如: ${defaultPath}/SD_CARD`}
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  size="large"
                  prefix={<FolderOpenOutlined />}
                  style={{ flex: 1 }}
                />
                <Button
                  icon={<FolderAddOutlined />}
                  onClick={handleSourceFolderSelect}
                  size="large"
                  loading={sourcePathSelecting}
                >
                  选择文件夹
                </Button>
              </Space.Compact>
              <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                默认扫描路径: {defaultPath} | 点击"选择文件夹"按钮打开系统对话框，自动获取完整路径
              </div>
            </div>

            <div>
              <Space>
                <Switch
                  checked={smartNaming}
                  onChange={setSmartNaming}
                  id="smartNaming"
                />
                <label htmlFor="smartNaming" style={{ fontWeight: 500, cursor: 'pointer' }}>
                  智能命名
                </label>
              </Space>
              <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12, lineHeight: 1.8 }}>
                开启后，文件将按所在子文件夹名称重命名：
                <br />
                • 无中文名文件：文件夹名-序号（如 100CANON-1.jpg）
                <br />
                • 已有中文名文件：文件夹名_原中文名（如 100CANON_旅行第一天.jpg）
              </div>
            </div>

            {/* Task 7.2：按 EXIF 时间归档开关 */}
            <div>
              <Space>
                <Switch
                  checked={archiveByExif}
                  onChange={setArchiveByExif}
                  id="archiveByExif"
                />
                <label htmlFor="archiveByExif" style={{ fontWeight: 500, cursor: 'pointer' }}>
                  按 EXIF 时间归档
                </label>
              </Space>
              <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12, lineHeight: 1.8 }}>
                开启后文件按拍摄时间归档到 category/YYYY/MM/ 子目录；关闭则保持扁平结构
              </div>
            </div>

            {/* Task 7.2：镜像备份开关 */}
            <div>
              <Space>
                <Switch
                  checked={mirrorEnabled}
                  onChange={(checked) => {
                    setMirrorEnabled(checked);
                    if (!checked) setMirrorPath('');
                  }}
                  id="mirrorEnabled"
                />
                <label htmlFor="mirrorEnabled" style={{ fontWeight: 500, cursor: 'pointer' }}>
                  镜像备份
                </label>
              </Space>
              <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12, lineHeight: 1.8 }}>
                开启后，导入的同时将文件镜像复制到独立的备份目录
              </div>

              {/* 镜像路径输入区 */}
              {mirrorEnabled && (
                <div style={{ marginTop: 8 }}>
                  <Space.Compact style={{ width: '100%', maxWidth: 500 }}>
                    <Input
                      placeholder="选择或输入镜像备份目标根路径"
                      value={mirrorPath}
                      onChange={(e) => setMirrorPath(e.target.value)}
                      size="large"
                      prefix={<FolderOpenOutlined />}
                      style={{ flex: 1 }}
                    />
                    <Button
                      icon={<FolderAddOutlined />}
                      onClick={handleMirrorFolderSelect}
                      size="large"
                      loading={mirrorPathSelecting}
                    >
                      选择文件夹
                    </Button>
                  </Space.Compact>
                  {/* Task 7.3：路径冲突警告 */}
                  {mirrorPathConflict && (
                    <Alert
                      message="镜像路径不能与主仓库路径相同"
                      description="请选择一个与主仓库不同的目录作为镜像备份目标"
                      type="warning"
                      showIcon
                      style={{ marginTop: 8, maxWidth: 500 }}
                    />
                  )}
                </div>
              )}
            </div>

            <Button
              type="primary"
              size="large"
              icon={<ImportOutlined />}
              onClick={handleImport}
              loading={importing}
              disabled={!sourcePath.trim() || !selectedRepo || mirrorPathConflict}
            >
              开始导入
            </Button>
          </Space>
        </Card>
      )}

      {currentStep === 1 && (
        <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Spin size="large" style={{ marginBottom: 24 }} />
          <h3>
            {taskStatus === 'paused'
              ? (taskPhase === 'mirror' ? '镜像备份已暂停' : '导入已暂停')
              : (taskPhase === 'mirror' ? '正在镜像备份...' : '正在导入中...')}
          </h3>

          {/* 状态提示 */}
          <div style={{ marginBottom: 24 }}>
            {taskStatus === 'paused' ? (
              <Alert
                message={taskPhase === 'mirror' ? '镜像备份已暂停' : '导入任务已暂停'}
                description="点击恢复按钮继续执行，或取消任务终止导入"
                type="warning"
                showIcon
                style={{ maxWidth: 500, margin: '0 auto' }}
              />
            ) : progressInfo.total === 0 && progressInfo.percentage === 0 ? (
              <Alert
                message="正在扫描存储卡中的媒体文件..."
                description="系统正在查找 JPG、RAW 和视频文件，请稍候"
                type="info"
                showIcon
                style={{ maxWidth: 500, margin: '0 auto' }}
              />
            ) : progressInfo.total === 0 && progressInfo.percentage === 100 ? (
              <Alert
                message="未找到媒体文件"
                description={
                  <div>
                    <p>所选文件夹中没有找到支持的媒体文件。</p>
                    <p>支持的格式：JPG、JPEG、RAW（ARW、CR2、CR3、NEF、DNG等）、视频（MP4、MOV、AVI等）</p>
                  </div>
                }
                type="warning"
                showIcon
                style={{ maxWidth: 500, margin: '0 auto' }}
              />
            ) : progressInfo.processed === progressInfo.total && progressInfo.total > 0 && taskPhase !== 'mirror' ? (
              <Alert
                message="文件处理完成"
                description="正在整理导入结果..."
                type="success"
                showIcon
                style={{ maxWidth: 500, margin: '0 auto' }}
              />
            ) : null}
          </div>

          {/* 进度统计（导入阶段） */}
          <Row gutter={[16, 16]} style={{ marginTop: 32, marginBottom: 32 }}>
            <Col span={6}>
              <Statistic
                title="总文件数"
                value={progressInfo.total}
                suffix="个"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="已处理"
                value={progressInfo.processed}
                suffix="个"
                valueStyle={{ color: 'var(--success)' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="剩余"
                value={progressInfo.remaining}
                suffix="个"
                valueStyle={{ color: 'var(--accent)' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="预计剩余时间"
                value={progressInfo.estimatedTimeRemaining > 0 ? Math.ceil(progressInfo.estimatedTimeRemaining / 60) : progressInfo.total > 0 ? '< 1' : 0}
                suffix="分钟"
                valueStyle={{ color: 'var(--accent)' }}
              />
            </Col>
          </Row>

          {/* 当前处理的文件 */}
          {progressInfo.currentFile && progressInfo.total > 0 && taskPhase !== 'mirror' && (
            <div style={{ marginBottom: 16, color: 'var(--muted)' }}>
              {progressInfo.processed < progressInfo.total ? (
                <>
                  正在处理: <strong style={{ color: 'var(--text)' }}>{progressInfo.currentFile}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    第 {progressInfo.processed + 1} 个文件，共 {progressInfo.total} 个
                  </div>
                </>
              ) : (
                <>
                  最后处理: <strong style={{ color: 'var(--text)' }}>{progressInfo.currentFile}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    所有文件已处理完毕
                  </div>
                </>
              )}
            </div>
          )}

          {/* 导入阶段进度条 */}
          <Progress
            percent={progressInfo.percentage}
            status={taskStatus === 'paused' ? 'normal' : (progressInfo.total === 0 && progressInfo.percentage === 100 ? 'exception' : 'active')}
            style={{ maxWidth: 600, margin: '0 auto' }}
            format={(percent) => progressInfo.total === 0 ? (progressInfo.percentage === 100 ? '无文件' : '扫描中...') : `${percent}% (${progressInfo.processed}/${progressInfo.total})`}
          />

          {/* 镜像阶段进度条 */}
          {taskPhase === 'mirror' && mirrorProgress.total > 0 && (
            <div style={{ maxWidth: 600, margin: '24px auto 0' }}>
              <div style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 13 }}>
                镜像备份中: <strong style={{ color: 'var(--text)' }}>{mirrorProgress.currentFile}</strong>
                <span style={{ marginLeft: 8, fontSize: 12 }}>
                  第 {mirrorProgress.processed} 个，共 {mirrorProgress.total} 个
                </span>
              </div>
              <Progress
                percent={mirrorProgress.percentage}
                status={taskStatus === 'paused' ? 'normal' : 'active'}
                strokeColor={{ from: '#108ee9', to: '#87d068' }}
                format={(percent) => `${percent}% (${mirrorProgress.processed}/${mirrorProgress.total})`}
              />
            </div>
          )}

          {/* 任务控制按钮组 */}
          <div style={{ marginTop: 32 }}>
            <Space size="middle">
              {taskStatus === 'running' && (
                <Button
                  icon={<PauseCircleOutlined />}
                  onClick={handlePause}
                  loading={actionLoading}
                  size="large"
                >
                  暂停
                </Button>
              )}
              {taskStatus === 'paused' && (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleResume}
                  loading={actionLoading}
                  size="large"
                >
                  恢复
                </Button>
              )}
              {(taskStatus === 'running' || taskStatus === 'paused') && (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={handleCancel}
                  loading={actionLoading}
                  size="large"
                >
                  取消任务
                </Button>
              )}
            </Space>
          </div>

          {/* 底部提示 */}
          <div style={{ marginTop: 24 }}>
            {progressInfo.total === 0 && progressInfo.percentage === 100 ? (
              <Button type="primary" onClick={() => setCurrentStep(0)}>
                返回重新选择
              </Button>
            ) : (
              <p style={{ color: 'var(--muted)' }}>
                {taskStatus === 'paused'
                  ? '任务已暂停，可随时恢复或取消'
                  : taskPhase === 'mirror'
                    ? '正在将导入的文件镜像备份到独立目录'
                    : progressInfo.total > 0
                      ? '正在扫描存储卡并复制文件，可随时暂停'
                      : '正在扫描文件夹中的媒体文件，请稍候...'}
              </p>
            )}
          </div>
        </Card>
      )}

      {currentStep === 2 && importResult && (
        <Card>
          {/* 根据导入结果显示不同的提示 */}
          {importResult.jpgCount + importResult.rawCount + importResult.videoCount === 0 ? (
            // 没有导入任何文件
            importResult.skippedCount > 0 ? (
              // 所有文件都已存在
              <Alert
                message="所有文件都已存在"
                description={
                  <div>
                    <p>扫描到 {importResult.skippedCount} 个文件，但都已存在于目标仓库中。</p>
                    <p style={{ marginTop: 8, color: 'var(--muted)' }}>
                      💡 提示：系统使用增量导入模式，不会覆盖已存在的文件。如果您想重新导入，请先删除目标仓库中的旧文件。
                    </p>
                  </div>
                }
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
              />
            ) : (
              // 没有找到文件
              <Alert
                message="未找到可导入的文件"
                description="所选文件夹中没有找到支持的媒体文件（JPG、RAW、视频）"
                type="warning"
                showIcon
                style={{ marginBottom: 24 }}
              />
            )
          ) : (
            // 成功导入文件
            <Alert
              message={
                importResult.skippedCount > 0 
                  ? `导入完成！新增 ${importResult.jpgCount + importResult.rawCount + importResult.videoCount} 个文件，跳过 ${importResult.skippedCount} 个已存在文件`
                  : `导入完成！成功导入 ${importResult.jpgCount + importResult.rawCount + importResult.videoCount} 个文件`
              }
              description={
                <div>
                  <p>文件已成功导入到仓库 <strong>{importResult.targetRepo}</strong></p>
                  {importResult.skippedCount > 0 && (
                    <p style={{ marginTop: 8, marginBottom: 0, color: 'var(--muted)' }}>
                      💡 跳过的文件已存在于目标位置，未进行覆盖
                    </p>
                  )}
                </div>
              }
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              style={{ marginBottom: 24 }}
            />
          )}

          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="JPG 照片"
                  value={importResult.jpgCount}
                  prefix={<FileImageOutlined style={{ color: 'var(--success)' }} />}
                  suffix="张"
                />
                {importResult.details.jpg.length > 0 && (
                  <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                    总大小: {formatFileSize(getTotalSize(importResult.details.jpg))}
                  </div>
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="RAW 底片"
                  value={importResult.rawCount}
                  prefix={<FileOutlined style={{ color: 'var(--accent)' }} />}
                  suffix="张"
                />
                {importResult.details.raw.length > 0 && (
                  <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                    总大小: {formatFileSize(getTotalSize(importResult.details.raw))}
                  </div>
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="视频文件"
                  value={importResult.videoCount}
                  prefix={<VideoCameraOutlined style={{ color: 'var(--info)' }} />}
                  suffix="个"
                />
                {importResult.details.video.length > 0 && (
                  <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                    总大小: {formatFileSize(getTotalSize(importResult.details.video))}
                  </div>
                )}
              </Card>
            </Col>
          </Row>

          {/* Task 7.5：去重跳过 & 镜像统计行 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col span={(importResult.mirrorSuccessCount || 0) + (importResult.mirrorErrorCount || 0) > 0 ? 12 : 24}>
              <Card>
                <Statistic
                  title="去重跳过（哈希重复）"
                  value={importResult.skippedCount || 0}
                  prefix={<MinusCircleOutlined style={{ color: 'var(--muted)' }} />}
                  suffix="个"
                />
                <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                  已存在于目标仓库，未进行覆盖
                </div>
              </Card>
            </Col>
            {(importResult.mirrorSuccessCount || 0) + (importResult.mirrorErrorCount || 0) > 0 && (
              <Col span={12}>
                <Card>
                  <Statistic
                    title="镜像备份"
                    value={importResult.mirrorSuccessCount || 0}
                    prefix={<DatabaseOutlined style={{ color: 'var(--accent)' }} />}
                    suffix={`/ 失败 ${importResult.mirrorErrorCount || 0}`}
                  />
                  <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                    成功 / 失败数
                  </div>
                </Card>
              </Col>
            )}
          </Row>

          {/* Task 7.5：镜像失败 Alert */}
          {(importResult.mirrorErrorCount || 0) > 0 && (
            <Alert
              message={`镜像备份失败 ${importResult.mirrorErrorCount} 个文件`}
              description={
                importResult.details && importResult.details.mirrorErrors && importResult.details.mirrorErrors.length > 0
                  ? `失败文件: ${importResult.details.mirrorErrors.slice(0, 5).map(e => e.file || e.name).join(', ')}${importResult.details.mirrorErrors.length > 5 ? ' 等' : ''}`
                  : '请查看日志了解失败详情'
              }
              type="warning"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}

          {importResult.skippedCount > 0 && (
            <Alert
              message={`${importResult.skippedCount} 个文件已存在并被跳过`}
              description="这些文件在目标位置已经存在，未进行覆盖操作"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}

          {importResult.errorCount > 0 && (
            <Alert
              message={`导入过程中有 ${importResult.errorCount} 个文件出错`}
              type="warning"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}

          <Divider />

          <Space>
            <Button type="primary" onClick={async () => {
              // 清理后端已结束的任务记录，允许新建下一个任务
              if (taskId) {
                try {
                  await importApi.clearTask(taskId);
                } catch (err) {
                  console.warn('清理任务记录失败:', err);
                }
              }
              setTaskId(null);
              setTaskStatus(null);
              setTaskPhase('pending');
              setImportResult(null);
              setSourcePath('');
              setProgressInfo(initialProgress);
              setMirrorProgress(initialMirrorProgress);
              localStorage.removeItem('importTaskId');
              setCurrentStep(0);
            }}>
              继续导入
            </Button>
            <Button onClick={() => window.location.href = '/gallery'}>
              去浏览照片
            </Button>
          </Space>

          {importResult.details.skipped && importResult.details.skipped.length > 0 && (
            <>
              <Divider orientation="left">跳过的文件（已存在）</Divider>
              <List
                size="small"
                bordered
                dataSource={importResult.details.skipped}
                renderItem={item => {
                  // Task 7.5：跳过项若有 EXIF 拍摄时间也展示小标签
                  const exifDate = item.exif && item.exif.dateTimeOriginal ? formatExifDate(item.exif.dateTimeOriginal) : '';
                  return (
                    <List.Item>
                      <Space size={4} wrap>
                        <Tag color="default">跳过</Tag>
                        {item.name}
                        {item.reason && (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            - {item.reason === 'already_exists' ? '文件已存在' : item.reason === 'duplicate_hash' ? '哈希重复' : item.reason}
                          </span>
                        )}
                        {exifDate && (
                          <Tag color="purple" style={{ fontSize: 11 }}>
                            {exifDate}
                          </Tag>
                        )}
                      </Space>
                    </List.Item>
                  );
                }}
                style={{ maxHeight: 200, overflow: 'auto', marginBottom: 16 }}
              />
            </>
          )}

          {importResult.details.errors.length > 0 && (
            <>
              <Divider orientation="left">错误详情</Divider>
              <List
                size="small"
                bordered
                dataSource={importResult.details.errors}
                renderItem={item => (
                  <List.Item>
                    <Tag color="error">错误</Tag>
                    {item.file}: {item.error}
                  </List.Item>
                )}
                style={{ maxHeight: 200, overflow: 'auto' }}
              />
            </>
          )}
        </Card>
      )}

      {/* 添加仓库弹窗 */}
      <Modal
        title="添加存储仓库"
        open={repoModalVisible}
        onCancel={() => {
          setRepoModalVisible(false);
          setRepoPath('');
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="添加"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddRepo}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="仓库名称"
            name="name"
            rules={[{ required: true, message: '请输入仓库名称' }]}
          >
            <Input placeholder="例如：索尼照片库" />
          </Form.Item>
          
          <Form.Item
            label="存储路径"
            required
            rules={[{ required: true, message: '请输入存储路径' }]}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="例如：/Users/colorh/Pictures/索尼照片"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button
                icon={<FolderAddOutlined />}
                onClick={handleRepoFolderSelect}
                loading={repoPathSelecting}
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
            <Radio checked={false}>设为默认仓库</Radio>
          </Form.Item>
        </Form>
      </Modal>

      {/* 管理仓库弹窗 */}
      <Modal
        title="管理存储仓库"
        open={manageModalVisible}
        onCancel={() => setManageModalVisible(false)}
        footer={null}
        width={700}
      >
        <Table
          dataSource={repos}
          rowKey="id"
          pagination={false}
          style={{ marginTop: 16 }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              key: 'name',
              render: (text, record) => (
                <Space>
                  <DatabaseOutlined />
                  {text}
                  {record.isDefault && <Tag color="blue">默认</Tag>}
                </Space>
              )
            },
            {
              title: '路径',
              dataIndex: 'path',
              key: 'path',
              ellipsis: true
            },
            {
              title: '操作',
              key: 'action',
              width: 200,
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
                    danger 
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteRepo(record)}
                  >
                    删除
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Modal>
      {modalContextHolder}
    </div>
  );
};

export default ImportPage;
