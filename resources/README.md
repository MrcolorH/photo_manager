# 资源目录

此目录用于存放打包时需要内嵌的外部工具。

## 需要手动放置的文件

### ffmpeg.exe
- 下载地址: https://www.gyan.dev/ffmpeg/builds/ (选择 ffmpeg-release-essentials.zip)
- 解压后将 `ffmpeg.exe` 复制到此目录
- 用于视频文件缩略图生成

### 注意
- 如果不放置 ffmpeg.exe，构建仍可完成，但视频缩略图功能将不可用
- 建议使用静态编译版本以避免额外依赖
