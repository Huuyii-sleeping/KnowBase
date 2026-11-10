"""Pure Markdown formatting for recall audit measurements."""


def percentage(value):
    return "N/A" if value is None else f"{value:.2%}"


def render_report(summaries, rows, budgets, selected_budget=None):
    lines = [
        "# 召回逐阶段诊断",
        "",
        "| 问题组 | 每路预算 | 关键词证据 | 向量证据 | 合并证据 | 最终证据 | 合并候选数 | 平均/P95 ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for summary in summaries:
        stages = summary["stages"]
        values = [
            percentage(stages[stage]["evidence_recall"])
            for stage in ("keyword", "semantic", "pool", "selected")
        ]
        lines.append(
            f"| {summary['split']} | {summary['budget_per_route']} | "
            + " | ".join(values)
            + f" | {stages['pool']['mean_candidate_count']:.2f} | {summary['mean_ms']:.2f}/{summary['p95_ms']:.2f} |"
        )
    loss_budget = selected_budget or (15 if 15 in budgets else budgets[0])
    lines += [
        "",
        f"## 每路 {loss_budget} 候选下的证据损失",
        "",
        "| 问题 | 分组 | 阶段 | 来源 |",
        "| --- | --- | --- | --- |",
    ]
    for row in rows:
        if row["budget"] == loss_budget:
            for loss in row["losses"]:
                lines.append(
                    f"| {row['id']} | {row['split']} | {loss['cause']} | {loss['doc']} |"
                )
    lines += [
        "",
        "内部服务 IPC 诊断；真实 HTTP 路径只做一致性抽查。计时包括路由检索与元数据复查，不是生产 HTTP 延迟。无答案只统计候选，不判定问答拒答。合成验证题不是独立盲测。",
        "",
    ]
    return "\n".join(lines)
