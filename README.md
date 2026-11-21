# HFUT-CS-Online Sync Extension

独立的 Chrome / Edge Manifest V3 扩展，**无需修改原 HFUT-CS-Online 网站**。适用网站：

https://saltgardenia.github.io/HFUT-CS-Online/

## 功能

- **全站做题同步**：自动识别各门课程的 `*-practice-progress-v1` 本地记录，以及算法课的 `practice-progress-v1`。按「课程 + 题目 ID」保存答对、答错、看过答案等状态，不会混淆不同课程相同题号。
- **跨设备同步**：通过 `chrome.storage.sync` 在登录了同一个浏览器账号、开启扩展同步的桌面浏览器之间传递记录。记录使用时间戳和删除墓碑进行逐题合并；同步有延迟，不能替代备份。
- **全站阅读进度**：记录阅读页面的路径、最近章节标题、百分比、滚动距离，弹窗可点击返回。第一次安装前网站未保存的阅读位置不能追溯。
- **全站概览**：查看各课程有记录的题数、答对题数、最近阅读页面。
- **备份**：导出/导入 JSON，用于 Chrome / Edge 之间迁移、留存个人备份。
- **同步空间用量**：调用浏览器的 `chrome.storage.sync.getBytesInUse(null)` 显示实际已用、剩余字节与 100 KiB（102400 字节）总量；各门课程单独统计云端占用，并按大小排序。
- **课程同步管理**：点击「清除并停用」后，先同步停用标记，再删除该课程所有云端答题/阅读键。其他已更新设备会停止上传该课程；网站自己的 `localStorage` 不会删除。点击「恢复同步」并打开或刷新课程网页，即可从本地记录重新建立同步。


网站现有的选择题作答进度会在首次安装后读入；扩展不会改动网页源码。为了避免 React 在做题时覆盖其他设备传来的答案，**已打开的做题页面需要刷新后才会把其他设备的记录显示到界面**。

## 安装

1. 打开 [GitHub 仓库](https://github.com/Junpgle/HFUT-CS-Online-Sync-Extension)，选择 **Code → Download ZIP**，解压。
2. Chrome 地址栏输入 `chrome://extensions/`，Edge 输入 `edge://extensions/`。
3. 开启开发者模式，选择 **加载已解压的扩展程序**，选中包含 `manifest.json` 的根目录。
4. 多台电脑使用同一 Chrome 账号（或同一 Edge 账号），并在浏览器设置中开启扩展同步。
5. 正常浏览网站。扩展弹窗可查看进度、触发同步、导出备份和跳转到阅读位置。

> 注意：Chrome 和 Edge 的同步云空间互不相通；手机端通常不支持安装此类桌面扩展。不同浏览器请使用 JSON 备份迁移。

## 同步空间与课程清理

打开扩展弹窗，顶部的 **云端同步空间** 会显示「已用 / 100 KiB」、使用百分比和剩余容量，数据来自浏览器当前的真实同步存储用量（包括每个键名、停用设置等开销），**不是本机磁盘用量**。扩展本身不能突破浏览器强制配额。

在 **课程同步管理** 中，可以查看每门课程的云端占用量。选择 **清除并停用**，确认后：

1. 在同步存储中写入该课程的停用标记，通知其他设备停止上传。
2. 删除该课程在浏览器云端保存的做题记录和阅读进度，释放空间。
3. 原站点自己的做题记录仍留在当前浏览器的 `localStorage`，其他课程不受影响。
4. 如需重新同步，点击 **恢复同步**，并打开或刷新该课程网页，即可重新从本地读取记录。

清理操作不会删除其他设备浏览器里已经保存的**网站本地**数据。此前尚未同步到任何设备本地的云端记录，清理后不可恢复；建议重要课程先导出 JSON 备份。已停用课程不会被重新导入备份，除非先明确恢复该课程同步。

若空间已满、无法先写入停用标记，扩展会尝试先清除所选课程的记录以腾出容量，再写入标记。极端并发或离线同步冲突下可再次检查「课程同步管理」的云端占用量。

## 自动识别规则

只在站点 `https://saltgardenia.github.io/HFUT-CS-Online/` 运行。

- 做题记录：读取本网站 `localStorage` 中精确匹配 `practice-progress-v1`、`课程代号-practice-progress-v1` 的数据；仅接受 `right`、`wrong`、`revealed` 三种值。
- 阅读记录：记录站内非 `practice`、非 `attachments` 的课程页面路径，例如 `#/net/deck/ch4`、`#/os/chapter/ch2` 等。
- 数据冲突：同一题保留时间戳较新的记录（设备时间请保持准确）；网页主动清空做题结果也会被记录并同步。
- 现有网站的首页收藏、最近查看和主题设置**暂不同步**，因为这些不属于答题或阅读位置。

## 数据保护与限制

- 只获得浏览器 `storage`、`activeTab` 权限，以及此网站的受限访问权限；无额外第三方服务器、无 Cookie 访问权限。
- Chrome / Edge 的 `storage.sync` 存在总量约 100 KiB、每项约 8 KiB 的配额及写入速率方面的限制。题库很大时可能超额，扩展会保留本地数据、显示同步失败提醒，支持导出 JSON。
- 各课程题目按哈希分成 16 个分片，以减小单项数据体积。
- 读取远端同步结果后，扩展不会在正在使用的答题页内直接篡改 React 内存状态；如其他设备有更新，请刷新当前答题页面。
- 当前版本已通过模拟双设备与课程停用/恢复场景测试；不同浏览器账号与网络环境下仍需按实际情况验证同步传播速度。

## 本地检查

已提供可在 Node.js 20+ 运行的检查脚本，扩展无需依赖安装：

```bash
node --check shared.js
node --check content.js
node --check popup.js
node tests/test-shared.cjs
node tests/test-content.cjs
node tests/test-popup.cjs
```

源码结构：`manifest.json` 扩展清单、`shared.js` 数据结构/合并规则、`content.js` 自动同步与阅读检测、`popup.html/css/js` 操作面板、`icons/` 图标、`tests/` 回归检查。

## Microsoft Edge 加载项商店发布

扩展支持使用 Microsoft Edge Partner Center 发布。**不需要修改原网站。**

- [隐私政策（公开 URL）](PRIVACY.md)
- [简体中文商店文案、关键词与图片尺寸](store/EDGE_LISTING.zh-CN.md)
- [English Store Listing](store/EDGE_LISTING.en.md)
- [权限说明、数据使用申报与审核测试备注](store/EDGE_CERTIFICATION.md)
- [Microsoft 官方发布指引](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Edge 商店 Logo · 300×300 PNG](store/assets/logo-300.png)（上传至 Store Listings 的 Extension logo）
- [Logo 可缩放矢量原稿](store/assets/logo.svg)

在仓库根目录执行以下命令即可构建并验证商店专用 ZIP（需 Python 3.9+，无第三方依赖）：

```bash
python scripts/package_edge.py
python scripts/verify_edge_package.py dist/HFUT-CS-Online-Sync-Extension-Edge-v2.1.4.zip
```

**语言本地化：** 自 v2.1.2 起，`manifest.json` 将 `default_locale` 设置为 `zh_CN`，并通过 `__MSG_extensionName__`、`__MSG_extensionDescription__` 等引用分别读取 `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json`。这能让 Edge 商店识别 **简体中文 / English** 两种商品语言。扩展弹窗目前主要是中文界面，英文语言包覆盖扩展名称、简短说明和工具栏提示，并非全套界面翻译。

在 Partner Center 的「Store Listings」中替换上传新版本 ZIP 后，应看到简体中文和英语两个语言项目。**两种语言都需要分别填写商店详细介绍并上传 Logo**；若只打算维护中文商品页，可以在后台移除英文商品语言项，扩展仍保留英文元数据的浏览器回退能力。商店支持同一个 Logo 复制到其他语言的条目，截图仍由你自行准备。

生成的 ZIP 中 **`manifest.json` 位于根目录**，仅包含运行所需文件；不会把 README、测试脚本、GitHub 配置、私钥或开发标识打包进去。源码 `manifest.json` 的公开 `key` 为本地解压安装时的扩展 ID 保持稳定，商店包会排除它，Edge 商店负责分配商店安装 ID。

**无需手动打包的方式**：前往仓库 [Actions → Extension checks](https://github.com/Junpgle/HFUT-CS-Online-Sync-Extension/actions/workflows/check.yml)，选择最新一次成功运行，下载构建产物 **Edge-Addons-Upload-Package**；解压该 Actions 产物后，会获得要上传到 Partner Center 的 ZIP 文件。不要直接把 GitHub 「Code → Download ZIP」作为商店安装包上传。

上架时选择简体中文商品资料，复制 `store/EDGE_LISTING.zh-CN.md` 的正文；按 `store/EDGE_CERTIFICATION.md` 填写权限理由、隐私和审核备注。**图片需要在 Partner Center 独立上传**：请使用专门制作的 [`store/assets/logo-300.png`](store/assets/logo-300.png)（300×300 PNG），不要将扩展工具栏使用的 `icons/icon128.png` 当成最终商店 Logo。自 v2.1.4 起，运行时图标已由 Pillow 严格解码并重编码为标准 8 位 RGBA PNG，避免早期图标数据损坏和索引色图像兼容性问题。真实功能截图由维护者自行制作，推荐 1280×800 或 640×480，最多 6 张。

当前扩展与 HFUT-CS-Online、合肥工业大学和 Microsoft 均无官方从属关系。审核是否通过由 Microsoft 决定。

### v2.1.4 图标兼容性修复

早期发布包的 `icon128.png` 曾出现浏览器无法解码的安装错误。v2.1.4 对 16、48、128 三种 PNG 均改用 **8-bit RGBA**，发布验证会逐项核对 CRC、DEFLATE 完整性、色彩格式和尺寸，并用 Pillow 独立解码实际 ZIP 内的图片。只升级仓库源码不会自动修改已上架的商店扩展；需要在 Partner Center 上传新版本 ZIP 并等待审核/分发。

### 发布前最后检查

- 扩展包通过自动化语法、双设备模拟、容量/停用恢复测试、语言本地化及 ZIP 包验证后，CI 才会上传发布产物。
- 用 Edge 实机加载当前源码，确认题目、阅读位置、导入导出和课程清除均正常。
- 检查隐私政策、描述、截图和开发者公开资料是否准确。
- 登录 [Partner Center](https://partner.microsoft.com/dashboard) 上传 **发布专用 ZIP**，补充截图和商店 Logo，完成审核提交。
