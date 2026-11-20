"""批量把缺失的 en 文案翻译成简体中文（GLM Anthropic 兼容接口，多线程 + 断点续跑）。

需要环境变量：ANTHROPIC_BASE_URL、ANTHROPIC_API_KEY（可选 ANTHROPIC_MODEL）。
"""
import argparse
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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

PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:,\s*(?:plural|select|selectordinal))?")

lock = threading.Lock()
done: dict[str, str] = {}


def load_json(p: Path, default):
    if p.is_file():
        return json.loads(p.read_text())
    return default


def flush():
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(done, ensure_ascii=False, indent=2))
    tmp.replace(OUT)


def translate_batch(client, model, items, retries=3):
    user = json.dumps(items, ensure_ascii=False)
    last_err = None
    for attempt in range(retries):
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=8000,
                system=SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            result = json.loads(text)
            if not isinstance(result, dict):
                raise ValueError("not a dict")
            return result
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"batch failed: {last_err}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=30)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    missing = load_json(MISSING, {})
    global done
    done = load_json(OUT, {})
    todo = {k: v for k, v in missing.items() if k not in done}
    keys = list(todo)
    batches = [keys[i : i + args.batch] for i in range(0, len(keys), args.batch)]
    print(f"missing={len(missing)} done={len(done)} todo={len(todo)} batches={len(batches)}", flush=True)
    if not batches:
        return 0

    model = os.environ.get("ANTHROPIC_MODEL", "glm-5.3-flash")
    client = anthropic.Anthropic(timeout=240.0, max_retries=0)

    finished = 0
    t_start = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(translate_batch, client, model, {k: todo[k] for k in b}): b for b in batches
        }
        for fut in as_completed(futs):
            batch = futs[fut]
            finished += 1
            try:
                result = fut.result()
                with lock:
                    for k in batch:
                        v = result.get(k)
                        if isinstance(v, str) and v.strip():
                            done[k] = v
                    flush()
                ok = sum(1 for k in batch if k in done)
                print(
                    f"[{finished}/{len(batches)}] ok={ok}/{len(batch)} "
                    f"total={len(done)} elapsed={time.time()-t_start:.0f}s",
                    flush=True,
                )
            except Exception as e:  # noqa: BLE001
                print(f"[{finished}/{len(batches)}] FAILED ({len(batch)} items): {e}", flush=True)

    print(f"FINISHED done={len(done)}/{len(missing)}", flush=True)

    # 占位符一致性检查
    bad = []
    for k, v in done.items():
        src_ph = set(PLACEHOLDER_RE.findall(missing.get(k, "")))
        dst_ph = set(PLACEHOLDER_RE.findall(v))
        if src_ph != dst_ph:
            bad.append((k, sorted(src_ph), sorted(dst_ph), v[:80]))
    print(f"placeholder mismatches: {len(bad)}", flush=True)
    for row in bad[:20]:
        print("  ", row, flush=True)
    (WORK / "placeholder_mismatch.json").write_text(json.dumps(bad, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
