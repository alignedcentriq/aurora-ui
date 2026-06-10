"""Apply the eval-winning agent model (llama3.1:8b) to the runtime LLM config.

Eval evidence (scripts/eval_results.json, 2026-06-11):
  - llama3.1:8b:  100% tool selection, 100% arg validity, ~3.6s/pass warm with 38 tools
  - gpt-oss:latest: same quality but 44.6s/pass (evicted to CPU on ml01 — 0GB VRAM)

Revert anytime:  python scripts/apply_agent_model.py gpt-oss:latest
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import llm_controls_service as llm_controls

model = sys.argv[1] if len(sys.argv) > 1 else "llama3.1:8b"

new = llm_controls.update_config(
    {"tiers": {"agent": {"model": model}}},
    updated_by="model-eval-2026-06-11",
)
print("agent tier now:", new["tiers"]["agent"])
