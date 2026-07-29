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
  notification,
  Tooltip,
  Tag,
  Checkbox,
  Dropdown,
  Input,
  Alert,
  Switch,
  InputNumber,
  DatePicker,
  Descriptions
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
  FolderAddOutlined,
  InfoCircleOutlined,
  CameraOutlined,
  DownOutlined,
  LoadingOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import { PhotoSlider } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { photoApi, importApi } from '../api';
import { useRepo } from '../contexts/RepoContext';

const { Option } = Select;

const PhotoGallery = () => {
  const [modal, modalContextHolder] = Modal.useModal();
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
  const { setCurrentRepoId, bumpStorageVersion } = useRepo();

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

  // Task 8：高级筛选相关状态
  const [advancedFilter, setAdvancedFilter] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ cameraModels: [], lensModels: [] });
  // filterState 保存用户输入但尚未应用的筛选值
  const [filterState, setFilterState] = useState({
    dateRange: null,
    cameraModel: undefined,
    lensModel: undefined,
    focalMin: undefined,
    focalMax: undefined,
    fNumberMin: undefined,
    fNumberMax: undefined,
    isoMin: undefined,
    isoMax: undefined,
    fileName: ''
  });
  // appliedFilter 保存已应用到查询的筛选值（用于标签展示和实际请求）
  const [appliedFilter, setAppliedFilter] = useState(null);

  // Task 9：EXIF 展示相关状态
  const [exifModalVisible, setExifModalVisible] = useState(false);
  const [exifData, setExifData] = useState(null);
  const [exifLoading, setExifLoading] = useState(false);

  // 批量刷新 EXIF 状态
  const [refreshingExif, setRefreshingExif] = useState(false);

  // 重建清单状态
  const [rebuildingManifest, setRebuildingManifest] = useState(false);

  // 完整性校验状态
  const [verifyingIntegrity, setVerifyingIntegrity] = useState(false);

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

  // Task 8.3：获取高级筛选项（相机/镜头列表）
  const fetchFilterOptions = useCallback(async () => {
    if (!selectedRepo) return;
    try {
      const res = await photoApi.getFilterOptions(selectedRepo, category);
      if (res.data.success) {
        setFilterOptions(res.data.data || { cameraModels: [], lensModels: [] });
      }
    } catch (error) {
      console.error('获取筛选项失败:', error);
    }
  }, [selectedRepo, category]);

  // Task 8.4：从 filterState 构造后端筛选参数
  const buildFilterParams = (filter) => {
    if (!filter) return {};
    const params = {};
    if (filter.dateRange && filter.dateRange.length === 2) {
      const [from, to] = filter.dateRange;
      if (from) params.dateFrom = from.toISOString();
      if (to) params.dateTo = to.toISOString();
    }
    if (filter.cameraModel) params.cameraModel = filter.cameraModel;
    if (filter.lensModel) params.lensModel = filter.lensModel;
    if (filter.focalMin != null) params.focalMin = filter.focalMin;
    if (filter.focalMax != null) params.focalMax = filter.focalMax;
    if (filter.fNumberMin != null) params.fNumberMin = filter.fNumberMin;
    if (filter.fNumberMax != null) params.fNumberMax = filter.fNumberMax;
    if (filter.isoMin != null) params.isoMin = filter.isoMin;
    if (filter.isoMax != null) params.isoMax = filter.isoMax;
    if (filter.fileName && filter.fileName.trim()) params.fileName = filter.fileName.trim();
    return params;
  };

  // Task 8.5：计算当前生效的筛选条件（用于标签展示）
  const activeFilterTags = (() => {
    if (!appliedFilter) return [];
    const tags = [];
    if (appliedFilter.cameraModel) {
      tags.push({ key: 'cameraModel', label: `相机: ${appliedFilter.cameraModel}` });
    }
    if (appliedFilter.lensModel) {
      tags.push({ key: 'lensModel', label: `镜头: ${appliedFilter.lensModel}` });
    }
    if (appliedFilter.dateRange && appliedFilter.dateRange.length === 2) {
      const [from, to] = appliedFilter.dateRange;
      tags.push({
        key: 'dateRange',
        label: `日期: ${from.format('YYYY-MM-DD')} ~ ${to.format('YYYY-MM-DD')}`
      });
    }
    const focalMin = appliedFilter.focalMin;
    const focalMax = appliedFilter.focalMax;
    if (focalMin != null || focalMax != null) {
      tags.push({
        key: 'focal',
        label: `焦距: ${focalMin ?? ''}-${focalMax ?? ''}mm`
      });
    }
    const fNumberMin = appliedFilter.fNumberMin;
    const fNumberMax = appliedFilter.fNumberMax;
    if (fNumberMin != null || fNumberMax != null) {
      tags.push({
        key: 'fNumber',
        label: `光圈: f/${fNumberMin ?? ''}-${fNumberMax ?? ''}`
      });
    }
    const isoMin = appliedFilter.isoMin;
    const isoMax = appliedFilter.isoMax;
    if (isoMin != null || isoMax != null) {
      tags.push({
        key: 'iso',
        label: `ISO: ${isoMin ?? ''}-${isoMax ?? ''}`
      });
    }
    if (appliedFilter.fileName && appliedFilter.fileName.trim()) {
      tags.push({ key: 'fileName', label: `文件名: ${appliedFilter.fileName.trim()}` });
    }
    return tags;
  })();

  const fetchPhotos = useCallback(async () => {
    if (!selectedRepo) return;

    setLoading(true);
    try {
      // Task 8.4：当 advancedFilter 开启且有 appliedFilter 时，追加筛选参数
      const advancedParams = (advancedFilter && appliedFilter) ? buildFilterParams(appliedFilter) : {};
      const res = await photoApi.getPhotos(category, {
        page: pagination.page,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
        repoId: selectedRepo,
        ...advancedParams
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
  }, [category, pagination.page, pagination.pageSize, sortBy, sortOrder, selectedRepo, advancedFilter, appliedFilter]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => {
    setCachedPhotos([]);
    cachedPagesRef.current = { min: 0, max: 0 };
  }, [category, sortBy, sortOrder, selectedRepo, advancedFilter, appliedFilter]);

  // Task 8.3：高级筛选开启或仓库/分类变化时加载相机/镜头选项
  useEffect(() => {
    if (advancedFilter) {
      fetchFilterOptions();
    }
  }, [advancedFilter, fetchFilterOptions]);

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
        // 从选中列表中移除已删除的照片
        setSelectedPhotos(prev => prev.filter(id => id !== deletePhotoData.id));
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
        // 删除后刷新存储统计
        bumpStorageVersion();
      }
    } catch (error) {
      message.error('删除失败');
      console.error(error);
    }
  };

  const fetchPagePhotos = useCallback(async (page) => {
    if (!selectedRepo) return [];
    try {
      // Task 8.4：跨页预览缓存也需要应用高级筛选参数，保持与主页一致
      const advancedParams = (advancedFilter && appliedFilter) ? buildFilterParams(appliedFilter) : {};
      const res = await photoApi.getPhotos(category, {
        page,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
        repoId: selectedRepo,
        ...advancedParams
      });
      if (res.data.success) {
        return (res.data.data.photos || []).map(photo => ({ ...photo, _page: page }));
      }
    } catch (error) {
      console.error(`获取第${page}页照片失败:`, error);
    }
    return [];
  }, [category, pagination.pageSize, sortBy, sortOrder, selectedRepo, advancedFilter, appliedFilter]);

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
      handleOpenLocation(photo, 'file');
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
      // 批量删除后刷新存储统计
      bumpStorageVersion();
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

  // Task 8.4：应用高级筛选
  const handleApplyFilter = () => {
    // 重置到第一页并应用筛选
    setPagination(prev => ({ ...prev, page: 1 }));
    setAppliedFilter({ ...filterState });
    setSelectedPhotos([]);
    setSelectAll(false);
  };

  // Task 8.4：重置高级筛选
  const handleResetFilter = () => {
    const empty = {
      dateRange: null,
      cameraModel: undefined,
      lensModel: undefined,
      focalMin: undefined,
      focalMax: undefined,
      fNumberMin: undefined,
      fNumberMax: undefined,
      isoMin: undefined,
      isoMax: undefined,
      fileName: ''
    };
    setFilterState(empty);
    setAppliedFilter(null);
    setPagination(prev => ({ ...prev, page: 1 }));
    setSelectedPhotos([]);
    setSelectAll(false);
  };

  // Task 8.5：移除单个筛选条件
  const handleRemoveFilterTag = (key) => {
    if (!appliedFilter) return;
    const next = { ...appliedFilter };
    if (key === 'dateRange') next.dateRange = null;
    else if (key === 'cameraModel') next.cameraModel = undefined;
    else if (key === 'lensModel') next.lensModel = undefined;
    else if (key === 'focal') { next.focalMin = undefined; next.focalMax = undefined; }
    else if (key === 'fNumber') { next.fNumberMin = undefined; next.fNumberMax = undefined; }
    else if (key === 'iso') { next.isoMin = undefined; next.isoMax = undefined; }
    else if (key === 'fileName') next.fileName = '';
    // 同步到 filterState（避免下次应用时又带回去）
    setFilterState(prev => ({ ...prev, ...next }));
    // 判断是否全部清空
    const isEmpty = !next.dateRange && !next.cameraModel && !next.lensModel &&
      next.focalMin == null && next.focalMax == null &&
      next.fNumberMin == null && next.fNumberMax == null &&
      next.isoMin == null && next.isoMax == null &&
      !next.fileName;
    setAppliedFilter(isEmpty ? null : next);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // 批量刷新 EXIF：为旧版导入缺失 EXIF 的照片补录
  const handleRefreshExif = async () => {
    if (!selectedRepo) return;
    setRefreshingExif(true);
    try {
      const res = await photoApi.refreshExif(selectedRepo, category);
      if (res.data.success) {
        const { success, failed, alreadyHasExif, noExifFound, sampleExif, firstError } = res.data.data;
        console.log('[refreshExif] 返回结果:', res.data.data);

        const total = alreadyHasExif + noExifFound + success + failed;
        let description;
        let icon = 'info';

        if (success > 0) {
          const sample = sampleExif
            ? `${sampleExif.model || sampleExif.make || '未知相机'} · ${sampleExif.focalLength != null && !isNaN(sampleExif.focalLength) ? sampleExif.focalLength + 'mm' : '-'} · f/${sampleExif.fNumber != null && !isNaN(sampleExif.fNumber) ? sampleExif.fNumber : '-'} · ISO${sampleExif.iso != null && !isNaN(sampleExif.iso) ? sampleExif.iso : '-'}`
            : null;
          description = (
            <div>
              <div>成功补录 {success} / {total} 张照片的 EXIF</div>
              {sample && <div style={{ marginTop: 4, opacity: 0.75 }}>样例：{sample}</div>}
            </div>
          );
          icon = 'success';
        } else if (alreadyHasExif === total) {
          description = <div>当前 {total} 张照片已包含 EXIF 信息，无需补录</div>;
        } else if (noExifFound > 0 && failed === 0) {
          description = <div>共扫描 {total} 张照片，未能从中读取到相机元数据</div>;
        } else if (failed > 0) {
          description = (
            <div>
              <div>补录失败 {failed} 张</div>
              {firstError && <div style={{ marginTop: 4, opacity: 0.75 }}>{firstError}</div>}
            </div>
          );
          icon = 'error';
        } else {
          description = <div>本次没有需要补录的照片</div>;
        }

        notification[icon]({
          message: 'EXIF 补录完成',
          description,
          placement: 'topRight',
          duration: 5
        });

        fetchPhotos();
      }
    } catch (error) {
      notification.error({
        message: 'EXIF 补录失败',
        description: error.response?.data?.error || error.message,
        placement: 'topRight'
      });
      console.error(error);
    } finally {
      setRefreshingExif(false);
    }
  };

  // 重建清单：删除旧清单→重新扫描→读取 EXIF
  const handleRebuildManifest = async () => {
    if (!selectedRepo) return;
    modal.confirm({
      title: '重建清单',
      content: '将删除当前仓库的清单文件并重新扫描所有文件、读取 EXIF。此操作可能需要一些时间，完成后照片预览和 EXIF 信息将恢复正常。是否继续？',
      okText: '确认重建',
      cancelText: '取消',
      onOk: async () => {
        setRebuildingManifest(true);
        try {
          const res = await photoApi.rebuildManifest(selectedRepo);
          if (res.data.success) {
            const { totalFiles, exifSuccess, exifFailed } = res.data.data;
            notification.success({
              message: '清单重建完成',
              description: `共扫描 ${totalFiles} 个文件，EXIF 读取成功 ${exifSuccess} 个，失败 ${exifFailed} 个`,
              placement: 'topRight',
              duration: 5
            });
            fetchPhotos();
            // 重建清单后刷新存储统计
            bumpStorageVersion();
          }
        } catch (error) {
          notification.error({
            message: '重建清单失败',
            description: error.response?.data?.error || error.message,
            placement: 'topRight'
          });
          console.error(error);
        } finally {
          setRebuildingManifest(false);
        }
      }
    });
  };

  // 完整性校验：检查清单与文件系统一致性，可选自动清理缺失条目（清理历史脏数据/空占位）
  const handleVerifyIntegrity = async () => {
    if (!selectedRepo) return;
    setVerifyingIntegrity(true);
    let report;
    try {
      const res = await photoApi.verifyIntegrity(selectedRepo, false);
      if (!res.data.success) {
        notification.error({ message: '完整性校验失败', description: res.data.error, placement: 'topRight' });
        return;
      }
      report = res.data.data;
    } catch (error) {
      notification.error({
        message: '完整性校验失败',
        description: error.response?.data?.error || error.message,
        placement: 'topRight'
      });
      return;
    } finally {
      setVerifyingIntegrity(false);
    }

    const { missing = [], corrupted = [], untracked = [] } = report;
    const summary = `缺失 ${missing.length} 个、损坏 ${corrupted.length} 个、未追踪 ${untracked.length} 个`;

    if (missing.length === 0 && corrupted.length === 0 && untracked.length === 0) {
      notification.success({
        message: '完整性校验通过',
        description: '清单与文件系统一致，未发现异常。',
        placement: 'topRight'
      });
      return;
    }

    if (missing.length > 0) {
      modal.confirm({
        title: '完整性校验结果',
        content: `发现 ${summary}。是否自动从清单移除 ${missing.length} 个缺失条目（清理空占位）？`,
        okText: '自动清理缺失条目',
        cancelText: '仅查看',
        onOk: async () => {
          setVerifyingIntegrity(true);
          try {
            const cleanRes = await photoApi.verifyIntegrity(selectedRepo, true);
            if (cleanRes.data.success) {
              const cleaned = cleanRes.data.data.cleaned || 0;
              notification.success({
                message: '清理完成',
                description: `已从清单移除 ${cleaned} 个缺失条目。`,
                placement: 'topRight'
              });
              fetchPhotos();
              // 清理缺失条目后刷新存储统计
              bumpStorageVersion();
            }
          } catch (error) {
            notification.error({
              message: '清理失败',
              description: error.response?.data?.error || error.message,
              placement: 'topRight'
            });
          } finally {
            setVerifyingIntegrity(false);
          }
        }
      });
    } else {
      modal.info({
        title: '完整性校验结果',
        content: `发现 ${summary}，无缺失条目需清理。`
      });
    }
  };

  // Task 9.2：打开 EXIF 面板
  const handleOpenExif = async () => {
    const currentPhoto = cachedPhotos[previewIndex];
    if (!currentPhoto) return;
    // 优先用列表已携带的精简 EXIF
    setExifData(currentPhoto.exif ? { ...currentPhoto.exif, _full: false } : null);
    setExifModalVisible(true);
  };

  // Task 9.3：加载完整 EXIF
  const handleLoadFullExif = async () => {
    const currentPhoto = cachedPhotos[previewIndex];
    if (!currentPhoto) return;
    setExifLoading(true);
    try {
      const res = await photoApi.getFullExif(currentPhoto.id);
      if (res.data.success) {
        // 完整 EXIF 是 tags 对象，合并展示
        setExifData(prev => ({ ...(prev || {}), ...res.data.data, _full: true }));
      }
    } catch (error) {
      message.error('获取完整 EXIF 失败');
      console.error(error);
    } finally {
      setExifLoading(false);
    }
  };

  // Task 9.3：格式化 EXIF 显示值
  const formatExifValue = (val) => {
    if (val == null || val === '') return '-';
    return val;
  };

  const formatExifDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr);
      return d.toLocaleString('zh-CN');
    } catch (e) {
      return String(dateStr);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)' }}>
      {/* 顶部控制栏 */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <Space wrap>
          <FilterOutlined />
          <Select
            value={selectedRepo}
            onChange={(val) => { setSelectedRepo(val); setSelectedPhotos([]); setSelectAll(false); }}
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
            onChange={(val) => { setCategory(val); setSelectedPhotos([]); setSelectAll(false); }}
            style={{ width: 120 }}
          >
            <Option value="jpg">JPG 照片</Option>
            <Option value="raw">RAW 底片</Option>
            <Option value="video">视频文件</Option>
          </Select>

          <Select
            value={sortBy}
            onChange={(val) => { setSortBy(val); setSelectedPhotos([]); setSelectAll(false); }}
            style={{ width: 120 }}
          >
            <Option value="modifiedTime">修改时间</Option>
            <Option value="name">文件名</Option>
            <Option value="size">文件大小</Option>
          </Select>

          <Select
            value={sortOrder}
            onChange={(val) => { setSortOrder(val); setSelectedPhotos([]); setSelectAll(false); }}
            style={{ width: 100 }}
          >
            <Option value="desc">降序</Option>
            <Option value="asc">升序</Option>
          </Select>

          {/* Task 8.1：高级筛选开关 */}
          <Space size={6}>
            <Switch
              checked={advancedFilter}
              onChange={(checked) => {
                setAdvancedFilter(checked);
                // 关闭高级筛选时清空已应用条件，确保恢复全量
                if (!checked) {
                  setAppliedFilter(null);
                  setPagination(prev => ({ ...prev, page: 1 }));
                }
              }}
              size="small"
            />
            <span style={{ fontSize: 13, color: 'var(--text)' }}>高级筛选</span>
          </Space>
        </Space>

        <Space wrap style={{ marginTop: 12 }}>
          <span style={{ color: 'var(--muted)' }}>共 {pagination.total} 张</span>
          {selectedPhotos.length > 0 && (
            <Tag color="blue" style={{ fontSize: 14, padding: '4px 8px' }}>
              已选中 {selectedPhotos.length} 张
            </Tag>
          )}
          {/* Task 8.5：当前生效的高级筛选条件标签 */}
          {activeFilterTags.map(tag => (
            <Tag
              key={tag.key}
              color="geekblue"
              closable
              onClose={(e) => { e.preventDefault(); handleRemoveFilterTag(tag.key); }}
              style={{ fontSize: 12 }}
            >
              {tag.label}
            </Tag>
          ))}
          <Space.Compact>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => {
                setSelectedPhotos([]);
                setSelectAll(false);
                fetchPhotos();
              }}
            >
              刷新
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'exif',
                    icon: refreshingExif ? <LoadingOutlined /> : <CameraOutlined />,
                    label: '刷新 EXIF',
                    disabled: refreshingExif || rebuildingManifest || verifyingIntegrity
                  },
                  {
                    key: 'integrity',
                    icon: verifyingIntegrity ? <LoadingOutlined /> : <SafetyCertificateOutlined />,
                    label: '完整性校验',
                    disabled: refreshingExif || rebuildingManifest || verifyingIntegrity
                  },
                  {
                    key: 'manifest',
                    icon: rebuildingManifest ? <LoadingOutlined /> : <DatabaseOutlined />,
                    label: '重建清单',
                    disabled: refreshingExif || rebuildingManifest || verifyingIntegrity,
                    danger: true
                  }
                ],
                onClick: ({ key }) => {
                  if (key === 'exif') handleRefreshExif();
                  if (key === 'integrity') handleVerifyIntegrity();
                  if (key === 'manifest') handleRebuildManifest();
                }
              }}
              placement="bottomRight"
            >
              <Button icon={<DownOutlined />} />
            </Dropdown>
          </Space.Compact>
        </Space>
      </div>

      {/* Task 8.2：高级筛选表单 */}
      {advancedFilter && (
        <Card size="small" style={{ flexShrink: 0, marginBottom: 24 }}>
          <Row gutter={[16, 12]} align="bottom">
            <Col xs={24} sm={12} md={8} lg={6} xl={5}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>拍摄日期</div>
              <DatePicker.RangePicker
                value={filterState.dateRange}
                onChange={(dates) => setFilterState(prev => ({ ...prev, dateRange: dates }))}
                size="small"
                style={{ width: '100%' }}
                placeholder={['开始日期', '结束日期']}
              />
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={5}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>相机型号</div>
              <Select
                value={filterState.cameraModel}
                onChange={(val) => setFilterState(prev => ({ ...prev, cameraModel: val }))}
                allowClear
                placeholder="选择相机"
                size="small"
                style={{ width: '100%' }}
              >
                {filterOptions.cameraModels.map(m => (
                  <Option key={m} value={m}>{m}</Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={5}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>镜头型号</div>
              <Select
                value={filterState.lensModel}
                onChange={(val) => setFilterState(prev => ({ ...prev, lensModel: val }))}
                allowClear
                placeholder="选择镜头"
                size="small"
                style={{ width: '100%' }}
              >
                {filterOptions.lensModels.map(m => (
                  <Option key={m} value={m}>{m}</Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={4}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>焦距 (mm)</div>
              <Space.Compact style={{ width: '100%' }}>
                <InputNumber
                  value={filterState.focalMin}
                  onChange={(val) => setFilterState(prev => ({ ...prev, focalMin: val }))}
                  placeholder="最小"
                  size="small"
                  style={{ width: '50%' }}
                  min={0}
                />
                <InputNumber
                  value={filterState.focalMax}
                  onChange={(val) => setFilterState(prev => ({ ...prev, focalMax: val }))}
                  placeholder="最大"
                  size="small"
                  style={{ width: '50%' }}
                  min={0}
                />
              </Space.Compact>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={4}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>光圈</div>
              <Space.Compact style={{ width: '100%' }}>
                <InputNumber
                  value={filterState.fNumberMin}
                  onChange={(val) => setFilterState(prev => ({ ...prev, fNumberMin: val }))}
                  placeholder="最小"
                  size="small"
                  step={0.1}
                  style={{ width: '50%' }}
                  min={0}
                />
                <InputNumber
                  value={filterState.fNumberMax}
                  onChange={(val) => setFilterState(prev => ({ ...prev, fNumberMax: val }))}
                  placeholder="最大"
                  size="small"
                  step={0.1}
                  style={{ width: '50%' }}
                  min={0}
                />
              </Space.Compact>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={4}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>ISO</div>
              <Space.Compact style={{ width: '100%' }}>
                <InputNumber
                  value={filterState.isoMin}
                  onChange={(val) => setFilterState(prev => ({ ...prev, isoMin: val }))}
                  placeholder="最小"
                  size="small"
                  style={{ width: '50%' }}
                  min={0}
                />
                <InputNumber
                  value={filterState.isoMax}
                  onChange={(val) => setFilterState(prev => ({ ...prev, isoMax: val }))}
                  placeholder="最大"
                  size="small"
                  style={{ width: '50%' }}
                  min={0}
                />
              </Space.Compact>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={4}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>文件名</div>
              <Input
                value={filterState.fileName}
                onChange={(e) => setFilterState(prev => ({ ...prev, fileName: e.target.value }))}
                placeholder="搜索文件名"
                size="small"
                style={{ width: '100%' }}
                allowClear
              />
            </Col>
            <Col xs={24} sm={12} md={8} lg={6} xl={3}>
              <Space style={{ width: '100%' }}>
                <Button type="primary" size="small" onClick={handleApplyFilter} style={{ flex: 1 }}>应用筛选</Button>
                <Button size="small" onClick={handleResetFilter} style={{ flex: 1 }}>重置</Button>
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {/* 批量操作栏 */}
      {photos.length > 0 && (
        <div style={{ flexShrink: 0, marginBottom: 12, padding: '8px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
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
                            top: 0, 
                            left: 0, 
                            zIndex: 10,
                            padding: 4
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
                                background: '#0a0908',
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
                                background: 'var(--border)',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexDirection: 'column'
                              }}>
                                <span style={{ fontSize: 48 }}>🎬</span>
                                <span style={{ color: 'var(--text)', marginTop: 8, fontSize: 12 }}>视频文件</span>
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
                                  background: 'var(--bg-elevated)',
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
                                      background: 'var(--bg-elevated)',
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
                                style={{ cursor: 'pointer', height: 120, overflow: 'hidden' }}
                                onClick={() => handlePreview({ ...photo, _page: pagination.page })}
                              >
                                <Image
                                  alt={photo.name}
                                  src={photo.thumbnailUrl}
                                  style={{ width: '100%', height: 120, objectFit: 'cover' }}
                                  fallback="/placeholder-raw.svg"
                                  preview={false}
                                  placeholder={
                                    <div style={{ 
                                      height: 120, 
                                      background: 'var(--bg-elevated)',
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
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            <div>{formatFileSize(photo.size)}</div>
                            <div>{photo.exif?.dateTimeOriginal ? formatExifDate(photo.exif.dateTimeOriginal) : formatDate(photo.modifiedTime)}</div>
                            {(() => {
                              const exif = photo.exif;
                              if (!exif) return null;
                              const model = exif.model || exif.make;
                              const focal = exif.focalLength != null && !isNaN(exif.focalLength) ? exif.focalLength : null;
                              const fNum = exif.fNumber != null && !isNaN(exif.fNumber) ? exif.fNumber : null;
                              const iso = exif.iso != null && !isNaN(exif.iso) ? exif.iso : null;
                              if (!model && focal == null && fNum == null && iso == null) return null;
                              return (
                                <div style={{ marginTop: 2, fontSize: 10 }}>
                                  {model && `[${model}] `}
                                  {focal != null && `${focal}mm `}
                                  {fNum != null && `f/${fNum} `}
                                  {iso != null && `ISO${iso}`}
                                </div>
                              );
                            })()}
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
        <div style={{ flexShrink: 0, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
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
          <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
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
              {/* Task 9.2：EXIF 信息按钮 */}
              <Tooltip title="EXIF 信息">
                <Button
                  type="text"
                  icon={<InfoCircleOutlined style={{ fontSize: 20 }} />}
                  onClick={handleOpenExif}
                  style={{ color: '#fff' }}
                />
              </Tooltip>
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

      {/* Task 9.3：EXIF 信息展示 Modal */}
      <Modal
        title="EXIF 信息"
        open={exifModalVisible}
        onCancel={() => { setExifModalVisible(false); setExifData(null); }}
        footer={[
          <Button
            key="full"
            type="primary"
            loading={exifLoading}
            onClick={handleLoadFullExif}
            disabled={!cachedPhotos[previewIndex] || (exifData && exifData._full)}
          >
            {(exifData && exifData._full) ? '已加载完整 EXIF' : '查看完整 EXIF'}
          </Button>,
          <Button key="close" onClick={() => { setExifModalVisible(false); setExifData(null); }}>
            关闭
          </Button>
        ]}
        width={600}
        zIndex={3000}
      >
        {exifData ? (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="相机">
                {[exifData.make, exifData.model].filter(Boolean).join(' ') || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="镜头">{formatExifValue(exifData.lensModel)}</Descriptions.Item>
              <Descriptions.Item label="焦距">{exifData.focalLength != null ? `${exifData.focalLength}mm` : '-'}</Descriptions.Item>
              <Descriptions.Item label="光圈">{exifData.fNumber != null ? `f/${exifData.fNumber}` : '-'}</Descriptions.Item>
              <Descriptions.Item label="快门">{formatExifValue(exifData.exposureTime)}</Descriptions.Item>
              <Descriptions.Item label="ISO">{formatExifValue(exifData.iso)}</Descriptions.Item>
              <Descriptions.Item label="拍摄时间">{formatExifDate(exifData.dateTimeOriginal)}</Descriptions.Item>
              <Descriptions.Item label="GPS">
                {(exifData.gpsLat != null && exifData.gpsLon != null)
                  ? `${exifData.gpsLat}, ${exifData.gpsLon}`
                  : '-'}
              </Descriptions.Item>
            </Descriptions>
            {exifData._full && exifData && Object.keys(exifData).length > 10 && (
              <Alert
                message="完整 EXIF 已加载"
                description="上方展示了精简字段，完整 EXIF tags 已合并到对象中（可在控制台查看 exifData）"
                type="info"
                showIcon
                style={{ marginTop: 12 }}
              />
            )}
          </>
        ) : (
          <Empty description="无 EXIF 信息" />
        )}
      </Modal>
      {modalContextHolder}
    </>
  );
};

export default PhotoGallery;
