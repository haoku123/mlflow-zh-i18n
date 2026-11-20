"""批量把缺失的 en 文案翻译成简体中文（走 GLM 的 Anthropic 兼容接口）。

用法：
  python3 translate.py --limit 20 --batch 20
  python3 translate.py            # 全量，支持断点续跑

需要环境变量：ANTHROPIC_BASE_URL、ANTHROPIC_API_KEY（可选 ANTHROPIC_MODEL）。
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import anthropic

WORK = Path(__file__).resolve().parent
MISSING = WORK / "missing.json"
OUT = WORK / "translations.json"

SYSTEM = """你是专业的软件本地化译者，把 MLflow 机器学习平台的英文 UI 文案翻译成简体中文。

必须遵守：
1. 输出严格 JSON 对象：{"<消息id>": "<中文译文>", ...}，不要 markdown 代码块，不要任何解释。
2. 保留 ICU MessageFormat 语法原样：占位符 {name}、plural/select 结构、# 号、<b></b> 等标签、转义字符，位置可随中文语序调整但不能丢。
3. 保留产品名与技术名词：MLflow、Databricks、Python、API、CLI、SDK、Git、GPU、CPU、JSON、YAML、HTTP、URL、token、prompt、trace、span 等保持英文；专有 UI 概念可意译（如 trace→追踪链路，span→跨度，run→运行，experiment→实验，model→模型，artifact→产物）。
4. 语气简洁专业，符合中文软件界面习惯；按钮/菜单尽量 2-6 字；句末不加英文句号，保留原文的标点风格。
5. 不要翻译已经是中文的内容；纯符号、单位、代码片段、空白字符串保持原样。
6. 译文不得包含换行（原文含换行的用 \\n 表示）。"""


def load_json(p: Path, default):
    if p.is_file():
        return json.loads(p.read_text())
    return default


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=40)
    args = ap.parse_args()

    missing = load_json(MISSING, {})
    done = load_json(OUT, {})
    todo = {k: v for k, v in missing.items() if k not in done}
    if args.limit:
        todo = dict(list(todo.items())[: args.limit])
    print(f"missing={len(missing)} done={len(done)} todo={len(todo)}", flush=True)

    model = os.environ.get("ANTHROPIC_MODEL", "glm-5.3-flash")
    client = anthropic.Anthropic(timeout=180.0, max_retries=2)

    keys = list(todo)
    b = args.batch
    total_batches = (len(keys) + b - 1) // b
    for bi in range(total_batches):
        chunk_keys = keys[bi * b : (bi + 1) * b]
        payload = {k: todo[k] for k in chunk_keys}
        user = json.dumps(payload, ensure_ascii=False)
        t0 = time.time()
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=8000,
                system=SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
            text = "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            result = json.loads(text)
            if not isinstance(result, dict):
                raise ValueError("not a dict")
        except Exception as e:
            print(f"batch {bi+1}/{total_batches} FAILED: {e}", flush=True)
            continue

        added = 0
        for k in chunk_keys:
            v = result.get(k)
            if isinstance(v, str) and v.strip():
                done[k] = v
                added += 1
        OUT.write_text(json.dumps(done, ensure_ascii=False, indent=2))
        print(
            f"batch {bi+1}/{total_batches} ok={added}/{len(chunk_keys)} "
            f"{time.time()-t0:.1f}s total_done={len(done)}",
            flush=True,
        )

    print(f"FINISHED done={len(done)}/{len(missing)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
