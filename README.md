# HFUT-CS-Online Sync Extension

独立的 Chrome / Edge Manifest V3 扩展，**无需修改原 HFUT-CS-Online 网站**。适用网站：

https://saltgardenia.github.io/HFUT-CS-Online/

## 功能

- **全站做题同步**：自动识别各门课程的 `*-practice-progress-v1` 本地记录，以及算法课的 `practice-progress-v1`。按「课程 + 题目 ID」保存答对、答错、看过答案等状态，不会混淆不同课程相同题号。
- **跨设备同步**：通过 `chrome.storage.sync` 在登录了同一个浏览器账号、开启扩展同步的桌面浏览器之间传递记录。记录使用时间戳和删除墓碑进行逐题合并；同步有延迟，不能替代备份。
- **全站阅读进度**：记录阅读页面的路径、最近章节标题、百分比、滚动距离，弹窗可点击返回。第一次安装前网站未保存的阅读位置不能追溯。
- **全站概览**：查看各课程有记录的题数、答对题数、最近阅读页面。
- **备份**：导出/导入 JSON，用于 Chrome / Edge 之间迁移、留存个人备份。

网站现有的选择题作答进度会在首次安装后读入；扩展不会改动网页源码。为了避免 React 在做题时覆盖其他设备传来的答案，**已打开的做题页面需要刷新后才会把其他设备的记录显示到界面**。

## 安装

1. 打开 [GitHub 仓库](https://github.com/Junpgle/HFUT-CS-Online-Sync-Extension)，选择 **Code → Download ZIP**，解压。
2. Chrome 地址栏输入 `chrome://extensions/`，Edge 输入 `edge://extensions/`。
3. 开启开发者模式，选择 **加载已解压的扩展程序**，选中包含 `manifest.json` 的根目录。
4. 多台电脑使用同一 Chrome 账号（或同一 Edge 账号），并在浏览器设置中开启扩展同步。
5. 正常浏览网站。扩展弹窗可查看进度、触发同步、导出备份和跳转到阅读位置。

> 注意：Chrome 和 Edge 的同步云空间互不相通；手机端通常不支持安装此类桌面扩展。不同浏览器请使用 JSON 备份迁移。

## 自动识别规则

只在站点 `saltgardenia.github.io/HFUT-CS-Online/`（以及已配置的本地开发地址）运行。

- 做题记录：读取本网站 `localStorage` 中精确匹配 `practice-progress-v1`、`课程代号-practice-progress-v1` 的数据；仅接受 `right`、`wrong`、`revealed` 三种值。
- 阅读记录：记录站内非 `practice`、非 `attachments` 的课程页面路径，例如 `#/net/deck/ch4`、`#/os/chapter/ch2` 等。
- 数据冲突：同一题保留时间戳较新的记录（设备时间请保持准确）；网页主动清空做题结果也会被记录并同步。
- 现有网站的首页收藏、最近查看和主题设置**暂不同步**，因为这些不属于答题或阅读位置。

## 数据保护与限制

- 只获得浏览器 `storage`、`activeTab` 权限，以及此网站的受限访问权限；无额外第三方服务器、无 Cookie 访问权限。
- Chrome / Edge 的 `storage.sync` 存在总量约 100 KiB、每项约 8 KiB 的配额及写入速率限制。题库很大时可能超额，扩展会保留本地数据、显示同步失败提醒，支持导出 JSON。
- 各课程题目按哈希分成 16 个分片，以减小单项数据体积。
- 读取远端同步结果后，扩展不会在正在使用的答题页内直接篡改 React 内存状态；如其他设备有更新，请刷新当前答题页面。
- **此仓库是可测试的源码版本，尚未经跨两台真实电脑完整验收。**

## 本地检查

已提供可在 Node.js 20+ 运行的检查脚本，扩展无需依赖安装：

```bash
node --check shared.js
node --check content.js
node --check popup.js
node tests/test-shared.cjs
node tests/test-content.cjs
```

源码结构：`manifest.json` 扩展清单、`shared.js` 数据结构/合并规则、`content.js` 自动同步与阅读检测、`popup.html/css/js` 操作面板、`icons/` 图标、`tests/` 回归检查。
