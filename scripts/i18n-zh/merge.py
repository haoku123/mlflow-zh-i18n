"""合并翻译：en 的 key 全集 + 旧 zh 命中项 + 新机器翻译 → zh-CN.merged.json

用法：先执行 `yarn i18n` 生成 src/lang/default/en.json，再运行本脚本。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "src/lang"
WORK = Path(__file__).resolve().parent

en = json.loads((BASE / "default/en.json").read_text())
zh_old = json.loads((BASE / "zh-CN.json").read_text())
new = json.loads((WORK / "translations.json").read_text())

merged = {}
missing = []
reused = 0
for k, v in en.items():
    text = v.get("defaultMessage")
    if text is None:
        continue
    old = zh_old.get(k)
    if isinstance(old, dict):
        old = old.get("defaultMessage")
    if isinstance(old, str) and old.strip():
        merged[k] = old
        reused += 1
    elif k in new and isinstance(new[k], str) and new[k].strip():
        merged[k] = new[k]
    else:
        merged[k] = text  # 兜底：英文原文，保证 key 全覆盖
        missing.append(k)

# 手动补充的显式 id（不在 en 提取结果里，例如欢迎轮播）
extra = {
    k: v
    for k, v in new.items()
    if k not in merged and (k.startswith("mlflow.") or k.startswith("admin."))
}
merged.update(extra)

# 保留旧 zh 中仍被引用的额外 key？不保留，避免脏数据
out = WORK / "zh-CN.merged.json"
out.write_text(json.dumps(merged, ensure_ascii=False, indent=2))
print(f"en total={len(en)} merged={len(merged)} reused_old={reused} from_mt={len(merged)-reused-len(missing)-len(extra)} fallback_en={len(missing)} extra={len(extra)}")
(WORK / "fallback_en.json").write_text(json.dumps({k: en[k]["defaultMessage"] for k in missing}, ensure_ascii=False, indent=2))
