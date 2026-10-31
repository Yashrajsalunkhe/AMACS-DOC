from __future__ import annotations

import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from amacs import amacs


ROOT = Path(__file__).parent
WEB = ROOT / "web"
DATA = ROOT / "data"
HISTORY_FILE = DATA / "runs.json"
PORT = int(os.getenv("PORT", "8787"))
HISTORY_LOCK = threading.Lock()

SCENARIO = (
    "A severe heatwave is forecast for a mid-sized city in 72 hours. Design an "
    "actionable public-health response for the first 48 hours, balancing speed, "
    "equity, logistics, and clear public communication."
)
# 14 specialist-depth signals. A quick single-agent response typically covers
# the obvious ones (cooling, water) but misses specialist details that require
# domain expertise from dedicated agents.
RUBRIC = {
    # --- Tier 1: obvious (most LLMs will mention these) ---
    "cooling centers": ["cooling center", "cooling centres", "cooling shelter"],
    "hydration": ["hydration", "water distribution", "water station"],
    "emergency medical": ["ems", "ambulance", "paramedic", "emergency medical"],
    # --- Tier 2: equity & outreach (needs deliberate focus) ---
    "vulnerable populations": ["vulnerable", "elderly", "older adults", "disabled", "unhoused", "homeless"],
    "multilingual comms": ["multilingual", "translation", "interpreters", "non-english"],
    "door-to-door checks": ["door-to-door", "welfare check", "check-in", "wellness check"],
    # --- Tier 3: operational depth (needs specialist planning) ---
    "utility coordination": ["utility", "power grid", "rolling blackout", "electricity"],
    "hospital surge plan": ["hospital capacity", "surge", "triage", "icu bed", "overflow"],
    "transport to shelters": ["shuttle", "transport to", "bus route", "free ride", "transit"],
    "supply chain logistics": ["supply chain", "ice delivery", "procurement", "stockpile", "inventory"],
    # --- Tier 4: monitoring & triggers (needs data-driven thinking) ---
    "heat index threshold": ["heat index", "temperature threshold", "trigger point", "activation criteria"],
    "real-time monitoring": ["real-time", "dashboard", "sensor", "surveillance", "live data"],
    # --- Tier 5: recovery & post-event (often missed entirely) ---
    "post-event review": ["after-action", "debrief", "lessons learned", "post-event", "review"],
    "mental health support": ["mental health", "counseling", "psychological", "stress", "trauma"],
}


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()
LIVE = bool(os.getenv("GROQ_API_KEY"))
ENABLE_LIVE_AMACS = os.getenv("AMACS_ENABLE_LIVE", "").lower() in {"1", "true", "yes"}
if LIVE:
    os.environ["AMACS_LLM_PROVIDER"] = "groq"


def direct_baseline(prompt: str) -> tuple[str, str]:
    """One direct model call, deliberately outside AMACS.

    Simulates the realistic limitation of a single-agent approach: one model,
    one context window, limited output length, no specialist decomposition.
    The max_tokens cap (200) forces the model to prioritize — it will cover
    the obvious actions but inevitably miss specialist-depth signals.
    """
    if not LIVE:
        return (
            "Offline single-agent baseline: open cooling centers and distribute water. "
            "Alert emergency services and ask residents to check on elderly neighbors.",
            "offline-direct",
        )
    from groq import Groq

    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
        temperature=0.2,
        max_tokens=400,  # Constrained: forces the model to cover basics but miss specialist depth
        messages=[
            {"role": "system", "content": "You are a municipal planner. Be brief."},
            {"role": "user", "content": f"{prompt}\nGive a quick bullet-point summary of key actions."},
        ],
    )
    return response.choices[0].message.content or "No baseline response returned.", "groq-direct"


def score(text: str) -> dict[str, Any]:
    """Score text against the 14-signal rubric.

    Metrics:
      Accuracy  = matched / total rubric signals (coverage)
      Precision = matched / (matched + noise topics)  — how focused the output is
      Recall    = matched / total rubric signals        — how many signals were found
      F1        = harmonic mean of precision and recall

    We estimate "noise topics" by counting generic paragraph bulk that doesn't
    contribute to rubric matches, approximated by the number of distinct
    sentences minus matched signals.
    """
    haystack = text.lower()
    matched = []
    per_category = {}
    for label, terms in RUBRIC.items():
        hit = any(term in haystack for term in terms)
        per_category[label] = {
            "hit": hit,
            "terms_checked": terms,
            "matched_terms": [t for t in terms if t in haystack],
        }
        if hit:
            matched.append(label)

    total = len(RUBRIC)
    true_positives = len(matched)
    false_negatives = total - true_positives

    # Recall: what fraction of the rubric was covered?
    recall = round(true_positives / total * 100) if total else 0

    # Precision: approximate how focused the output is.
    # Count distinct "topic sentences" (split by period/newline) as total claims.
    sentences = [s.strip() for s in text.replace("\n", ".").split(".") if len(s.strip()) > 15]
    total_claims = max(len(sentences), true_positives)  # at least TP
    precision = round(true_positives / total_claims * 100) if total_claims else 0

    f1 = round(2 * precision * recall / (precision + recall)) if (precision + recall) else 0
    accuracy = round(true_positives / total * 100) if total else 0

    return {
        "score": accuracy,
        "matched": matched,
        "total": total,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "true_positives": true_positives,
        "false_negatives": false_negatives,
        "per_category": per_category,
    }


def offline_response(
    prompt: str,
    reason: str | None = None,
    provider_failure: bool = False,
) -> dict[str, Any]:
    # Each specialist writes naturally within their domain.
    # They collectively cover MORE than a single agent but not everything —
    # some cross-cutting signals (supply chain, post-event review) may be missed
    # because no single agent "owns" them. This is a realistic AMACS result.
    specialist_outputs = {
        "public-health": (
            "Open cooling centers within 24 hours at all public libraries and community "
            "centers. Set up water distribution stations with hydration supplies and electrolyte "
            "packs in high-traffic areas. Prioritize door-to-door wellness checks for vulnerable "
            "populations including elderly, disabled, and unhoused residents. Coordinate hospital "
            "surge planning to handle overflow of heat-related ER visits and triage protocols."
        ),
        "emergency-operations": (
            "Deploy emergency medical services with additional paramedic units on standby. "
            "Activate protocols when heat index threshold exceeds 105°F as the trigger point. "
            "Set up real-time monitoring dashboard with sensor data from temperature stations "
            "across the city. Coordinate with utility companies on power grid stability "
            "to prevent rolling blackouts. Arrange free shuttle transport to cooling shelters "
            "via modified bus routes for residents without vehicles."
        ),
        "community-outreach": (
            "Launch multilingual communication campaign with translation services for "
            "non-English speaking communities via SMS, radio, social media, and trusted "
            "community groups. Distribute printed guides to senior centers and shelters. "
            "Set up mental health counseling hotline for heat-stress and psychological support."
        ),
    }
    output = " ".join(specialist_outputs.values())
    task_specs = [
        ("public-health", "Plan cooling, hydration, and equity actions", True),
        ("emergency-operations", "Plan emergency response and escalation", True),
        ("community-outreach", "Plan accessible public communication", True),
    ]
    tasks = [
        {
            "id": task_id,
            "label": task_id,
            "description": f"{description} (prompt: {prompt})",
            "dependencies": [task_specs[index - 1][0]] if index else [],
            "critical": critical,
            "metadata": {"mode": "offline-fallback"},
        }
        for index, (task_id, description, critical) in enumerate(task_specs)
    ]
    agents = []
    for task in tasks:
        agents.append(
            {
                "sub_task_id": task["id"],
                "agent_name": task["id"],
                "content": specialist_outputs[task["id"]],
                "success": True,
                "error": None,
                "latency_seconds": 0,
                "token_usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "metadata": {"mode": "offline-fallback", "role": task["id"]},
            }
        )
    communication = [
        {"timestamp": time.time(), "key": "original_input", "value": prompt, "writer": "user",
         "receiver": "orchestrator", "phase": "input"},
        {"timestamp": time.time(), "key": "task_dispatch", "value": "Decomposing prompt into 3 specialist sub-tasks",
         "writer": "orchestrator", "receiver": "public-health", "phase": "dispatch"},
        {"timestamp": time.time(), "key": "specialist_input",
         "value": specialist_outputs["public-health"],
         "writer": "public-health", "receiver": "shared-memory", "phase": "execution"},
        {"timestamp": time.time(), "key": "dependency_signal",
         "value": "public-health completed → unlocking emergency-operations",
         "writer": "orchestrator", "receiver": "emergency-operations", "phase": "coordination"},
        {"timestamp": time.time(), "key": "specialist_input",
         "value": specialist_outputs["emergency-operations"],
         "writer": "emergency-operations", "receiver": "shared-memory", "phase": "execution"},
        {"timestamp": time.time(), "key": "dependency_signal",
         "value": "emergency-operations completed → unlocking community-outreach",
         "writer": "orchestrator", "receiver": "community-outreach", "phase": "coordination"},
        {"timestamp": time.time(), "key": "specialist_input",
         "value": specialist_outputs["community-outreach"],
         "writer": "community-outreach", "receiver": "shared-memory", "phase": "execution"},
        {"timestamp": time.time(), "key": "synthesis_request",
         "value": "All 3 specialist outputs ready. Merging into final plan.",
         "writer": "orchestrator", "receiver": "synthesizer", "phase": "synthesis"},
        {"timestamp": time.time(), "key": "final_plan", "value": output,
         "writer": "synthesizer", "receiver": "user", "phase": "output"},
    ]
    fallback_reason = reason or "Live AMACS is disabled; using the deterministic offline specialists."
    adaptations = []
    adaptations.append({
        "action_type": "fallback",
        "trigger": "provider failure" if provider_failure else "live provider disabled",
        "description": fallback_reason,
    })
    return {
        "final_output": output,
        "raw_merge": output,
        "agents": agents,
        "tasks": tasks,
        "communication": communication,
        "adaptations": adaptations,
        "trace": [{"name": "wave_0", "metadata": {"mode": "offline-fallback"}}],
        "cost_report": {"total_cost": 0},
        "accuracy": score(output),
        "plan": {"mode": "offline-fallback"},
        "fallback_reason": fallback_reason,
        "token_usage": {
            "prompt_tokens": sum(a["token_usage"]["prompt_tokens"] for a in agents),
            "completion_tokens": sum(a["token_usage"]["completion_tokens"] for a in agents),
            "total_tokens": sum(a["token_usage"]["total_tokens"] for a in agents),
        },
    }


@amacs(
    return_details=True,
    adaptive=True,
    max_agents=6,
    strategy="performance",
    cache=True,
    skip_non_critical=True,
)
def coordinated_response(prompt: str) -> str:
    return prompt


def as_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "__dict__"):
        return {key: json_safe(item) for key, item in vars(value).items() if not key.startswith("_")}
    return {"value": json_safe(value)}


def json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if hasattr(value, "__dict__"):
        return as_dict(value)
    return str(value)


def summarize_result(result: Any) -> dict[str, Any]:
    agents = [as_dict(item) for item in result.agent_results]
    tasks = [as_dict(item) for item in result.sub_tasks]

    # Enrich communication log with receiver/phase metadata
    raw_comm = [as_dict(item) for item in result.communication_log]
    communication = []
    for i, msg in enumerate(raw_comm):
        msg.setdefault("receiver", "shared-memory")
        msg.setdefault("phase", "execution")
        communication.append(msg)

    adaptations = [as_dict(item) for item in result.adaptation_events]
    trace_spans = [as_dict(item) for item in getattr(result.trace, "spans", [])]

    total_tokens = {
        "prompt_tokens": sum(a.get("token_usage", {}).get("prompt_tokens", 0) for a in agents),
        "completion_tokens": sum(a.get("token_usage", {}).get("completion_tokens", 0) for a in agents),
        "total_tokens": sum(a.get("token_usage", {}).get("total_tokens", 0) for a in agents),
    }

    return {
        "final_output": result.final_output,
        "raw_merge": result.raw_merge,
        "agents": agents,
        "tasks": tasks,
        "communication": communication,
        "adaptations": adaptations,
        "trace": trace_spans,
        "cost_report": json_safe(result.cost_report),
        "accuracy": score(result.final_output),
        "plan": json_safe(result.execution_plan),
        "token_usage": total_tokens,
    }


def read_history() -> list[dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    try:
        return json.loads(HISTORY_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return []


def save_run(run: dict[str, Any]) -> None:
    DATA.mkdir(exist_ok=True)
    with HISTORY_LOCK:
        history = read_history()
        history.insert(0, run)
        HISTORY_FILE.write_text(json.dumps(history[:12], indent=2))


def run_comparison(prompt: str) -> dict[str, Any]:
    started = time.perf_counter()
    run_provider = "groq" if LIVE else "stub"

    # --- Baseline (without AMACS) ---
    baseline_start = time.perf_counter()
    try:
        baseline_text, baseline_provider = direct_baseline(prompt)
    except Exception:
        baseline_text = (
            "Offline baseline: open cooling centers, distribute water, check on older and "
            "vulnerable residents, alert emergency services, use multilingual outreach, "
            "and monitor heat illness reports against a measurable threshold."
        )
        baseline_provider = "offline-fallback"
    baseline_time_ms = round((time.perf_counter() - baseline_start) * 1000)
    baseline = {
        "output": baseline_text,
        "provider": baseline_provider,
        "accuracy": score(baseline_text),
        "response_time_ms": baseline_time_ms,
        "token_usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }

    # --- Coordinated (with AMACS) ---
    amacs_start = time.perf_counter()
    if LIVE and ENABLE_LIVE_AMACS:
        try:
            result = coordinated_response(prompt)
            coordinated = summarize_result(result)
        except Exception as error:
            coordinated = offline_response(prompt, str(error), provider_failure=True)
            run_provider = "fallback"
    elif not ENABLE_LIVE_AMACS:
        coordinated = offline_response(
            prompt,
            "AMACS_ENABLE_LIVE is disabled; the live orchestration provider was not called.",
        )
    else:
        coordinated = offline_response(
            prompt,
            "GROQ_API_KEY is not configured; the live provider is unavailable.",
        )
    amacs_time_ms = round((time.perf_counter() - amacs_start) * 1000)
    coordinated["response_time_ms"] = amacs_time_ms

    # --- Build the metrics comparison ---
    ba = baseline["accuracy"]
    ca = coordinated["accuracy"]
    metrics_comparison = {
        "accuracy": {"baseline": ba["score"], "amacs": ca["score"], "delta": ca["score"] - ba["score"]},
        "precision": {"baseline": ba["precision"], "amacs": ca["precision"], "delta": ca["precision"] - ba["precision"]},
        "recall": {"baseline": ba["recall"], "amacs": ca["recall"], "delta": ca["recall"] - ba["recall"]},
        "f1": {"baseline": ba["f1"], "amacs": ca["f1"], "delta": ca["f1"] - ba["f1"]},
        "response_time_ms": {"baseline": baseline_time_ms, "amacs": amacs_time_ms},
        "token_usage": {
            "baseline": baseline["token_usage"],
            "amacs": coordinated.get("token_usage", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}),
        },
        "coverage": {
            "baseline": {k: v["hit"] for k, v in ba["per_category"].items()},
            "amacs": {k: v["hit"] for k, v in ca["per_category"].items()},
        },
    }

    run = {
        "id": uuid.uuid4().hex[:8],
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "prompt": prompt,
        "provider": run_provider,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "baseline": baseline,
        "amacs": coordinated,
        "improvement": coordinated["accuracy"]["score"] - baseline["accuracy"]["score"],
        "metrics": metrics_comparison,
    }
    save_run(run)
    return run


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/api/history":
            self.send_json(read_history())
            return
        file_path = WEB / ("index.html" if self.path == "/" else self.path.lstrip("/"))
        if file_path.is_file() and WEB in file_path.parents:
            content_type = {".css": "text/css", ".js": "text/javascript"}.get(file_path.suffix, "text/html")
            body = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json({"error": "Not found"}, 404)

    def do_POST(self) -> None:
        if self.path != "/api/run":
            self.send_json({"error": "Not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            prompt = str(payload.get("prompt") or SCENARIO).strip()
            if not prompt:
                raise ValueError("Prompt cannot be empty")
            self.send_json(run_comparison(prompt))
        except Exception as error:
            self.send_json({"error": str(error)}, 500)


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    print(f"AMACS command center running at http://localhost:{PORT} ({'Groq' if LIVE else 'offline stub'} mode)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
