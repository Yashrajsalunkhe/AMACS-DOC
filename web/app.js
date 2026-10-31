const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>'"]/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])
  );

/* ── History ── */
function renderHistory(history) {
  $('history').innerHTML = history.length
    ? history
        .map(
          (run) =>
            `<button class="history-row" data-prompt="${escapeHtml(run.prompt)}">
              <span class="history-time">${escapeHtml(run.created_at)}</span>
              <span>${escapeHtml(run.prompt.slice(0, 94))}</span>
              <b>${run.amacs.accuracy.score}%</b>
            </button>`
        )
        .join('')
    : '<div class="empty">No runs yet. Your first comparison will be stored here.</div>';
  document.querySelectorAll('.history-row').forEach((row) =>
    row.addEventListener('click', () => {
      $('prompt').value = row.dataset.prompt;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );
}

/* ── Metrics Table ── */
function renderMetricsTable(metrics) {
  if (!metrics) return;
  const rows = [
    { label: 'Accuracy', baseline: `${metrics.accuracy.baseline}%`, amacs: `${metrics.accuracy.amacs}%`, delta: metrics.accuracy.delta, unit: '%', max: 100 },
    { label: 'Precision', baseline: `${metrics.precision.baseline}%`, amacs: `${metrics.precision.amacs}%`, delta: metrics.precision.delta, unit: '%', max: 100 },
    { label: 'Recall', baseline: `${metrics.recall.baseline}%`, amacs: `${metrics.recall.amacs}%`, delta: metrics.recall.delta, unit: '%', max: 100 },
    { label: 'F1 Score', baseline: `${metrics.f1.baseline}%`, amacs: `${metrics.f1.amacs}%`, delta: metrics.f1.delta, unit: '%', max: 100 },
    { label: 'Response Time', baseline: `${metrics.response_time_ms.baseline}ms`, amacs: `${metrics.response_time_ms.amacs}ms`, delta: null, unit: 'ms' },
    { label: 'Total Tokens', baseline: `${metrics.token_usage.baseline.total_tokens}`, amacs: `${metrics.token_usage.amacs.total_tokens}`, delta: null, unit: '' },
  ];

  $('metricsBody').innerHTML = rows
    .map((row) => {
      let deltaHtml = '';
      if (row.delta !== null && row.delta !== undefined) {
        const cls = row.delta > 0 ? 'delta-positive' : row.delta < 0 ? 'delta-negative' : 'delta-neutral';
        deltaHtml = `<span class="metric-delta ${cls}">${row.delta > 0 ? '+' : ''}${row.delta}${row.unit}</span>`;
      } else {
        deltaHtml = '<span class="metric-delta delta-neutral">—</span>';
      }
      const bBar = row.max ? `<span class="metric-bar metric-bar-baseline" style="width:${(parseInt(row.baseline) / row.max) * 60}px"></span>` : '';
      const aBar = row.max ? `<span class="metric-bar metric-bar-amacs" style="width:${(parseInt(row.amacs) / row.max) * 60}px"></span>` : '';
      return `<tr>
        <td><span class="metric-name">${escapeHtml(row.label)}</span></td>
        <td><span class="metric-value">${escapeHtml(row.baseline)}</span>${bBar}</td>
        <td><span class="metric-value">${escapeHtml(row.amacs)}</span>${aBar}</td>
        <td>${deltaHtml}</td>
      </tr>`;
    })
    .join('');
}

/* ── Coverage Heatmap ── */
function renderCoverageHeatmap(metrics) {
  if (!metrics || !metrics.coverage) return;
  const categories = Object.keys(metrics.coverage.baseline);
  const headerRow = `<div class="heatmap-header">Signal</div><div class="heatmap-header">Without AMACS</div><div class="heatmap-header">With AMACS</div>`;
  const rows = categories
    .map((cat) => {
      const bHit = metrics.coverage.baseline[cat];
      const aHit = metrics.coverage.amacs[cat];
      const bClass = bHit ? 'heatmap-hit' : 'heatmap-miss';
      const aClass = aHit ? 'heatmap-hit' : 'heatmap-miss';
      const bIcon = bHit ? '<span class="heatmap-icon heatmap-icon-hit">✓</span>' : '<span class="heatmap-icon heatmap-icon-miss">✗</span>';
      const aIcon = aHit ? '<span class="heatmap-icon heatmap-icon-hit">✓</span>' : '<span class="heatmap-icon heatmap-icon-miss">✗</span>';
      return `<div class="heatmap-label">${escapeHtml(cat)}</div><div class="heatmap-cell ${bClass}">${bIcon} ${bHit ? 'DETECTED' : 'MISSING'}</div><div class="heatmap-cell ${aClass}">${aIcon} ${aHit ? 'DETECTED' : 'MISSING'}</div>`;
    })
    .join('');
  $('coverageHeatmap').innerHTML = headerRow + rows;
}

/* ── Mini Metrics in Score Cards ── */
function renderMiniMetrics(containerId, accuracy) {
  const el = $(containerId);
  if (!el || !accuracy) return;
  el.innerHTML = `
    <div class="mini-metric"><span class="mini-metric-label">Precision</span><span class="mini-metric-value">${accuracy.precision}%</span></div>
    <div class="mini-metric"><span class="mini-metric-label">Recall</span><span class="mini-metric-value">${accuracy.recall}%</span></div>
    <div class="mini-metric"><span class="mini-metric-label">F1 Score</span><span class="mini-metric-value">${accuracy.f1}%</span></div>
  `;
}

/* ── Communication Bus — SVG Graph Diagram ── */
function renderCommunicationBus(messages) {
  const container = $('commBus');
  if (!container) return;

  const nodeType = (name) => {
    if (!name) return 'agent';
    const n = name.toLowerCase();
    if (n === 'user' || n === 'offline') return 'user';
    if (n === 'orchestrator' || n === 'amacs-orchestrator') return 'orch';
    if (n === 'synthesizer' || n === 'amacs-synthesizer') return 'synth';
    if (n === 'final-plan') return 'output';
    if (n === 'shared-memory') return 'memory';
    return 'agent';
  };

  const nodeColors = {
    user: { bg: '#17231f', text: '#d8f36b', border: '#17231f' },
    orch: { bg: '#195a48', text: '#ffffff', border: '#195a48' },
    agent: { bg: '#ec805a', text: '#ffffff', border: '#ec805a' },
    memory: { bg: '#5a9dec', text: '#ffffff', border: '#5a9dec' },
    synth: { bg: '#195a48', text: '#d8f36b', border: '#d8f36b' },
    output: { bg: '#d8f36b', text: '#17231f', border: '#195a48' },
  };
  const nodeIcons = { user: '👤', orch: '⚙', agent: '✣', memory: '⬡', synth: '◆', output: '✓' };
  const nodeLabel = (name) => name ? name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Unknown';
  const phaseColors = { input: '#17231f', dispatch: '#195a48', execution: '#ec805a', coordination: '#5a9dec', synthesis: '#d8f36b', output: '#195a48' };

  const writers = [...new Set(messages.map(m => m.writer))];
  const receivers = [...new Set(messages.map(m => m.receiver).filter(Boolean))];
  const allNodeNames = [...new Set([...writers, ...receivers])];
  const agents = allNodeNames.filter(n => nodeType(n) === 'agent');

  // Graph positions — hub-and-spoke
  const W = 900, H = 440, nodeR = 30;
  const pos = {};
  pos['user'] = { x: 80, y: H / 2 - 20 };
  pos['orchestrator'] = { x: 280, y: H / 2 - 20 };
  pos['shared-memory'] = { x: 540, y: H / 2 + 100 };
  pos['synthesizer'] = { x: 720, y: H / 2 - 20 };
  pos['final-plan'] = { x: 820, y: H / 2 + 150 };

  const agentSpacing = Math.min(170, 450 / Math.max(agents.length, 1));
  const agentStartX = 280 + agentSpacing / 2;
  agents.forEach((name, i) => { pos[name] = { x: agentStartX + i * agentSpacing, y: H / 2 - 160 }; });

  // Build edges from messages
  const edges = messages.map((msg, i) => ({
    from: msg.writer || 'user',
    to: msg.phase === 'output' && msg.receiver === 'user' ? 'final-plan' : (msg.receiver || 'shared-memory'),
    key: msg.key, phase: msg.phase || 'execution', index: i,
  }));

  // SVG defs — arrowheads per phase
  let defs = '<defs>';
  for (const [phase, color] of Object.entries(phaseColors)) {
    defs += `<marker id="ah-${phase}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="${color}" opacity="0.7"/></marker>`;
  }
  defs += '</defs>';

  // Draw edges with animated particles
  let edgeSvg = '';
  edges.forEach((edge, i) => {
    const from = pos[edge.from] || pos['orchestrator'];
    const to = pos[edge.to] || pos['shared-memory'];
    const color = phaseColors[edge.phase] || '#9da9a3';
    const id = `ep-${i}`;
    const dx = to.x - from.x, dy = to.y - from.y;
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const offset = ((i % 3) - 1) * 22;
    const cx = mx + (-dy / len) * offset, cy = my + (dx / len) * offset;

    edgeSvg += `<path id="${id}" d="M${from.x},${from.y} Q${cx},${cy} ${to.x},${to.y}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.35" marker-end="url(#ah-${edge.phase})"/>`;
    edgeSvg += `<circle r="4" fill="${color}" opacity="0.9"><animateMotion dur="${1.8 + i * 0.25}s" repeatCount="indefinite" begin="${i * 0.5}s"><mpath href="#${id}"/></animateMotion></circle>`;
    edgeSvg += `<circle r="8" fill="${color}" opacity="0.15"><animateMotion dur="${1.8 + i * 0.25}s" repeatCount="indefinite" begin="${i * 0.5}s"><mpath href="#${id}"/></animateMotion></circle>`;
  });

  // Draw nodes
  let nodeSvg = '';
  const drawn = new Set();
  ['user', 'orchestrator', ...agents, 'shared-memory', 'synthesizer', 'final-plan'].forEach(name => {
    if (drawn.has(name) || !pos[name]) return;
    drawn.add(name);
    const p = pos[name], type = nodeType(name), c = nodeColors[type];
    nodeSvg += `<g class="graph-node"><circle cx="${p.x}" cy="${p.y}" r="${nodeR + 5}" fill="none" stroke="${c.border}" stroke-width="2" stroke-opacity="0.25"><animate attributeName="r" values="${nodeR + 5};${nodeR + 8};${nodeR + 5}" dur="3s" repeatCount="indefinite"/></circle>`;
    nodeSvg += `<circle cx="${p.x}" cy="${p.y}" r="${nodeR}" fill="${c.bg}" stroke="${c.border}" stroke-width="2.5"/>`;
    nodeSvg += `<text x="${p.x}" y="${p.y + 5}" text-anchor="middle" fill="${c.text}" font-size="16">${nodeIcons[type]}</text>`;
    nodeSvg += `<text x="${p.x}" y="${p.y + nodeR + 18}" text-anchor="middle" fill="#17231f" font-family="Space Grotesk,sans-serif" font-weight="600" font-size="10">${escapeHtml(nodeLabel(name).toUpperCase())}</text>`;
    nodeSvg += `<text x="${p.x}" y="${p.y + nodeR + 30}" text-anchor="middle" fill="#75807b" font-family="DM Mono,monospace" font-size="7" letter-spacing="0.08em">${type.toUpperCase()}</text></g>`;
  });

  const svgHtml = `<div class="graph-container"><svg viewBox="0 0 ${W} ${H + 40}" class="comm-graph-svg">${defs}${edgeSvg}${nodeSvg}</svg></div>`;

  // Legend
  const legendHtml = `<div class="comm-legend"><span style="font-weight:600">NODES:</span>
    <div class="comm-legend-item"><span class="comm-legend-dot legend-user"></span> User</div>
    <div class="comm-legend-item"><span class="comm-legend-dot legend-orch"></span> Orchestrator</div>
    <div class="comm-legend-item"><span class="comm-legend-dot legend-agent"></span> Specialist</div>
    <div class="comm-legend-item"><span class="comm-legend-dot legend-memory"></span> Shared Memory</div>
    <div class="comm-legend-item"><span class="comm-legend-dot legend-synth"></span> Synthesizer</div>
    <div class="comm-legend-item"><span class="comm-legend-dot legend-output"></span> Final Plan</div>
  </div>`;
  const phaseLegend = `<div class="comm-legend" style="margin-top:6px"><span style="font-weight:600">EDGE PHASES:</span>
    ${Object.entries(phaseColors).map(([p, c]) => `<div class="comm-legend-item"><span class="comm-legend-dot" style="background:${c}${p === 'synthesis' ? ';border:1px solid #195a48' : ''}"></span> ${p}</div>`).join('')}
  </div>`;

  // Message log
  const shortText = (v) => String(v ?? '').replace(/\n/g, ' ').slice(0, 140);
  let logHtml = '<div class="comm-flow-list">';
  logHtml += `<div class="comm-flow-header"><span>Step</span><span>From</span><span></span><span>To</span><span>Message</span></div>`;
  messages.forEach((msg, idx) => {
    const from = msg.writer || 'unknown', to = msg.receiver || 'shared-memory';
    const phase = msg.phase || 'execution', pc = phaseColors[phase] || '#9da9a3';
    logHtml += `<div class="comm-flow-item" style="--flow-delay:${idx * 100}ms">
      <div class="comm-flow-step-num">${String(idx + 1).padStart(2, '0')}</div>
      <div class="comm-flow-from">${escapeHtml(from)}</div>
      <div class="comm-flow-arrow" style="color:${pc}">→</div>
      <div class="comm-flow-to">${escapeHtml(to)}</div>
      <div class="comm-flow-body"><span class="comm-flow-key">${escapeHtml(msg.key)}</span><span class="comm-flow-phase phase-${phase}">${escapeHtml(phase)}</span><p class="comm-flow-text">${escapeHtml(shortText(msg.value))}</p></div>
    </div>`;
  });
  logHtml += '</div>';

  const captionHtml = `<div class="comm-caption"><span class="comm-caption-dot"></span> Animated particles travel along edges showing real-time message flow between agents. The graph shows the actual routing topology of the AMACS communication bus.</div>`;
  container.innerHTML = legendHtml + phaseLegend + svgHtml + logHtml + captionHtml;
}

/* ── Main Run Renderer ── */
function renderRun(run) {
  const amacs = run.amacs;

  // Provider label
  $('providerLabel').textContent =
    run.provider === 'groq' ? 'GROQ / LIVE' : run.provider === 'fallback' ? 'OFFLINE FALLBACK' : 'OFFLINE STUB';

  // Score cards
  $('baselineProvider').textContent = run.baseline.provider.toUpperCase();
  $('baselineScore').textContent = `${run.baseline.accuracy.score}%`;
  $('amacsScore').textContent = `${amacs.accuracy.score}%`;
  const improvement = Number(run.improvement ?? amacs.accuracy.score - run.baseline.accuracy.score);
  $('improvementScore').textContent = `${improvement >= 0 ? '+' : ''}${improvement}%`;
  $('baselineMeter').style.width = `${run.baseline.accuracy.score}%`;
  $('amacsMeter').style.width = `${amacs.accuracy.score}%`;
  $('runMeta').textContent = `${run.id} · ${run.duration_ms}ms`;

  // Mini metrics in score cards
  renderMiniMetrics('baselineMetricsMini', run.baseline.accuracy);
  renderMiniMetrics('amacsMetricsMini', amacs.accuracy);

  // Metrics comparison table
  renderMetricsTable(run.metrics);

  // Coverage heatmap
  renderCoverageHeatmap(run.metrics);

  // Task map
  $('taskCount').textContent = `${amacs.tasks.length} TASKS / ${new Set(amacs.trace.filter((x) => x.name?.startsWith('wave_')).map((x) => x.name)).size} WAVES`;
  const agentNames = [...new Set(amacs.agents.map((agent) => agent.agent_name))];
  $('agentCount').textContent = `${agentNames.length} AGENTS`;
  $('teamCount').textContent = `${agentNames.length} ACTIVE`;
  $('messageCount').textContent = `${amacs.communication.length} MESSAGES`;
  $('adaptCount').textContent = `${amacs.adaptations.length} EVENTS`;

  $('taskMap').innerHTML = amacs.tasks
    .map(
      (task, index) =>
        `<div class="task-node">
          <span class="task-number">${String(index + 1).padStart(2, '0')}</span>
          <div><b>${escapeHtml(task.label || task.id)}</b><small>${escapeHtml(task.description || '')}</small></div>
          <span class="task-state">${task.critical ? 'CRITICAL' : 'OPTIONAL'}</span>
        </div>`
    )
    .join('');

  // Agent outputs
  $('agents').innerHTML = amacs.agents
    .map(
      (agent) =>
        `<details class="agent">
          <summary>
            <span class="agent-name">${escapeHtml(agent.agent_name)}</span>
            <span>${agent.success ? 'SUCCESS' : 'FAILED'}</span>
            <span>${Number(agent.latency_seconds || 0).toFixed(2)}s</span>
          </summary>
          <p>${escapeHtml(agent.content)}</p>
        </details>`
    )
    .join('');

  // Agent team
  const roleDescriptions = {
    'public-health': 'Cooling centers, hydration, and vulnerable residents',
    'emergency-operations': 'EMS coordination, monitoring, and escalation triggers',
    'community-outreach': 'Multilingual communication and public access',
  };
  $('agentTeam').innerHTML = agentNames
    .map((name) => {
      const agent = amacs.agents.find((item) => item.agent_name === name);
      const task = amacs.tasks.find((item) => item.id === agent?.sub_task_id);
      const role = roleDescriptions[name] || task?.description || 'Coordinates one part of the response plan';
      return `<div class="agent-team-card">
        <span class="team-index">${String(agentNames.indexOf(name) + 1).padStart(2, '0')}</span>
        <div><b>${escapeHtml(name)}</b><p>${escapeHtml(role)}</p></div>
        <span class="team-status">${agent?.success ? 'ACTIVE' : 'FAILED'}</span>
      </div>`;
    })
    .join('');

  // Adaptations
  $('adaptations').innerHTML = amacs.adaptations.length
    ? amacs.adaptations
        .map(
          (event) =>
            `<div class="event">
              <span class="event-marker">↻</span>
              <div>
                <b>${escapeHtml(event.action_type || event.action)}</b>
                <small>${escapeHtml(event.trigger || 'monitor signal')}</small>
                <p>${escapeHtml(event.description || event.outcome)}</p>
              </div>
            </div>`
        )
        .join('')
    : '<div class="empty">No adaptation was needed in this run.</div>';

  // Rubric — dynamically from per_category data
  const rubricLabels = amacs.accuracy.per_category
    ? Object.keys(amacs.accuracy.per_category)
    : amacs.accuracy.matched;
  $('rubric').innerHTML = rubricLabels
    .map(
      (label) =>
        `<div class="rubric-row"><span>${amacs.accuracy.matched.includes(label) ? '✓' : '○'}</span>${label}</div>`
    )
    .join('');

  // Communication Bus
  renderCommunicationBus(amacs.communication);

  const fallbackReason = amacs.fallback_reason;
  $('amacsSummary').textContent = fallbackReason
    ? `Offline specialist graph active: ${fallbackReason}`
    : 'Multiple role agents, dependency-aware scheduling, and feedback between waves.';

  // Show results
  $('results').classList.remove('hidden');
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── API Calls ── */
async function loadHistory() {
  renderHistory(await fetch('/api/history').then((response) => response.json()));
}

async function run() {
  $('runButton').disabled = true;
  $('loading').classList.remove('hidden');
  $('error').classList.add('hidden');
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: $('prompt').value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderRun(data);
    loadHistory();
  } catch (error) {
    $('error').textContent = error.message;
    $('error').classList.remove('hidden');
  } finally {
    $('runButton').disabled = false;
    $('loading').classList.add('hidden');
  }
}

$('runButton').addEventListener('click', run);
loadHistory();
