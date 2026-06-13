import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Row,
  Col,
  Card,
  Image,
  Button,
  Space,
  Select,
  Pagination,
  Empty,
  Spin,
  Modal,
  message,
  Tooltip,
  Tag,
  Checkbox,
  Dropdown,
  Input,
  Alert
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  FilterOutlined,
  DatabaseOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  ExportOutlined,
  CheckSquareOutlined,
  DownloadOutlined,
  FolderAddOutlined
} from '@ant-design/icons';
import { PhotoSlider } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { photoApi, importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';

const { Option } = Select;

const PhotoGallery = () => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('jpg');
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 36,
    total: 0
  });
  const [sortBy, setSortBy] = useState('modifiedTime');
  const [sortOrder, setSortOrder] = useState('desc');
  
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
  
  // 多选相关
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  
  // 导出相关
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportPath, setExportPath] = useState('');
  const [exporting, setExporting] = useState(false);
  
  // 删除相关
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePhotoData, setDeletePhotoData] = useState(null);
  const [syncDeleteRaw, setSyncDeleteRaw] = useState(false);
  const [deleteFromPreview, setDeleteFromPreview] = useState(false);
  
  // 批量删除相关
  const [batchDeleteModalVisible, setBatchDeleteModalVisible] = useState(false);
  const [batchSyncDeleteRaw, setBatchSyncDeleteRaw] = useState(false);

  // 跨页预览缓存
  const [cachedPhotos, setCachedPhotos] = useState([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const cachedPagesRef = useRef({ min: 0, max: 0 });

  useEffect(() => {
    fetchRepos();
  }, []);

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

  const fetchPhotos = useCallback(async () => {
    if (!selectedRepo) return;
    
    setLoading(true);
    try {
      const res = await photoApi.getPhotos(category, {
        page: pagination.page,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
        repoId: selectedRepo
      });
      
      if (res.data.success) {
        setPhotos(res.data.data.photos);
        setPagination(prev => ({
          ...prev,
          total: res.data.data.total
        }));
      }
    } catch (error) {
      message.error('获取照片列表失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [category, pagination.page, pagination.pageSize, sortBy, sortOrder, selectedRepo]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => {
    setCachedPhotos([]);
    cachedPagesRef.current = { min: 0, max: 0 };
  }, [category, sortBy, sortOrder, selectedRepo]);

  const handleDelete = (photo) => {
    setDeletePhotoData(photo);
    setSyncDeleteRaw(false); // 默认不勾选
    setDeleteModalVisible(true);
  };

  const handlePreviewDelete = () => {
    const currentPhoto = cachedPhotos[previewIndex];
    if (!currentPhoto) return;
    setDeleteFromPreview(true);
    handleDelete(currentPhoto);
  };

  const confirmDelete = async () => {
    try {
      const res = await photoApi.deletePhoto(
        deletePhotoData.id, 
        syncDeleteRaw,
        selectedRepo
      );
      if (res.data.success) {
        message.success('删除成功');
        setDeleteModalVisible(false);
        if (deleteFromPreview) {
          setDeleteFromPreview(false);
          const updated = cachedPhotos.filter(p => p.id !== deletePhotoData.id);
          if (updated.length === 0) {
            setPreviewVisible(false);
            fetchPhotos();
          } else {
            const newIndex = Math.min(previewIndex, updated.length - 1);
            setCachedPhotos(updated);
            setPreviewIndex(newIndex);
            fetchPhotos();
          }
        } else {
          fetchPhotos();
        }
      }
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  const fetchPagePhotos = useCallback(async (page) => {
    if (!selectedRepo) return [];
    try {
      const res = await photoApi.getPhotos(category, {
        page,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
        repoId: selectedRepo
      });
      if (res.data.success) {
        return (res.data.data.photos || []).map(photo => ({ ...photo, _page: page }));
      }
    } catch (error) {
      console.error(`获取第${page}页照片失败:`, error);
    }
    return [];
  }, [category, pagination.pageSize, sortBy, sortOrder, selectedRepo]);

  const loadPreviewPages = useCallback(async (centerPage) => {
    const totalPages = Math.ceil(pagination.total / pagination.pageSize);
    const pagesToFetch = [];
    if (centerPage > 1) pagesToFetch.push(centerPage - 1);
    pagesToFetch.push(centerPage);
    if (centerPage < totalPages) pagesToFetch.push(centerPage + 1);

    const results = await Promise.all(pagesToFetch.map(p => fetchPagePhotos(p)));
    const merged = results.flat();

    setCachedPhotos(merged);
    cachedPagesRef.current = {
      min: pagesToFetch[0],
      max: pagesToFetch[pagesToFetch.length - 1]
    };
    return merged;
  }, [pagination.total, pagination.pageSize, fetchPagePhotos]);

  const preloadingRef = useRef(false);

  const preloadAdjacentPage = useCallback(async (direction) => {
    if (preloadingRef.current) return;
    preloadingRef.current = true;
    try {
      const cached = cachedPagesRef.current;
      const totalPages = Math.ceil(pagination.total / pagination.pageSize);

      if (direction === 'next' && cached.max < totalPages) {
        const newPage = cached.max + 1;
        cachedPagesRef.current = { min: cached.min, max: newPage };
        const photos = await fetchPagePhotos(newPage);
        setCachedPhotos(prev => [...prev, ...photos]);
      }

      if (direction === 'prev' && cached.min > 1) {
        const newPage = cached.min - 1;
        cachedPagesRef.current = { min: newPage, max: cached.max };
        const photos = await fetchPagePhotos(newPage);
        setCachedPhotos(prev => [...photos, ...prev]);
        setPreviewIndex(prev => prev + photos.length);
      }
    } finally {
      preloadingRef.current = false;
    }
  }, [pagination.total, pagination.pageSize, fetchPagePhotos]);

  const handlePreviewIndexChange = useCallback(async (index) => {
    setPreviewIndex(index);

    const currentPhoto = cachedPhotos[index];
    if (!currentPhoto) return;

    if (currentPhoto._page !== pagination.page) {
      setPagination(prev => ({ ...prev, page: currentPhoto._page }));
    }

    const photoIndexOnPage = cachedPhotos
      .filter(p => p._page === currentPhoto._page)
      .findIndex(p => p.id === currentPhoto.id);

    if (photoIndexOnPage >= pagination.pageSize - 3) {
      await preloadAdjacentPage('next');
    }
    if (photoIndexOnPage <= 2) {
      await preloadAdjacentPage('prev');
    }
  }, [cachedPhotos, pagination.page, pagination.pageSize, preloadAdjacentPage]);

  const handlePreview = async (photo) => {
    if (category === 'video') {
      window.open(photo.url, '_blank');
    } else if (category === 'raw') {
      handleOpenLocation(photo, 'file');
    } else {
      const photoPage = photo._page || pagination.page;
      const merged = await loadPreviewPages(photoPage);
      const idx = merged.findIndex(p => p.id === photo.id);
      setPreviewIndex(idx >= 0 ? idx : 0);
      setPreviewVisible(true);
    }
  };

  const handlePageChange = (page, pageSize) => {
    setPagination(prev => ({ ...prev, page, pageSize }));
  };

  // 多选相关函数
  const handleSelectPhoto = (photoId, checked) => {
    if (checked) {
      setSelectedPhotos(prev => [...prev, photoId]);
    } else {
      setSelectedPhotos(prev => prev.filter(id => id !== photoId));
    }
  };

  const handleSelectAll = (e) => {
    const checked = e.target.checked;
    setSelectAll(checked);
    if (checked) {
      setSelectedPhotos(photos.map(p => p.id));
    } else {
      setSelectedPhotos([]);
    }
  };

  // 路径跳转功能
  const handleOpenLocation = async (photo, mode = 'folder') => {
    try {
      await photoApi.openLocation(photo.path, mode);
      message.success(mode === 'folder' ? '已打开文件夹' : '已打开文件');
    } catch (error) {
      message.error('打开失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 路径跳转菜单
  const getLocationMenu = (photo) => ({
    items: [
      {
        key: 'folder',
        label: '打开文件夹',
        icon: <FolderOpenOutlined />,
        onClick: () => handleOpenLocation(photo, 'folder')
      },
      {
        key: 'file',
        label: '打开文件',
        icon: <EyeOutlined />,
        onClick: () => handleOpenLocation(photo, 'file')
      }
    ]
  });

  // 批量导出功能
  const [exportPathSelecting, setExportPathSelecting] = useState(false);

  const handleBatchExport = () => {
    if (selectedPhotos.length === 0) {
      message.warning('请先选择要导出的照片');
      return;
    }
    setExportModalVisible(true);
  };

  // 使用后端接口选择导出目标文件夹
  const handleExportFolderSelect = async () => {
    try {
      setExportPathSelecting(true);
      message.loading('正在打开文件夹选择对话框...', 0);
      
      const res = await importApi.selectFolder();
      
      message.destroy();
      
      if (res.data.success) {
        const selectedPath = res.data.data.path;
        setExportPath(selectedPath);
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
      setExportPathSelecting(false);
    }
  };

  const handleConfirmExport = async () => {
    if (!exportPath.trim()) {
      message.error('请输入目标路径');
      return;
    }

    setExporting(true);
    try {
      const res = await photoApi.batchExport(selectedPhotos, exportPath.trim(), selectedRepo);
      
      if (res.data.success) {
        const { successCount, failedCount, skippedCount } = res.data.data;
        let msg = `导出完成！成功: ${successCount}`;
        if (skippedCount > 0) msg += `, 跳过: ${skippedCount}`;
        if (failedCount > 0) msg += `, 失败: ${failedCount}`;
        
        message.success(msg);
        setExportModalVisible(false);
        setExportPath('');
        setSelectedPhotos([]);
        setSelectAll(false);
      }
    } catch (error) {
      message.error('导出失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setExporting(false);
    }
  };

  // 批量删除功能
  const handleBatchDelete = () => {
    if (selectedPhotos.length === 0) {
      message.warning('请先选择要删除的照片');
      return;
    }
    setBatchSyncDeleteRaw(false);
    setBatchDeleteModalVisible(true);
  };

  const confirmBatchDelete = async () => {
    try {
      let successCount = 0;
      let failedCount = 0;
      
      for (const photoId of selectedPhotos) {
        try {
          const res = await photoApi.deletePhoto(photoId, batchSyncDeleteRaw, selectedRepo);
          if (res.data.success) {
            successCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          failedCount++;
        }
      }
      
      let msg = `删除完成！成功: ${successCount}`;
      if (failedCount > 0) msg += `, 失败: ${failedCount}`;
      if (batchSyncDeleteRaw) msg += '（已同步删除RAW）';
      
      message.success(msg);
      setBatchDeleteModalVisible(false);
      setSelectedPhotos([]);
      setSelectAll(false);
      fetchPhotos();
    } catch (error) {
      message.error('批量删除失败');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)' }}>
      {/* 顶部控制栏 */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <Space>
          <FilterOutlined />
          <Select
            value={selectedRepo}
            onChange={setSelectedRepo}
            style={{ width: 180 }}
            placeholder="选择仓库"
          >
            {repos.map(repo => (
              <Option key={repo.id} value={repo.id}>
                <Space>
                  <DatabaseOutlined />
                  {repo.name}
                  {repo.isDefault && <Tag color="blue" size="small">默认</Tag>}
                </Space>
              </Option>
            ))}
          </Select>
          <Select
            value={category}
            onChange={setCategory}
            style={{ width: 120 }}
          >
            <Option value="jpg">JPG 照片</Option>
            <Option value="raw">RAW 底片</Option>
            <Option value="video">视频文件</Option>
          </Select>
          
          <Select
            value={sortBy}
            onChange={setSortBy}
            style={{ width: 120 }}
          >
            <Option value="modifiedTime">修改时间</Option>
            <Option value="name">文件名</Option>
            <Option value="size">文件大小</Option>
          </Select>
          
          <Select
            value={sortOrder}
            onChange={setSortOrder}
            style={{ width: 100 }}
          >
            <Option value="desc">降序</Option>
            <Option value="asc">升序</Option>
          </Select>
        </Space>

        <Space>
          <span style={{ color: '#666' }}>共 {pagination.total} 张</span>
          {selectedPhotos.length > 0 && (
            <Tag color="blue" style={{ fontSize: 14, padding: '4px 8px' }}>
              已选中 {selectedPhotos.length} 张
            </Tag>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchPhotos}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* 批量操作栏 */}
      {photos.length > 0 && (
        <div style={{ flexShrink: 0, marginBottom: 12, padding: '8px 16px', background: '#f5f5f5', borderRadius: 4 }}>
          <Space>
            <Checkbox checked={selectAll} onChange={handleSelectAll}>
              全选
            </Checkbox>
            <Button 
              type="primary" 
              icon={<DownloadOutlined />}
              onClick={handleBatchExport}
              disabled={selectedPhotos.length === 0}
            >
              导出选中 ({selectedPhotos.length})
            </Button>
            <Button 
              danger
              icon={<DeleteOutlined />}
              onClick={handleBatchDelete}
              disabled={selectedPhotos.length === 0}
            >
              删除选中 ({selectedPhotos.length})
            </Button>
            <Button 
              icon={<CloseOutlined />}
              onClick={() => {
                setSelectedPhotos([]);
                setSelectAll(false);
              }}
              disabled={selectedPhotos.length === 0}
            >
              取消选择
            </Button>
          </Space>
        </div>
      )}

      {/* 照片展示区域 - 可滚动 */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 100 }}>
            <Spin size="large" />
          </div>
        ) : photos.length === 0 ? (
          <Empty description="暂无照片" style={{ padding: 100 }} />
        ) : (
          <>
              <Row gutter={[12, 12]} style={{ margin: 0 }}>
                {photos.map(photo => (
                  <Col xs={12} sm={8} md={6} lg={4} xl={3} xxl={2} key={photo.id} style={{ minWidth: 0 }}>
                    <Card
                      hoverable
                      className="photo-card"
                      cover={
                        <div style={{ position: 'relative' }}>
                          {/* 复选框 */}
                          <div style={{ 
                            position: 'absolute', 
                            top: 8, 
                            left: 8, 
                            zIndex: 10,
                            background: 'rgba(255, 255, 255, 0.9)',
                            borderRadius: 4,
                            padding: 2
                          }}>
                            <Checkbox
                              checked={selectedPhotos.includes(photo.id)}
                              onChange={(e) => handleSelectPhoto(photo.id, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          
                          {category === 'video' ? (
                            <div 
                              style={{ 
                                height: 120, 
                                background: '#000',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                position: 'relative'
                              }}
                              onClick={() => handlePreview(photo)}
                            >
                              <img
                                src={photo.thumbnailUrl}
                                alt={photo.name}
                                style={{ 
                                  width: '100%', 
                                  height: '100%', 
                                  objectFit: 'cover' 
                                }}
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'flex';
                                }}
                              />
                              <div style={{
                                display: 'none',
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                background: '#333',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexDirection: 'column'
                              }}>
                                <span style={{ fontSize: 48 }}>🎬</span>
                                <span style={{ color: '#fff', marginTop: 8, fontSize: 12 }}>视频文件</span>
                              </div>
                              <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                fontSize: 48,
                                color: '#fff',
                                textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                                pointerEvents: 'none'
                              }}>
                                ▶️
                              </div>
                            </div>
                          ) : (
                            category === 'raw' ? (
                              <div 
                                style={{ 
                                  height: 120, 
                                  background: '#f0f0f0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer'
                                }}
                                onClick={() => handlePreview(photo)}
                              >
                                <Image
                                  alt={photo.name}
                                  src={photo.thumbnailUrl}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  fallback="/placeholder-raw.svg"
                                  preview={false}
                                  placeholder={
                                    <div style={{ 
                                      height: 120, 
                                      background: '#f0f0f0',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}>
                                      <Spin size="small" />
                                    </div>
                                  }
                                />
                              </div>
                            ) : (
                              <div
                                style={{ cursor: 'pointer' }}
                                onClick={() => handlePreview({ ...photo, _page: pagination.page })}
                              >
                                <Image
                                  alt={photo.name}
                                  src={photo.thumbnailUrl}
                                  style={{ height: 120, objectFit: 'cover' }}
                                  fallback="/placeholder-raw.svg"
                                  preview={false}
                                  placeholder={
                                    <div style={{ 
                                      height: 120, 
                                      background: '#f0f0f0',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}>
                                      <Spin size="small" />
                                    </div>
                                  }
                                />
                              </div>
                            )
                          )}
                        </div>
                      }
                      actions={[
                        <Tooltip title="打开位置" key="location">
                          <Dropdown menu={getLocationMenu(photo)} trigger={['click']}>
                            <FolderOpenOutlined onClick={(e) => e.stopPropagation()} />
                          </Dropdown>
                        </Tooltip>,
                        category !== 'raw' && (
                          <Tooltip title="预览" key="preview">
                            <EyeOutlined onClick={() => handlePreview(photo)} />
                          </Tooltip>
                        ),
                        <Tooltip title="删除" key="delete">
                          <DeleteOutlined onClick={() => handleDelete(photo)} style={{ color: '#ff4d4f' }} />
                        </Tooltip>
                      ].filter(Boolean)}
                    >
                      <Card.Meta
                        title={
                          <Tooltip title={photo.name}>
                            <div style={{ 
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: 12
                            }}>
                              {photo.name}
                            </div>
                          </Tooltip>
                        }
                        description={
                          <div style={{ fontSize: 11, color: '#999' }}>
                            <div>{formatFileSize(photo.size)}</div>
                            <div>{formatDate(photo.modifiedTime)}</div>
                          </div>
                        }
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
          </>
        )}
      </div>

      {/* 底部分页 - 固定 */}
      {photos.length > 0 && (
        <div style={{ flexShrink: 0, marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            current={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onChange={handlePageChange}
            showSizeChanger
            showQuickJumper
            pageSizeOptions={['36', '72', '108', '144']}
            size="small"
          />
        </div>
      )}
      </div>

      {/* 导出对话框 */}
      <Modal
        title="批量导出照片"
        open={exportModalVisible}
        onCancel={() => {
          setExportModalVisible(false);
          setExportPath('');
        }}
        onOk={handleConfirmExport}
        okText="导出"
        cancelText="取消"
        confirmLoading={exporting}
        width={600}
      >
        <div style={{ marginTop: 16 }}>
          <Alert
            message={`将导出 ${selectedPhotos.length} 张照片`}
            description="文件将以增量模式复制，已存在的文件将被跳过"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
                
          <div style={{ marginBottom: 8, fontWeight: 500 }}>目标路径</div>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="例如：/Users/colorh/Pictures/导出"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              icon={<FolderAddOutlined />}
              onClick={handleExportFolderSelect}
              loading={exportPathSelecting}
            >
              选择文件夹
            </Button>
          </Space.Compact>
          <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
            点击"选择文件夹"按钮打开系统对话框，自动获取完整路径
          </div>
        </div>
      </Modal>

      {/* 单个删除确认对话框 */}
      <Modal
        title="确认删除"
        open={deleteModalVisible}
        onOk={confirmDelete}
        onCancel={() => { setDeleteModalVisible(false); setDeleteFromPreview(false); }}
        okText="删除"
        okType="danger"
        cancelText="取消"
        zIndex={3000}
      >
        {deletePhotoData && (
          <div>
            <p>确定要删除照片 <strong>{deletePhotoData.name}</strong> 吗？</p>
            {category === 'jpg' && (
              <Checkbox 
                checked={syncDeleteRaw} 
                onChange={(e) => setSyncDeleteRaw(e.target.checked)}
                style={{ marginTop: 8 }}
              >
                同时删除对应的RAW底片
              </Checkbox>
            )}
          </div>
        )}
      </Modal>

      {/* 批量删除确认对话框 */}
      <Modal
        title="批量删除确认"
        open={batchDeleteModalVisible}
        onOk={confirmBatchDelete}
        onCancel={() => setBatchDeleteModalVisible(false)}
        okText="删除"
        okType="danger"
        cancelText="取消"
      >
        <div>
          <p>确定要删除选中的 <strong>{selectedPhotos.length}</strong> 张照片吗？</p>
          {category === 'jpg' && (
            <Checkbox 
              checked={batchSyncDeleteRaw} 
              onChange={(e) => setBatchSyncDeleteRaw(e.target.checked)}
              style={{ marginTop: 8 }}
            >
              同时删除对应的RAW底片
            </Checkbox>
          )}
          {batchSyncDeleteRaw && (
            <Alert
              message="警告"
              description="此操作将同时删除JPG和对应的RAW文件，且不可恢复！"
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
            />
          )}
        </div>
      </Modal>

      <PhotoSlider
        images={cachedPhotos.map(photo => ({
          key: photo.id,
          src: photo.url,
        }))}
        index={previewIndex}
        visible={previewVisible}
        onIndexChange={handlePreviewIndexChange}
        onClose={() => setPreviewVisible(false)}
        maskOpacity={0.5}
        bannerVisible={true}
        toolbarRender={({ rotate, onRotate, onScale, scale }) => {
          return (
            <>
              <Button
                type="text"
                icon={<span style={{ fontSize: 20 }}>↺</span>}
                onClick={() => onRotate(rotate - 90)}
                style={{ color: '#fff' }}
              />
              <Button
                type="text"
                icon={<span style={{ fontSize: 20 }}>↻</span>}
                onClick={() => onRotate(rotate + 90)}
                style={{ color: '#fff' }}
              />
              <Button
                type="text"
                icon={<span style={{ fontSize: 20 }}>+</span>}
                onClick={() => onScale(scale + 0.5)}
                style={{ color: '#fff' }}
              />
              <Button
                type="text"
                icon={<span style={{ fontSize: 20 }}>-</span>}
                onClick={() => onScale(scale - 0.5)}
                style={{ color: '#fff' }}
              />
              <Button
                type="text"
                icon={<DeleteOutlined style={{ fontSize: 20 }} />}
                onClick={handlePreviewDelete}
                style={{ color: '#fff', marginLeft: 8 }}
              />
            </>
          );
        }}
      />
    </>
  );
};

export default PhotoGallery;
