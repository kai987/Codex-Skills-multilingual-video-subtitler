# 机器独立生成：有界接缝复核候选

新建 `generate` 默认使用 bounded，并在完整日语结果上执行一次有界接缝复核及文字合并。不使用人工稿或听辨答案；输入必须是完整、已校验且无 unresolved/alias 的 standalone bounded 任务。不是额外整片重跑，也不安装或更换模型。`--no-refine-seams` 关闭该阶段；`--strategy single` 保留旧入口。独立研究命令仍可显式使用：

```sh
npm run build:subtitle-tool
npm run subtitle-tool:refine-seams -- prepare /path/bounded-task /path/new-output
npm run subtitle-tool:refine-seams -- run /path/seam-refinement-XXXXXX --authorize-local-asr
npm run subtitle-tool:refine-seams -- verify /path/seam-refinement-XXXXXX
# 独立可选的文字合并候选；零推理，不修准时间：
npm run subtitle-tool:seam-text-only -- /path/seam-refinement-XXXXXX /path/new-output
# 两条路线均只在冻结后用人工稿评价：
npm run evaluate:subtitle-tool:refine-seams -- /path/candidate-run /path/reference.ass
npm run test:subtitle-tool:refine-seams
```

## 机器选区与预算

从相邻请求实际重叠的 BOUNDARY_AMBIGUITY 记录选择长公共文字，短回应不进入删重；按公共文字长度、源时间确定性排序。将接触的完整原记录纳入区间，过长区间保留不处理。最多 4 处、8 次请求、120 秒，单目标最多 13 秒，两种上下文各 1/2 秒，零重试。所有输入片段来自原任务已哈希校验的 PCM，不按人工稿切片。

先固化计划、片段、模型及软件身份，再排他持久化整轮请求预约。重复执行已冻结结果只做验证；技术失败、进程中断、预约但未完成均不自动追加调用。不删除预约文件以重试。模型执行成功不因内容差而重跑。正常 run 末尾返回的是 verify 的结果，其中 newInference=0 表示最后验证步骤零推理；本轮实际识别次数须读取 plan.requests 和各请求 exit.json，不能把验证字段当作运行总数。

## 两种不同的修订语义

1. `refine-seams`：两种上下文的完整文字、分句和边界一致，并保留外侧文字锚点、不侵入邻句时，生成局部文字/时间候选。触碰请求边缘、文字不一致、时间漂移则不替换。旧稿不变。
2. `seam-text-only`：对同一批冻结证据单独检查。两窗口中必须各有唯一的完整 donor cue 组，正文一致、保留原组首尾锚点、长重复只保留一份且满足文字保留量。只合并整组，**保持旧组外侧起止时间**，不裁切模型子串、不伪造词级时间。模型估计的区间只用于关联目标，不称为正确声学时间。组内分句会合并，展示质量仍须复核。

第二条路线不是把第一条路线的边界判定改成通过：其独立输出明确 timingPolicy=original-outer-envelope-no-acoustic-alignment、acousticTimingVerified=false。两种结果都保留 needs-review / finalizationMethod=none，不能自动认定人工终稿。两次同模型一致不是独立模型投票，可能共同出错。

## 本次真实验证（2026-09-20）

输入：Super no Ura 第 1 集上一轮完整纯机器 bounded 稿，191 条。机器自动选出 4 处，8 次识别全部成功，总请求音频 70.48025 秒，零重试。没有使用人工稿生成、没有重跑整片或启用其他模型。

- 文字加时间路线：4/4 因 donor 接触请求边缘拒绝，未修改字幕。
- 离线文字路线：1/4 通过，合并为 190 条；另外 3 处保留。只改 497.96–502.14 秒的两条原记录，外侧时间不变，无关 189 条逐字段保留。
- 旧文字：`特別に今日はニコニコに会いたい` + `今日はニコチンの力でも借りるか`。
- 两个冻结机器视图都给出：`特別に今日はニコチンの力でも借りるか`。
- 对人工日语 Dialogue + Song 的整片 CER：350/1792 = **19.53%** → 341/1792 = **19.03%**，减少 **0.50 个百分点**，编辑错误相对减少 **2.57%**。这是小幅改善，不是准确率上升 2.57 个百分点。
- S/D/I：112/76/162 → 91/88/162。全局最短编辑对齐的类型分配会改变，不能把它逐字解释为哪些声音被听错。
- 内容警告仍为 11，非法时间为 0。未修复其他模板幻觉、歌词、短回应漏检或时间对齐问题。
- 原始证据与两阶段候选均先冻结，人工稿仅用于随后评分；输出后不按评分调参。已知视频开发回归，不是未见样本盲测。

本次产物位于本地 `output/<run>/`，不随核心源码发布。

默认集成选择文字合并路线作为交付，保留原稿和两条路线的独立证据。`DEFAULT_DELIVERY.md/json` 指明推荐文件、实际调用数或失败原因；仅在有通过的文字修改时推荐新候选。局部范围、部分结果、非日语或未解决基线跳过，失败保留原稿并返回 exit 2。同一基线的排他预约禁止自动重试。`resume/status/audit/recover` 不因默认设置而新增此阶段的推理；中断后可查看独立证据，不自动重置预算。内容审计仍针对原 bounded 稿，不冒充新候选的质量认证。

下一轮价值最高的是识别和隔离缺乏语音支持的模板输出、改善短回应召回；需要新的受限音频证据，不能用人工稿代填。
