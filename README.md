# HFUT 计网学习同步 · 独立浏览器扩展

适用于 `https://saltgardenia.github.io/HFUT-CS-Online/#/net` 的 Manifest V3 扩展。**不修改原网站源码。**

## 功能

- 自动同步三套计网试卷的逐题结果：`right`（答对）、`wrong`（答错）、`revealed`（查看答案）；冲突按每题最近更新时间合并。
- 单独记录七章的阅读百分比和最后阅读的知识点，在扩展弹窗中点击可跳转回章节。
- 使用 `chrome.storage.sync`，同一 Chrome 账号的 Chrome 或同一 Edge 账号的 Edge 可以跨桌面设备同步，无需自建服务器。
- 支持 JSON 备份导出和导入，便于跨浏览器迁移。

## 安装

1. 在仓库下载源码 ZIP 或克隆仓库，确保根目录含 `manifest.json`。
2. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
3. 开启开发者模式，选择**加载已解压的扩展程序**，指向该根目录。
4. 各台电脑安装同一版本，登录各自浏览器账号并开启扩展同步；打开计网网站进行学习。

## 使用限制与注意事项

- 支持网站的 `net-practice-progress-v1` 作答数据以及 `#/net/deck/ch1`～`ch7` 的阅读位置；不读取其他课程的作答记录。
- 跨设备同步可能有延迟；在另一台电脑打开中的答题页面需要**刷新网页**，让 React 重新读取同步后的记录。
- 网站原本没有跨会话保存阅读位置，安装扩展后才开始积累阅读记录。
- Chrome 和 Edge 的账号同步空间不互通，需要使用扩展的 JSON 导入/导出。
- 网站主动清空答题进度会同步删除状态；建议定期导出备份。
- `manifest.json` 中固定的公开 `key` 用来保持解压安装时的扩展 ID 一致，仓库不包含私钥。
- 浏览器 `storage.sync` 存在配额和同步频率限制。扩展只读取指定站点的学习记录，不采集 Cookie、密码或其他网站信息。
- 手机浏览器通常不支持安装任意桌面浏览器扩展。

## 测试

使用 Node.js，无需安装 npm 依赖：

```bash
node tests/test-shared.cjs
node tests/test-content.cjs
```

项目代码以仓库根目录为扩展目录；`icons/`、`tests/` 为图标及测试文件。