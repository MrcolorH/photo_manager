import { useEffect, useState } from 'react';
import {
  Card,
  Button,
  Table,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Radio,
  message,
  Popconfirm,
  Alert,
  Descriptions,
  App
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  DatabaseOutlined,
  FolderOutlined,
  CheckCircleOutlined,
  FolderAddOutlined
} from '@ant-design/icons';
import { importApi } from '../api';

const RepoSettings = () => {
  const { message: messageApi } = App.useApp();
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRepo, setEditingRepo] = useState(null);
  const [form] = Form.useForm();
  const [repoPath, setRepoPath] = useState('');

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    setLoading(true);
    try {
      const res = await importApi.getRepos();
      if (res.data.success) {
        setRepos(res.data.data);
      }
    } catch (error) {
      messageApi.error('获取仓库列表失败');
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
        messageApi.success(editingRepo ? '修改成功' : '添加成功');
        setModalVisible(false);
        form.resetFields();
        setRepoPath('');
        fetchRepos();
      }
    } catch (error) {
      messageApi.error((editingRepo ? '修改' : '添加') + '失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 使用后端接口选择文件夹
  const handleSelectFolder = async () => {
    let hide;
    try {
      hide = messageApi.loading('正在打开文件夹选择对话框...', 0);
      
      const res = await importApi.selectFolder();
      
      if (hide) hide();
      
      if (res.data.success) {
        const selectedPath = res.data.data.path;
        setRepoPath(selectedPath);
        form.setFieldsValue({ path: selectedPath });
        messageApi.success('已选择: ' + selectedPath);
      } else {
        if (res.data.error !== '用户取消选择') {
          messageApi.error(res.data.error || '选择失败');
        }
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
      if (hide) hide();
      messageApi.error('选择文件夹失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDelete = async (repo) => {
    try {
      const res = await importApi.deleteRepo(repo.id);
      if (res.data.success) {
        messageApi.success('删除成功');
        fetchRepos();
      }
    } catch (error) {
      messageApi.error('删除失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleSetDefault = async (repoId) => {
    try {
      const res = await importApi.setDefaultRepo(repoId);
      if (res.data.success) {
        messageApi.success('设置成功');
        fetchRepos();
      }
    } catch (error) {
      messageApi.error('设置失败');
    }
  };

  const columns = [
    {
      title: '仓库名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
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
          <FolderOutlined style={{ color: '#999' }} />
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
      <h2 style={{ marginBottom: 16 }}>存储仓库配置</h2>

      <Alert
        title="仓库说明"
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
                placeholder="例如：C:\\Users\\YourName\\Pictures\\相机照片"
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
            <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
              点击"选择文件夹"按钮打开系统对话框，自动获取完整路径
            </div>
          </Form.Item>

          <Form.Item
            name="isDefault"
            valuePropName="checked"
          >
            <Radio>设为默认仓库</Radio>
          </Form.Item>
        </Form>
      </Modal>

      <Card title="目录结构说明" style={{ marginTop: 24 }}>
        <Descriptions bordered column={1}>
          <Descriptions.Item label="仓库根目录">
            C:\Users\[用户名]\Pictures\相机照片
          </Descriptions.Item>
          <Descriptions.Item label="JPG 照片">
            C:\Users\[用户名]\Pictures\相机照片\jpg\
          </Descriptions.Item>
          <Descriptions.Item label="RAW 底片">
            C:\Users\[用户名]\Pictures\相机照片\raw\
          </Descriptions.Item>
          <Descriptions.Item label="视频文件">
            C:\Users\[用户名]\Pictures\相机照片\video\
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
};

export default RepoSettings;
