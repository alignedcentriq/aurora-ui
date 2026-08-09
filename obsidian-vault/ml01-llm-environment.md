---
name: ml01-llm-environment
description: "ml01 shared Ollama server constraints, model VRAM eviction problem, and current agent model choice"
metadata: 
  node_type: memory
  type: project
  originSessionId: 58529f23-cbb0-4f4b-a303-81804056b98c
---

Centriq AI's LLMs run on a **shared** Ollama server at `ml01.alignedautomation.com:11434` (limited control — cannot install vLLM, env vars need admin signoff).

Key facts learned 2026-06-11:
- GPU cannot hold `gpt-oss:latest` (~13.8GB) alongside the resident set; it gets **evicted to CPU RAM** (`/api/ps` shows `size_vram=0`), making one agent pass take ~45s → timeout → "unable to generate a response" failures.
- Resident-friendly set: `llama3.2:3b` (2.8GB) + `llama3.1:8b` (5.5GB) + `nomic-embed-text` (0.3GB).
- **Agent tier switched to `llama3.1:8b` on 2026-06-11** (user-approved, eval-gated) via runtime config: `python backend/scripts/apply_agent_model.py <model>` — revert with `gpt-oss:latest`. Eval (`backend/scripts/model_eval.py`, results in `backend/scripts/eval_results.json`): all 4 candidates scored 100% tool selection/args; gpt-oss was 2× slower.
- Models pulled on ml01: llama3.1:8b, llama3.2:3b, qwen2.5:7b, qwen2.5:14b, nomic-embed-text, gpt-oss, llama3.3:70b, apertus:8b. User wants **Mistral models** (mistral-nemo:12b, ministral-8b) considered once admin pulls them.
- "Keep gpt-oss warm" plan option is dead — VRAM can't sustain it.

Related: [[centriq-replatform-status]], [[backend-runtime-setup]]
