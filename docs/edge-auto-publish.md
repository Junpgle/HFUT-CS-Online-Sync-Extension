# Edge 商店自动更新发布

采用 Microsoft 官方 Add-ons Update REST API v1.1。只更新现有商店产品，不创建新产品或修改商店描述。提交成功表示进入认证流程，不表示已通过审核或立即上架。

## 首次配置

1. 登录 [Partner Center](https://partner.microsoft.com/dashboard)，进入 Microsoft Edge → Publish API（发布 API）。启用新版 API 并创建 API credentials。
2. 在 Microsoft Edge → Overview → 本扩展 → Extension identity 中复制 Product ID（GUID）。它不是商店扩展 ID `ladgbknkfnbpmdfmjffhhbiajjceicip`。
3. 打开 [GitHub Actions Secrets](https://github.com/Junpgle/HFUT-CS-Online-Sync-Extension/settings/secrets/actions)，逐个添加 Repository secret：

| Secret | 值 |
| --- | --- |
| EDGE_CLIENT_ID | Publish API 的 Client ID |
| EDGE_API_KEY | Publish API 的 API key |
| EDGE_PRODUCT_ID | Partner Center 的 Product ID（GUID） |

不要将凭据写入代码、截图、聊天或日志。凭据过期/轮换时只更新 GitHub Secrets。

## 发布版本

先确认 manifest.json 的 version 已更新，代码已合并至 main 并经过实机验证。确认 Partner Center 没有不应提交的草稿或正在审核的版本；API 发布的是该产品当前草稿。商店资料和隐私声明有变化时需先在 Partner Center 手动更新。

```bash
git checkout main
git pull --ff-only
git tag v2.4.0
git push origin v2.4.0
```

版本标签必须与 manifest.json 完全相同，且指向 main 历史中的提交。标签推送会先运行完整测试、构建和独立校验，再使用同一次运行生成的 ZIP 向微软提交更新。普通 main 提交与 PR 不提交商店。

也可在 Actions → Publish to Microsoft Edge Add-ons → Run workflow 选择标签，勾选 submit 后手动提交；不勾选则仅测试构建，不读取 Secrets 或调用微软接口。默认分支的手动运行只能测试构建。

不要为了重试而重复创建标签或强制移动已发布的标签。若上传或提交失败，先查看 Partner Center 的草稿/审核状态；若已经进入审核，不要盲目重复提交。确认尚未提交后，才手动在相同标签上重试。

## 状态与验证

- Actions 成功：微软 API 确认创建了审核提交；真正上架仍取决于微软认证流程。
- Actions 失败：查看错误类型和 Partner Center，不会在上传校验失败时继续提交。
- 商店正式上架后，商店安装的 Edge 扩展按浏览器更新机制升级；GitHub 解压安装不会自动更新。

官方文档：[使用 REST API 更新扩展](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/update/api/using-addons-api)。
