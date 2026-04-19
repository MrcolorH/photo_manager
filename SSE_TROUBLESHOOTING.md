# SSE 连接中断问题排查指南

## 问题描述
导入时提示"连接中断"错误。

## 已修复的问题

### 1. CORS 配置
**问题**: SSE 连接需要特殊的 CORS 配置
**修复**: 在 `backend/src/app.js` 中更新了 CORS 配置

```javascript
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
```

### 2. 错误响应格式
**问题**: 验证错误时使用 `res.status(400).json()` 而不是 SSE 格式
**修复**: 所有错误响应都改为 SSE 格式

```javascript
res.write(`data: ${JSON.stringify({ type: 'error', error: '错误信息' })}\n\n`);
res.end();
```

### 3. EventSource URL
**问题**: 使用相对路径可能导致连接问题
**修复**: 使用完整的 URL

```javascript
const baseUrl = window.location.origin;
const url = `${baseUrl}/api/import?sourcePath=...`;
```

### 4. 错误处理优化
**问题**: EventSource 的 onerror 会在正常关闭时也触发
**修复**: 添加状态检查，避免误报

```javascript
eventSource.onerror = (error) => {
  // 如果已经收到完成或错误消息，忽略此错误
  if (hasError || completeData) {
    return;
  }
  
  // 检查 readyState
  if (eventSource.readyState === EventSource.CONNECTING) {
    // 正在重连，不要拒绝
    return;
  }
  
  // 真正的错误
  reject(new Error('连接中断'));
};
```

## 排查步骤

### 1. 检查后端日志

启动后端后，查看控制台输出：

```bash
cd backend
npm start
```

应该看到：
- "开始导入，源路径: ..."
- "目标仓库: ..."
- "发送进度: X%"（多次）
- "导入完成，结果: ..."

如果没有看到这些日志，说明请求没有到达后端。

### 2. 检查前端控制台

打开浏览器开发者工具（F12），查看 Console 标签：

应该看到：
- "开始 SSE 连接: http://localhost:3001/api/import?..."
- "SSE 连接已建立"
- "收到 SSE 消息: progress"（多次）
- "收到 SSE 消息: complete"
- "导入完成"

如果看到错误：
- "SSE 连接错误" - 检查网络连接
- "解析 SSE 数据失败" - 检查后端返回的数据格式

### 3. 检查 Network 标签

在开发者工具的 Network 标签中：
1. 过滤 "import"
2. 找到 `/api/import?...` 请求
3. 检查：
   - Status: 应该是 200
   - Type: 应该是 "eventsource" 或 "xhr"
   - Response 标签应该能看到实时数据

### 4. 测试后端接口

使用 curl 测试后端 SSE 接口：

```bash
curl -N "http://localhost:3001/api/import?sourcePath=/tmp/test&repoId=default"
```

应该看到类似这样的输出：
```
data: {"type":"progress","data":{"total":10,"processed":1,"remaining":9,...}}

data: {"type":"progress","data":{"total":10,"processed":2,"remaining":8,...}}

data: {"type":"complete","data":{"jpgCount":5,"rawCount":3,...}}
```

### 5. 检查文件路径

确保：
- 存储卡路径存在且可访问
- 路径中没有特殊字符（如果有，会被 encodeURIComponent 编码）
- 路径是绝对路径

测试路径是否存在：
```bash
ls -la /Volumes/YOUR_SD_CARD
```

### 6. 检查权限

确保 Node.js 进程有权限：
- 读取源路径（存储卡）
- 写入目标路径（仓库目录）

```bash
# 测试读取权限
cat /Volumes/YOUR_SD_CARD/test.jpg

# 测试写入权限
touch /Users/colorh/Pictures/相机照片/jpg/test.txt
rm /Users/colorh/Pictures/相机照片/jpg/test.txt
```

## 常见问题及解决方案

### 问题 1: CORS 错误
**症状**: 控制台显示 "Access to fetch at ... has been blocked by CORS policy"

**解决**: 
- 确认 `backend/src/app.js` 中的 CORS 配置正确
- 重启后端服务

### 问题 2: 连接立即关闭
**症状**: 看到 "SSE 连接已建立" 后立即 "SSE 连接已关闭"

**可能原因**:
- 后端抛出异常
- 源路径不存在
- 目标路径无权限

**解决**:
- 检查后端日志中的错误信息
- 验证路径是否正确

### 问题 3: 进度不更新
**症状**: 连接建立但没有进度消息

**可能原因**:
- 源路径为空或没有媒体文件
- scanDirectory 函数出错

**解决**:
- 检查源路径是否包含 JPG/RAW/视频文件
- 在后端日志中查看是否有错误

### 问题 4: 超时
**症状**: 5分钟后显示"导入超时（5分钟）"

**可能原因**:
- 文件太多或太大
- 网络速度慢
- 磁盘写入慢

**解决**:
- 减少一次导入的文件数量
- 检查磁盘空间
- 考虑增加超时时间（修改 `frontend/src/api/index.js` 中的 300000）

### 问题 5: EventSource 不支持
**症状**: "EventSource is not defined"

**解决**:
- 现代浏览器都支持 EventSource
- 如果使用旧浏览器，需要 polyfill
- 检查浏览器兼容性

## 调试技巧

### 1. 添加更多日志

在后端 `importRoutes.js` 中添加：

```javascript
console.log('请求参数:', req.query);
console.log('仓库列表:', repos);
console.log('目标仓库:', targetRepo);
```

在前端 `ImportPage.jsx` 中添加：

```javascript
console.log('开始导入，路径:', sourcePath, '仓库:', selectedRepo);
console.log('收到进度:', progress);
```

### 2. 测试小文件

先测试少量小文件（1-2个 JPG），确认基本功能正常，再测试大文件。

### 3. 使用 Postman 测试

Postman 不支持 SSE，但可以用它测试基本连接：
- Method: GET
- URL: `http://localhost:3001/api/import?sourcePath=/tmp/test&repoId=default`
- 查看响应头是否正确

### 4. 检查防火墙

确保端口 3001 没有被防火墙阻止：

```bash
# macOS
sudo lsof -i :3001

# 检查防火墙规则
sudo pfctl -s rules
```

## 恢复方案

如果 SSE 仍然有问题，可以回退到轮询方式：

1. 后端保持当前的进度回调机制
2. 前端改用定期查询进度的方式
3. 或者使用 WebSocket 代替 SSE

但这会降低效率，建议先排查 SSE 问题。

## 联系支持

如果以上步骤都无法解决问题，请提供：
1. 后端完整日志
2. 前端控制台完整输出
3. Network 标签中的请求详情
4. 操作系统和浏览器版本
