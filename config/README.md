# 配置文件说明

本目录包含项目的个人配置文件，这些文件已被 Git 忽略，不会提交到版本控制系统。

## 配置文件列表

### 1. repos.json - 存储仓库配置
定义照片存储仓库的路径和设置。

**示例：**
```json
[
  {
    "id": "my-repo",
    "name": "我的照片库",
    "path": "/Users/username/Pictures/Photos",
    "isDefault": true
  }
]
```

### 2. .env - 环境变量配置
包含服务器端口、默认路径等环境相关配置。

**主要配置项：**
- `PORT`: 后端服务器端口（默认 3001）
- `PHOTO_BASE_PATH`: 默认照片存储路径
- `DEFAULT_IMPORT_PATH`: 存储卡默认导入路径

## 首次使用

1. 复制示例文件：
   ```bash
   cp repos.json.example repos.json
   cp .env.example .env
   ```

2. 编辑配置文件，填入你的实际路径和设置

3. 启动项目即可使用

## 注意事项

- 这些配置文件包含个人路径信息，已添加到 `.gitignore`
- 不同开发者可以有不同的配置，互不影响
- 如需分享配置，请使用 `.example` 文件作为模板
