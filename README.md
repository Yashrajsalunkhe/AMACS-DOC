# AMACS Field Command v2

An interactive, non-Streamlit demonstration of the [`amacs`](https://github.com/Aditya-padale/amacs) Python package. It models a municipal heatwave response and makes the entire orchestration pipeline **inspectable** — from task decomposition to inter-agent communication.

## What It Demonstrates

| Feature | Without AMACS | With AMACS |
|---------|--------------|------------|
| Architecture | Single LLM call | Multi-agent with orchestrator, specialist agents, shared memory, synthesizer |
| Task handling | Entire prompt in one context | Decomposed into dependency-aware sub-tasks |
| Communication | None | Shared communication bus with message tracing |
| Adaptation | None | Automatic retries, fallbacks, and recovery |
| Output quality | Limited coverage | Comprehensive specialist synthesis |

## Metrics Compared

Both outputs (with and without AMACS) are evaluated against the **same six-signal public-health rubric**:

- **Accuracy** — percentage of rubric signals covered
- **Precision** — ratio of correctly identified signals
- **Recall** — ratio of signals found vs. total rubric signals
- **F1 Score** — harmonic mean of precision and recall
- **Response Time** — milliseconds for each path
- **Token Usage** — prompt, completion, and total tokens
- **Per-Category Coverage** — heatmap showing which signals each path detected

## Communication Bus Visualization

The **Communication Bus** section shows an animated flow diagram of how messages travel between agents:

```
User → Orchestrator → [Specialist Agents] → Shared Memory → Synthesizer → Final Plan
```

- **Architecture Flow**: Node-based diagram with animated particles showing data flow
- **Message Log**: Every message on the bus displayed with sender, receiver, phase label, and content
- **Phase Colors**: Input → Dispatch → Execution → Coordination → Synthesis → Output

## Run it

```bash
# AMACS is published on PyPI; cloning the AMACS repository is not required.
python -m pip install amacs
python -m pip install groq
cp .env.example .env
# Add GROQ_API_KEY to .env for live responses. Leave it empty for offline mode.
python server.py
```

You can also install the demo dependencies together with `python -m pip install -r requirements.txt`.

Open http://localhost:8787.

The in-app documentation is available at http://localhost:8787/docs.html. It covers the AMACS execution model, provider configuration, fallback behavior, metrics, and HTTP endpoints.

## Project Structure

```
amacs demo/
├── server.py          # Python HTTP server + AMACS orchestration + metrics computation
├── web/
│   ├── index.html     # Dashboard layout with architecture diagram, metrics table, comm bus
│   ├── docs.html      # In-app AMACS documentation page
│   ├── styles.css     # Premium CSS with design tokens, animations, responsive layout
│   └── app.js         # Frontend logic: renderers for metrics, heatmap, animated comm bus
├── data/
│   └── runs.json      # Persistent run history (auto-generated)
├── requirements.txt   # Python dependencies (amacs, groq)
├── .env.example       # Environment template
└── README.md          # This file
```

## How AMACS Works (Architecture)

1. **User submits a prompt** (incident brief)
2. **Orchestrator** decomposes the prompt into specialist sub-tasks with dependency ordering
3. **Specialist Agents** (public-health, emergency-operations, community-outreach) execute in dependency-aware waves
4. Agents write results to a **Shared Communication Bus** (shared memory)
5. **Synthesizer** reads all specialist outputs and merges them into a comprehensive final plan
6. The UI displays every step: task decomposition, agent outputs, communication messages, adaptation events, and accuracy metrics

The upstream AMACS project documents the provider contract at https://github.com/Aditya-padale/amacs. This demo intentionally keeps the web layer dependency-free: Python's standard library serves the API and the frontend is plain HTML/CSS/JavaScript.
