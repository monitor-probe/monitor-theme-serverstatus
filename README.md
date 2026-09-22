# monitor-theme-serverstatus

[monitor](https://github.com/monitor-probe/monitor) 的一款公开页主题，沿用经典 ServerStatus 的紧凑表格布局。

![预览](preview.png)

## 安装

从 [Releases](https://github.com/monitor-probe/monitor-theme-serverstatus/releases) 下载
`theme.tar.gz`，在 hub 后台「主题」页上传，或解压到 hub 的 `--themes` 目录下的 `serverstatus/`。
之后可在同一页切换，卡片上的 ⟳ 从本仓库的最新 release 更新。

## 开发

主题只读公开数据，开发服务器直接拿一个现成的 hub 当数据源，要求它开着公开状态页：

```bash
npm ci
# Vite 将 /api 与 WebSocket 代理至这个 hub
MONITOR_HUB=https://hub.example.com npm run dev
```

不设 `MONITOR_HUB` 时代理至 `http://127.0.0.1:9911`。在本机起 hub、自己造节点的写法见文档站的
[主题开发](https://monitor-document.pages.dev/dev/theme)页。

## 许可

MIT。国旗图标来自 [flag-icons](https://github.com/lipis/flag-icons)，MIT。
