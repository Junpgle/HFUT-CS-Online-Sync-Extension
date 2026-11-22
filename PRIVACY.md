# HFUT-CS-Online 全站学习同步扩展 · 隐私政策

**最近更新：2026 年 11 月 22 日**  
**适用版本：2.2.0 及后续未改变数据处理方式的版本**  
**维护者：Junpgle（独立扩展开发者）**

本政策适用于浏览器扩展「HFUT-CS-Online 全站学习同步」，项目地址：
https://github.com/Junpgle/HFUT-CS-Online-Sync-Extension

本扩展不是合肥工业大学、HFUT-CS-Online 网站维护者或 Microsoft 官方发布的产品。

## 1. 扩展为什么读取学习数据

本扩展的唯一目的，是帮助用户跨设备保存、恢复和管理 **HFUT-CS-Online** 网站的学习进度。浏览器账号同步为原有模式；从 v2.2.0 起还提供需用户主动登录的 Question-Bank 独立云同步。它不会为了广告、用户画像或营销而收集学习记录。

扩展仅在以下指定网站上运行内容脚本：

- `https://saltgardenia.github.io/HFUT-CS-Online/`
- 正式扩展只对这个网站请求访问权限，不具有访问所有网站的权限。

## 2. 处理的数据类型

为了提供实际功能，扩展会读取或生成以下信息：

| 数据 | 使用目的 |
| --- | --- |
| 课程代号和题目 ID | 分辨不同课程及题目，避免跨课程混淆 |
| 做题结果（答对、答错、查看答案） | 跨设备恢复答题进度 |
| 课程页面路径、页面标题、最近阅读位置和百分比、知识点锚点 | 在扩展面板展示阅读记录并跳转回来 |
| 记录更新时间、随机生成的设备标识 | 逐题合并不同设备的修改 |
| 课程同步停用状态 | 避免已清除的课程再次自动上传 |
| 同步成功或失败状态、同步空间用量 | 显示状态和空间占用 |

扩展从指定网站的浏览器 `localStorage` 中读取与做题进度匹配的记录，并根据用户在该网站的滚动位置生成阅读记录。题目 ID 和阅读过的课程可能反映个人学习活动。

**未启用独立云同步时**，扩展不读取用户的用户名、账号密码、Cookie、支付信息、其他网站的浏览历史，也不读取具体题目正文或答题时输入的文本。**主动登录 Question-Bank 时**，扩展通过 HTTPS 将用户输入的该网站用户名与密码提交至现有 `worker.junpgle.me/api/login` 验证；密码仅用于当次登录，不会由扩展持久化。扩展本机存储认证成功后获得的 JWT 和必要的用户名信息，服务端使用已有用户账号及数据库执行验证。

## 3. 数据保存位置与同步传输

- **网站本地存储**：原网站自己的学习记录仍保存在其 `localStorage` 中。
- **扩展本地存储**：扩展使用 `chrome.storage.local` 存放本机同步状态和缓存。
- **浏览器账号同步存储**：扩展使用 `chrome.storage.sync` 保存学习结果、阅读记录及课程停用设置。在用户的浏览器配置允许同步时，这些内容可能由浏览器提供商（Microsoft Edge 或 Google Chrome）通过其账号同步基础设施传输、存储并同步到其他设备。

**可选的 Question-Bank 独立云同步：** 用户主动登录扩展中的 Question-Bank 账号后，扩展向 `https://worker.junpgle.me/api/site-sync/exchange` 发送当前课程的题目 ID、做题结果、阅读路径与位置、更新时间、随机设备标识和课程同步控制信息。后端使用 Cloudflare Workers + D1 处理并保存这些数据，仅允许经过 JWT 鉴权的同一账号访问。账号库与题库系统共用，但 HFUT-CS-Online 记录保存在独立 `SiteSyncState` 表，不与题库原有 `UserProgress` 表混用。同步接口不传输题目正文，不使用数据制作广告或分析用户画像。

此独立同步功能**默认关闭**；不登录便不会向开发者服务器上传学习记录。登录后账号令牌存储于当前浏览器扩展的本地存储空间（不存入浏览器 `storage.sync`），用于后续免重复输入密码；JWT 有有效期限。用户可在扩展里退出账号、请求删除该账号的独立云学习记录。删除后若设备仍已登录并继续同步，本地历史数据可能再次上传，应先退出或关闭各设备的云同步。服务器不主动提供端到端加密：Cloudflare 平台和具备服务器管理权限的维护者在技术上可以接触云端存储的学习进度，请勿把学习进度视为只有用户本人才能解密的数据。

Cloudflare 是云基础设施提供商，可能根据其产品政策处理网络请求元数据。独立云记录在账号或对应云端记录被删除前持续保存；数据库备份和系统日志可能依服务商政策另外保留一定时间。数据使用 HTTPS 传输，但不保证在所有国家和地区的网络中均可用。扩展不包含广告 SDK 或行为分析 SDK。

**未登录独立云同步时**，开发者不接收上述学习进度，用户仍可使用浏览器本地存储、浏览器账号同步及 JSON 备份。浏览器提供商的同步服务遵循其自己的条款和隐私政策；扩展不承诺浏览器账号同步数据独立端到端加密。

用户点击「导出备份」时，扩展会在本机生成 JSON 文件。该文件**默认不加密**，请自行保管，避免上传到公开网盘或仓库。

## 4. 浏览器权限

- `storage`：用于扩展本地缓存、浏览器账号同步、容量统计和课程清理。
- `activeTab`：当用户打开扩展弹窗并操作时，识别当前学习网页、向该网页发送同步请求或按用户指令刷新。
- **指定网站访问权限**：只允许在上述 HFUT-CS-Online 网站读取学习记录和页面阅读位置，不获得访问所有网站的权限。
- **`worker.junpgle.me` 主机权限**：仅为用户主动登录并启用的 Question-Bank 独立云同步发起 HTTPS 登录、同步、退出和数据删除请求；不包含访问其他服务器的通配权限。

## 5. 数据保存时间、控制与删除

学习数据会保留在浏览器的本地存储和同步存储中，直到用户清理、浏览器清理或相应的数据因配额、账号设置等原因被移除。

用户可以：

1. 在扩展弹窗中查看各课程同步占用。
2. 使用「**清除并停用**」删除指定课程的云端答题与阅读记录，并阻止更新版扩展继续自动上传它。
3. 使用「**恢复同步**」再次启用；此后网站原有的本地记录可能被重新导入云端。
4. 使用「**导出备份**」和「**导入备份**」自主迁移数据。
5. 在独立云同步区域退出账号（删除本机 JWT），或主动删除 Question-Bank 账号下的独立云学习记录；该操作不影响题库系统的题目及统计。
6. 在浏览器的扩展管理页面卸载扩展。

**重要区别**：清除某门课程的云端记录**不会删除该课程网站本身的 `localStorage`**；卸载扩展也不保证清除浏览器账号同步基础设施中已保存的数据。建议先在扩展中清除不再需要的课程，再卸载，并根据浏览器提供商的说明管理其账号同步数据。

课程停用需要保留一个很小的同步控制项，以阻止其他设备重新上传。其他尚未更新到支持停用功能的旧版扩展，可能不遵守此设置，请先更新其他设备上的扩展。跨设备删除和同步可能存在延迟。浏览器提供商可能按其规则保留备份或日志；扩展开发者无法直接管理这类保存行为。

## 6. 数据共享、广告与安全

开发者不会销售、出租上述学习数据，不将其用于广告、营销、信用评估或用户画像。跨设备传输有两个独立途径：浏览器提供商的账号同步服务，以及用户主动启用、依托 Cloudflare 服务的 Question-Bank 独立云同步。

扩展只执行随安装包提供的 JavaScript，不会从外部服务器下载或执行远程代码。浏览器同步配额有限，超额时可能出现同步失败；用户应保留重要记录的备份。

## 7. 变更与联系方式

如扩展的数据处理方式发生变化，维护者会更新本政策，并在项目仓库保留相应更新记录。

反馈与数据相关问题：
https://github.com/Junpgle/HFUT-CS-Online-Sync-Extension/issues

请勿在公开 Issue 中粘贴含真实学习记录、个人信息或浏览器账号数据的 JSON 备份。

---

**English summary:** This independent HFUT-CS-Online extension reads quiz progress and reading bookmarks from the specified study site. It always uses browser-local extension storage and may use the browser provider's sync storage. Starting with version 2.2.0, users may optionally sign in with their existing Question-Bank credentials: the login is sent to https://worker.junpgle.me/api/login over HTTPS; passwords are not stored by the extension. An authenticated JWT is kept in extension-local storage, and the developer's Cloudflare Worker and D1 database process and persist the course IDs, quiz statuses, reading positions, timestamps and device IDs in a separate account-scoped table. The optional service is off until sign-in, is not end-to-end encrypted, and provides logout and server data deletion. There are no ads or analytics SDKs. Please read the full Chinese policy above for data retention, deletion, limitations and third-party service processing.\n