# 步兵JAVDB

基于 Cloudflare Pages Functions / Workers 的实时反向代理项目。页面、业务数据和媒体信息由上游实时提供，本仓库不保存影片、封面、数据库或用户账号数据。

部署后的界面会自动应用以下调整：

- 站点品牌显示为“步兵JAVDB”。
- 主内容区域最大宽度为 1600px。
- 宽屏桌面端每行显示 5 张大封面卡片。
- 影片列表默认请求 32 条数据。
- 保留搜索、筛选、详情页、登录请求、封面显示和视频播放等上游功能。

> [!IMPORTANT]
> 本项目仅供学习 Cloudflare Workers、Pages Functions 和流式反向代理技术。部署前请确认你有权代理上游内容，并遵守 Cloudflare 服务条款、上游站点规则及当地法律。项目作者不提供上游内容、账号或可用性保证。

## 工作原理

访问者请求会先进入 Cloudflare Pages Function 或 Worker，再由 `src/proxy.js` 转发到上游：

```text
浏览器
  -> Cloudflare Pages Function / Worker
  -> 上游站点
  -> 响应改写与流式透传
  -> 浏览器
```

代理会处理：

- 页面、脚本、样式和接口路由转发。
- 上游绝对地址、重定向地址和 Cookie Domain 改写。
- 品牌、页面宽度、卡片列数和每页数量调整。
- `Range` 请求与 `206 Partial Content` 视频响应透传。
- MP4、HLS 播放列表、AES-128 密钥和视频分片流式传输。
- 媒体代理域名白名单，阻止把部署实例用作任意开放代理。

目标 API、封面和 HLS 地址默认保持直连。目标 API 会根据原始 API 域名生成 `jdsignature`，因此不要随意开启外部媒体地址改写。

## 环境要求

- [Node.js](https://nodejs.org/) 22 或更高版本。
- npm 10 或更高版本。
- 一个 Cloudflare 账号。
- Git 和 GitHub 账号（仅 GitHub 自动部署方式需要）。

确认环境：

```bash
node --version
npm --version
```

## 快速开始

将下面的仓库地址替换为你上传后的 GitHub 地址：

```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY>.git
cd <YOUR_REPOSITORY>
npm ci
npm test
```

本地启动 Cloudflare Pages 运行环境：

```bash
npm run dev:pages
```

默认可通过终端显示的本地地址访问，通常是 `http://localhost:8788`。

如果 Windows 缺少 `workerd` 所需的系统运行库，或者只想快速检查代理逻辑，可以使用 Node 适配器：

```bash
npm run dev:node
```

Node 适配器默认监听 `http://127.0.0.1:8788`。它调用同一个 `handleProxy`，但不等同于完整的 Cloudflare 本地运行时；正式发布前仍建议执行一次 Wrangler 构建检查。

## 部署方式一：GitHub 自动部署到 Pages

这种方式适合公开 GitHub 仓库。每次推送到指定分支后，Cloudflare 会自动创建新部署。

### 1. 上传仓库

在 GitHub 新建空仓库，然后在本地执行：

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY>.git
git push -u origin main
```

不要提交 `.dev.vars`、`.wrangler/`、`.tools/` 或 `node_modules/`。这些路径已经写入 `.gitignore`。

### 2. 在 Cloudflare 创建 Pages 项目

进入 Cloudflare Dashboard：

1. 打开 **Workers & Pages**。
2. 选择创建应用并进入 **Pages**。
3. 选择连接 Git，授权 GitHub 后选中刚才的仓库。
4. 生产分支选择 `main`。
5. Framework preset 选择 `None`。
6. Build command 留空。
7. Build output directory 填写 `public`。
8. Root directory 使用仓库根目录。
9. 保存并部署。

仓库根目录下的 `functions/` 会被识别为 Pages Functions，`public/_routes.json` 会让所有请求进入代理逻辑。

### 3. 设置环境变量

默认配置可以直接运行。如果需要修改上游或媒体白名单，在 Pages 项目的 **Settings > Variables and Secrets** 中添加变量，然后重新部署。

### 4. 绑定自定义域名

进入 Pages 项目的 **Custom domains**，添加已经托管在 Cloudflare 的域名或子域名，并按页面提示完成 DNS 配置。

## 部署方式二：Wrangler 直传 Pages

这种方式不依赖 GitHub 自动构建，适合从本机手动发布。

首次使用先登录 Cloudflare：

```bash
npx wrangler login
```

执行部署：

```bash
npm run deploy:pages
```

当前脚本使用项目名 `bbjavdb`。需要更换名称时，可以修改 `package.json` 中的 `deploy:pages`，或直接执行：

```bash
npx wrangler pages deploy public --project-name=<YOUR_PAGES_PROJECT>
```

首次部署时，Wrangler 会引导创建 Pages 项目。后续使用相同项目名会更新同一个项目。

## 部署方式三：独立 Worker

独立 Worker 不使用 Pages 项目，所有请求直接进入 `src/worker.js`。

### 1. 修改 Worker 名称

编辑 `wrangler.jsonc`：

```jsonc
{
  "name": "your-worker-name",
  "main": "src/worker.js",
  "compatibility_date": "2026-08-16",
  "workers_dev": true,
  "vars": {
    "UPSTREAM_ORIGIN": "https://catembylegacy.fastcdn.dpdns.org"
  }
}
```

### 2. 登录并发布

```bash
npx wrangler login
npm run deploy
```

部署完成后，Wrangler 会输出一个 `workers.dev` 地址。自定义域名可以在 Cloudflare Dashboard 的 Worker 设置中绑定。

发布前只构建、不上传：

```bash
npx wrangler deploy --dry-run
```

## Pages 与 Worker 如何选择

| 方式 | 适合场景 | 优点 |
| --- | --- | --- |
| Pages + GitHub | 希望提交代码后自动发布 | Git 集成、预览部署、版本管理方便 |
| Wrangler 直传 Pages | 不想连接 GitHub 自动构建 | 命令简单，仍保留 Pages 项目能力 |
| 独立 Worker | 只需要代理服务或已有 Worker 域名 | 配置直接，路由控制更集中 |

三种方式共用 `src/proxy.js`，核心行为一致。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `UPSTREAM_ORIGIN` | `https://catembylegacy.fastcdn.dpdns.org` | 上游站点根地址，只允许 `http` 或 `https` |
| `EXTRA_MEDIA_HOSTS` | 空 | 额外允许代理的媒体域名，多个域名用英文逗号分隔 |
| `PROXY_EXTERNAL_MEDIA` | `false` | 是否把白名单外部资源改写到同源媒体代理 |

本地 Wrangler 开发可以从示例文件开始：

```bash
cp .dev.vars.example .dev.vars
```

Windows PowerShell：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

`.dev.vars` 示例：

```dotenv
UPSTREAM_ORIGIN=https://catembylegacy.fastcdn.dpdns.org
EXTRA_MEDIA_HOSTS=another-media.example.com
PROXY_EXTERNAL_MEDIA=false
```

> [!WARNING]
> 对当前默认上游，请保持 `PROXY_EXTERNAL_MEDIA=false`。开启后 API 地址也会被改写，可能导致前端不再生成必需的 `jdsignature`，从而出现“Failed to load movies”或详情加载失败。

## 自定义界面

界面调整集中在 `src/proxy.js` 的 `REPLICA_SOURCE_PATCHES`：

```js
const REPLICA_SOURCE_PATCHES = [
  ["原文字", "新文字"],
];
```

当前已经包含品牌、容器宽度、列表数量等改写。修改后运行：

```bash
npm test
```

这些改写依赖上游编译脚本中的精确字符串。如果上游重新构建并改变压缩代码，页面代理仍可能正常运行，但对应的品牌或布局改写可能失效，需要更新匹配字符串和测试。

## 项目结构

```text
.
|-- functions/
|   |-- index.js          # Pages 根路由
|   `-- [[path]].js       # Pages 多级路由
|-- public/
|   |-- _routes.json      # 所有路径进入 Pages Functions
|   `-- index.html        # Functions 未运行时的提示页
|-- scripts/
|   `-- dev-node.mjs      # Node 本地预览适配器
|-- src/
|   |-- proxy.js          # 核心代理、改写和安全策略
|   `-- worker.js         # 独立 Worker 入口
|-- test/
|   `-- proxy.test.mjs    # Node 单元测试
|-- .dev.vars.example     # 本地变量示例
|-- package.json
`-- wrangler.jsonc
```

## 测试与发布检查

运行全部单元测试：

```bash
npm test
```

测试覆盖：

- 应用路由和媒体路由解析。
- 品牌与布局改写。
- 签名 API 地址保留。
- 登录方法、请求头、请求体和 Cookie 转发。
- 重定向地址和 Cookie Domain 改写。
- 视频 `Range` 请求与 `206` 响应。
- 媒体域名白名单和任意代理拦截。

推荐的发布前流程：

```bash
npm ci
npm test
npx wrangler deploy --dry-run
```

对于 Pages Functions，也可以单独检查构建：

```bash
npx wrangler pages functions build --outdir=.wrangler/pages-functions-build
```

## 验证视频 Range 响应

将域名和番号替换成实际值：

```bash
curl -r 0-1023 -D - "https://<YOUR_DOMAIN>/preview.mp4?number=<MOVIE_NUMBER>" -o /dev/null
```

正常结果应包含：

```text
HTTP/2 206
content-range: bytes 0-1023/...
content-type: video/mp4
```

Windows 可将输出目标从 `/dev/null` 改为 `NUL`。

## 常见问题

### 页面打开但影片一直加载失败

确认 `PROXY_EXTERNAL_MEDIA` 没有设置为 `true`。默认上游 API 依赖浏览器生成的 `jdsignature`，API 域名被改写后签名逻辑可能失效。

同时检查浏览器开发者工具中的 Network：

- `jdforrepam.com` API 是否返回 `200`。
- 是否有 CORS、DNS 或证书错误。
- 上游是否正在维护或限制当前网络出口。

### 图片显示但视频不能播放

检查 `/preview.mp4` 是否返回 `206 Partial Content`，并确认请求中的 `Range` 头没有被 CDN、其他反向代理或自定义规则移除。

HLS 预览还需要播放列表、AES 密钥和 `.ts` 分片域名可访问。不要随意删除 `gzankun.com`、`spfcas.com` 相关媒体白名单。

### Windows 启动 `dev:pages` 时 `workerd` 退出

先确认 Node.js 版本满足要求，并安装当前 Windows Visual C++ 运行库。只需快速检查代理时可以使用：

```bash
npm run dev:node
```

### 修改品牌或列数后没有生效

浏览器可能缓存了上游带哈希的 JavaScript 文件。尝试清除站点缓存、使用无痕窗口，或换一个本地端口重新测试。

如果仍无效，可能是上游重新构建后压缩字符串发生变化。检查 `REPLICA_SOURCE_PATCHES` 并更新对应测试。

### Cloudflare 返回 1101 或 502

检查 Worker 实时日志：

```bash
npx wrangler tail
```

常见原因包括上游不可达、环境变量地址错误、响应超出平台限制或上游主动拒绝 Cloudflare 出口。

## GitHub 发布前检查

- 确认 `.dev.vars` 中没有账号、Token 或其他敏感信息被提交。
- 运行 `npm test` 并确认全部通过。
- 将 README 中的 `<YOUR_...>` 占位符替换为自己的仓库、项目和域名。
- 根据你的发布方式修改 `package.json` 和 `wrangler.jsonc` 中的项目名称。
- 为仓库选择合适的开源许可证；本仓库当前不会自动替你授予上游内容的再分发权。
- 在仓库描述中说明这是非官方项目，并明确上游依赖和内容合规责任。

## 已知限制

- 这是实时代理，不是离线镜像；上游不可用时部署站点也无法正常工作。
- 上游接口、脚本结构或媒体域名变化后，部分功能可能需要同步更新。
- Cloudflare 免费计划存在请求量、CPU 时间和其他平台限制，具体以你的账户和 Cloudflare 当前规则为准。
- 本项目不会绕过登录、付费、地区、年龄验证或其他访问控制。

## 免责声明

本项目与 JavDB、Cloudflare 及上游站点没有官方关联。仓库中的代码不授予任何第三方商标、页面、数据或媒体内容的复制和分发权。使用者应自行承担部署、公开访问、内容合规、版权、隐私和平台条款相关责任。
