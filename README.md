# RAZ 词库 · AA–Z2（Anki 复现）

复现 [Anki 记忆卡商店 · RAZ 全套 AA-Z2 单词美音版](https://file.ankichinas.cn/h5/card/62d65fa0acdacScy) 的**词库学习部分**：把 12,918 张 Anki 卡片背后的牌组结构与模板，做成了一个原生 JS、零构建、可离线使用的移动优先 Web 应用。

- 背诵模式：看单词 + 音标 → 翻面看词性、例句、图片
- 听写模式：看释义/听例句 → 拼写单词，逐字母对错提示
- 浏览 / 搜索 / 级别筛选 / 词性色标 / 剑桥词典释义
- 基于间隔重复的学习队列（忘记 / 一般 / 掌握），本地统计与连续天数
- 深色模式、发音按钮、底部弹层词卡
- 数据规模：内置 20 张公开预览卡；可选生成覆盖 29 个级别的 6,459 词近似词库（ECDICT 词频排序，非官方分级）

> 内容版权归原作者与 RAZ（Reading A-Z）所有。本仓库只内置商店**公开预览的 20 张卡**用于技术演示；完整牌组请在商店购买后，用自己合法导出的 `.apkg` 导入（见下文），请勿分发牌组内容。若拿不到原牌组，也可以用公开词频数据生成**近似分级词库**（见「多级别近似词库」），它不是官方 RAZ 分级。

## 快速开始

方式一：直接用浏览器打开 `index.html`（`file://` 即可运行；词典懒加载与本地媒体不可用，其余功能正常）。

方式二（推荐）：起一个本地静态服务。

```bash
node tools/serve.mjs --open          # 默认 http://localhost:8123/
node tools/serve.mjs --port 9000     # 指定端口
```

Windows 下可直接双击 `start.cmd`。

要求：Node.js ≥ 20（仅 `tools/serve.mjs` 与导入工具需要；页面本身不需要 Node）。

## 使用说明

- 底部四个标签：**词库 / 学习 / 浏览 / 统计**；右上角齿轮进入设置。
- 学习页先选「背诵」或「听写」，再选级别。点击卡片（或按空格）翻面，然后选择掌握程度。
- 听写页输入答案后回车判定：正确自动翻面，错误可继续修改。
- 学习记录保存在浏览器 `localStorage` 的 `raz.srs.v1` 中，换浏览器/清缓存会丢失。
- 设置页可切换深色模式、调整每日新卡上限、重置学习进度。

## 目录结构

```
anki-raz-vocab/
├─ index.html                # 应用外壳
├─ start.cmd                 # Windows 一键启动本地服务
├─ assets/
│  ├─ css/app.css
│  └─ js/
│     ├─ data.js             # 由 tools/build-data.mjs 生成（不要手改）
│     ├─ card-render.js      # 卡片正面/背面/详情渲染
│     ├─ srs.js              # 间隔重复与本地统计
│     └─ app.js              # 路由、四个视图、弹层层
├─ data/
│  ├─ deck.json              # 牌组元数据（来自商店公开接口）
│  ├─ words.seed.json        # 20 张公开预览卡
│  ├─ words.approx.json      # （可选）词频近似生成的多级别词库
│  ├─ words.full.json        # （可选）导入自有牌组后生成，优先于 approx/seed
│  ├─ deck.imported.json     # （可选）导入牌组的元数据
│  ├─ sources/ecdict.csv     # （可选）ECDICT 原始数据，不提交
│  ├─ dict/<LEVEL>.json      # 词典 HTML，按级别懒加载
│  └─ media/                 # （可选）从 apkg 提取的图片/音频
└─ tools/
   ├─ extract-public.mjs     # 拉取商店公开数据（20 张预览卡 + 模板/CSS）
   ├─ fetch-ecdict.mjs       # 下载 ECDICT（MIT）词库
   ├─ build-approx.mjs       # 按词频生成 29 级近似词库
   ├─ import-apkg.mjs        # 导入自己合法导出的 .apkg
   ├─ build-data.mjs         # 打包 assets/js/data.js + data/dict/*.json
   ├─ serve.mjs              # 零依赖静态服务器
   └─ lib/normalize.mjs      # 字段归一化 / 级别映射 / 词性色标
```

## 数据管线

### 1. 公开数据（默认）

```bash
node tools/extract-public.mjs   # -> data/deck.json, data/words.seed.json
node tools/build-data.mjs       # -> assets/js/data.js, data/dict/AA.json
```

商店接口只公开 20 张预览卡；`deck.json` 中的级别数量与总卡数（12,918 / 6,459）来自真实的牌组树，因此首页会显示完整规模，但可学习内容仅限已导入的卡片。

### 2. 多级别近似词库（无需购买）

公开接口只有 20 张预览卡，官方完整牌组需要购买。若想先拥有多级别可学习内容，可以用 MIT 许可的 [ECDICT](https://github.com/skywind3000/ECDICT) 生成一套近似词库：

```bash
node tools/fetch-ecdict.mjs     # 下载约 66 MB 到 data/sources/ecdict.csv
node tools/build-approx.mjs     # -> data/words.approx.json（约 6,459 词，29 级）
node tools/build-data.mjs
```

- 做法：剔除功能词/停用词和无中文释义的词，按 ECDICT 词频（`frq`/`bnc`）排序，再按真实牌组的各级卡片数量（AA 430 … Z2 220）依次装入；20 张公开预览卡保留在 AA。
- **级别划分是近似，不是官方 RAZ 分级**：RAZ 按绘本难度分级，词频只能粗略对应。要精确内容仍需导入自己购买的 `.apkg`。
- 音标取自 ECDICT `phonetic`；释义取前 4 行中文并保留词性色标；无例句、图片、音频，发音按钮自动回退到浏览器 TTS。
- 音标是 ECDICT 的旧式 DJ 记法，脚本已把 `ә`→`ə`、`.`→次重音、`:`→`ː`，但与预览卡的现代 IPA 仍可能有细微差异。
- 想换用别的词表：直接编辑 `data/words.approx.json`（结构同 `words.seed.json`），或把自己的 CSV 转成同一结构后再执行 `build-data.mjs`。
- 优先级：`words.full.json` > `words.approx.json` > `words.seed.json`。

### 3. 导入自己购买的完整牌组

1. 在 Anki 桌面版中导出牌组：**导出 → Anki 牌组包 (.apkg)**，勾选「支持旧版 Anki / Support older Anki versions」（`.anki21b` zstd 格式暂不支持）。
2. 导入并重建：

```bash
node tools/import-apkg.mjs "D:/decks/RAZ.apkg"
node tools/build-data.mjs
```

- `--deck "背诵"` 只导入名称包含该片段的顶层牌组（默认优先「背诵」牌组）。
- 输出：`data/words.full.json`、`data/deck.imported.json`、`data/media/*`；`build-data.mjs` 会自动优先使用 `words.full.json`。
- 字段按名称映射（word / chn / symbol / photo / photosen / ssound / audio / Dictionary 等），与内置预览卡使用同一数据结构。
- 导入过程只在项目 `data/` 目录内写入。

刷新页面即可看到完整词库；首页数据来源会标记为 `full`。

### 4. 字典

`data/dict/<LEVEL>.json` 保存剑桥词典 HTML，由 `build-data.mjs` 生成，应用在词卡弹层里按需 `fetch`。通过 `file://` 打开时该请求会被浏览器拦截，词卡仍可正常显示，只是没有词典区块。

## 数据格式（摘要）

```jsonc
// assets/js/data.js
window.RAZ_DATA = {
  meta: { title, cardId, source: "seed" | "approx" | "full", totalWords, builtAt,
          levelOrder, levelCounts, decks, model: { name, fields } },
  words: [{ id, grade, word, chn, ipa, note, images, wordAudio, sentAudio, sentHtml }]
};
```

- `grade` 为对外显示的级别（`0AA` 归一化为 `AA`）。
- `chn` 中的词性已包成 `<a class="pos-tag">`，颜色沿用原牌组模板的映射。
- 例句 `sentHtml` 内含高亮目标词与中英对照。

## 备注与排错

- **发音/图片缺失**：公开预览卡不含媒体文件，应用用占位图代替；导入完整牌组后会自动使用 `data/media/` 中的真实资源。
- **`.anki21b` 报错**：新版 Anki 默认导出 zstd 压缩格式，请按上面第 1 步改用旧版格式重新导出。
- **端口占用**：`node tools/serve.mjs --port 8124`。
- **学习进度重置**：设置页「重置学习进度」，或在浏览器控制台执行 `localStorage.removeItem('raz.srs.v1')`。
