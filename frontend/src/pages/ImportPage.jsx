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
  FolderAddOutlined
} from '@ant-design/icons';
import { importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';

const { Option } = Select;

const { Step } = Steps;

const ImportPage = () => {
  const [sourcePath, setSourcePath] = useState('');
  const [defaultPath, setDefaultPath] = useState('/Volumes');
  const [currentStep, setCurrentStep] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  
  // 进度信息
  const [progressInfo, setProgressInfo] = useState({
    total: 0,
    processed: 0,
    remaining: 0,
    currentFile: '',
    estimatedTimeRemaining: 0,
    percentage: 0
  });
  
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

  // 当仓库切换时同步到全局上下文
  useEffect(() => {
    if (selectedRepo) {
      setCurrentRepoId(selectedRepo);
    }
  }, [selectedRepo]);
  
  // 存储卡路径选择
  const [sourcePathSelecting, setSourcePathSelecting] = useState(false);

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
    Modal.confirm({
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

  const handleImport = async () => {
    if (!sourcePath.trim()) {
      message.error('请输入存储卡路径');
      return;
    }

    if (!selectedRepo) {
      message.error('请选择目标存储仓库');
      return;
    }

    setImporting(true);
    setCurrentStep(1);
    
    // 重置进度信息
    setProgressInfo({
      total: 0,
      processed: 0,
      remaining: 0,
      currentFile: '',
      estimatedTimeRemaining: 0,
      percentage: 0
    });

    try {
      // 设置进度回调
      importApi.setProgressCallback((progress) => {
        setProgressInfo(progress);
      });
      
      const res = await importApi.importFromCard(sourcePath.trim(), selectedRepo, smartNaming);
      
      if (res.data.success) {
        setImportResult(res.data.data);
        setCurrentStep(2);
        message.success('导入完成！');
      } else {
        message.error(res.data.error || '导入失败');
        setCurrentStep(0);
      }
    } catch (error) {
      message.error('导入失败: ' + (error.response?.data?.error || error.message));
      setCurrentStep(0);
    } finally {
      setImporting(false);
      // 清除进度回调
      importApi.setProgressCallback(null);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
            <h2 style={{ margin: 0, fontFamily: "'Noto Serif SC', Georgia, serif", fontSize: 20 }}>存储卡导入</h2>
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

            <Button
              type="primary"
              size="large"
              icon={<ImportOutlined />}
              onClick={handleImport}
              loading={importing}
              disabled={!sourcePath.trim() || !selectedRepo}
            >
              开始导入
            </Button>
          </Space>
        </Card>
      )}

      {currentStep === 1 && (
        <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Spin size="large" style={{ marginBottom: 24 }} />
          <h3>正在导入中...</h3>
          
          {/* 状态提示 */}
          <div style={{ marginBottom: 24 }}>
            {progressInfo.total === 0 && progressInfo.percentage === 0 ? (
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
            ) : progressInfo.processed === progressInfo.total && progressInfo.total > 0 ? (
              <Alert
                message="文件处理完成"
                description="正在整理导入结果..."
                type="success"
                showIcon
                style={{ maxWidth: 500, margin: '0 auto' }}
              />
            ) : null}
          </div>
          
          {/* 进度统计 */}
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
          {progressInfo.currentFile && progressInfo.total > 0 && (
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
          
          {/* 进度条 */}
          <Progress 
            percent={progressInfo.percentage} 
            status={progressInfo.total === 0 && progressInfo.percentage === 100 ? 'exception' : 'active'}
            style={{ maxWidth: 600, margin: '0 auto' }}
            format={(percent) => progressInfo.total === 0 ? (progressInfo.percentage === 100 ? '无文件' : '扫描中...') : `${percent}% (${progressInfo.processed}/${progressInfo.total})`}
          />
          
          {/* 底部提示 */}
          <div style={{ marginTop: 24 }}>
            {progressInfo.total === 0 && progressInfo.percentage === 100 ? (
              <Button type="primary" onClick={() => setCurrentStep(0)}>
                返回重新选择
              </Button>
            ) : (
              <p style={{ color: 'var(--muted)' }}>
                {progressInfo.total > 0 
                  ? '正在扫描存储卡并复制文件，请稍候' 
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
            <Button type="primary" onClick={() => {
              setCurrentStep(0);
              setImportResult(null);
              setSourcePath('');
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
                renderItem={item => (
                  <List.Item>
                    <Tag color="default">跳过</Tag>
                    {item.name} - {item.reason === 'already_exists' ? '文件已存在' : item.reason}
                  </List.Item>
                )}
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
    </div>
  );
};

export default ImportPage;
