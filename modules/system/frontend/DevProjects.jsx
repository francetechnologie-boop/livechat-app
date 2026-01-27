import React, { useEffect, useState } from 'react';
import RichEditor from '@modules/shared/frontend/RichEditor.jsx';

export default function DevProjects() {
  const LS_PROJECTS = 'dev_projects';
  const LS_CUR = 'dev_current_project';
  const boardKey = (pid) => `dev_kanban_board__${pid}`;
  const slugify = (name='') => String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const lsSetStr = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };

  const [projects, setProjects] = useState(() => {
    const arr = lsGet(LS_PROJECTS, []);
    return Array.isArray(arr) ? arr : [];
  });
  const [projectId, setProjectId] = useState(() => { try { return localStorage.getItem(LS_CUR) || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');
  const [tpl, setTpl] = useState('basic');
  const syncTimer = React.useRef(null);
  const [attachments, setAttachments] = useState([]);

  const FENCE = '`'.repeat(3);
  const docKey = (pid) => `dev_project_doc__${pid}`;
  const setProjectDoc = (pid, text) => { try { localStorage.setItem(docKey(pid), String(text||'')); } catch {} finally { scheduleSync(); } };
  const getProjectDoc = (pid) => { try { return localStorage.getItem(docKey(pid)) || ''; } catch { return ''; } };

  // Rich project content (HTML) and attachments per project
  const richKey = (pid) => `dev_project_rich__${pid}`;
  const filesKey = (pid) => `dev_project_files__${pid}`;
  const getProjectRich = (pid) => lsGet(richKey(pid), { html: '', updated_at: '' });
  const setProjectRich = (pid, obj) => lsSet(richKey(pid), obj || { html: '', updated_at: '' });
  const getProjectFiles = (pid) => lsGet(filesKey(pid), []);
  const setProjectFiles = (pid, arr) => lsSet(filesKey(pid), Array.isArray(arr) ? arr : []);

  const buildLightPMDoc = () => [
    '# Lightweight Project Management System (Collaborative Software Development)',
    '',
    'A pragmatic, lightweight operating system you can adopt today. Works with Jira/Linear/GitHub Projects/Trello, GitHub/GitLab, Notion/Confluence.',
    '',
    '---',
    '',
    '## 1) Team & Roles (RACI-lite)',
    '',
    '**Core roles**',
    '',
    '* **Product Lead (PL):** owns vision, roadmap, priorities, specs.',
    '* **Tech Lead (TL):** owns architecture, code quality, delivery feasibility.',
    '* **Project Manager (PM)/Scrum Master:** cadence, flow, risk/issue tracking.',
    '* **Engineers (DE):** implementation, testing, reviews.',
    '* **Design (UX):** research, UX/UI, prototypes.',
    '* **QA (can be shared):** test strategy, automation, exploratory testing.',
    '* **Stakeholders:** business, marketing, support.',
    '',
    '**RACI-lite table**',
    '',
    '* **Roadmap:** R=PL, A=PL, C=TL/PM/UX, I=Stakeholders',
    '* **Architecture:** R=TL, A=TL, C=DE/PL, I=Stakeholders',
    '* **Release Go/No-Go:** R=TL+PL, A=PL, C=PM/QA, I=Stakeholders',
    '* **Scope change:** R=PL, A=PL, C=TL/PM, I=Stakeholders',
    '',
    '---',
    '',
    '## 2) Cadence (Scrumban)',
    '',
    '* **Daily (15 min):** Standup focusing on flow: blockers, WIP, aging items.',
    '* **Weekly**',
    '',
    '  * **Planning (60 min):** select ready work, set sprint goal/capacity.',
    '  * **Demo/Review (30–45 min):** show outcomes; confirm acceptance.',
    '  * **Backlog grooming (30 min):** prepare next 1–2 sprints.',
    '  * **Retro (30 min):** 1–2 experiments to improve flow.',
    '* **Monthly (60 min):** Roadmap/OKR check-in; adjust priorities.',
    '* **Async:** RFCs, design reviews, decision logs (ADRs).',
    '',
    '**Sprint length:** 1–2 weeks. Prefer 1 week for fast feedback.',
    '',
    '---',
    '',
    '## 3) Work Hierarchy & Definitions',
    '',
    '* **Objective (OKR)** → **Initiative/Epic** → **Feature** → **Story** → **Task/Bug**',
    '',
    '**Definition of Ready (DoR)** for Stories',
    '',
    '* Clear user value and scope',
    '* Acceptance criteria written (Gherkin preferred)',
    '* Dependencies identified; designs attached; test notes added',
    '* Estimation done; fits sprint (≤ 3 days of dev work)',
    '',
    '**Definition of Done (DoD)**',
    '',
    '* Code merged to main, tests pass in CI',
    '* Feature flags wired (if applicable)',
    '* Docs updated (user + dev), telemetry added',
    '* QA accepted in staging; release notes prepared',
    '',
    '---',
    '',
    '## 4) Board Workflow & Policies (with WIP limits)',
    '',
    '**Columns:** Backlog → Ready → In Progress (WIP 2 per dev) → In Review → In QA (WIP 3 total) → Ready to Release → Done',
    '',
    '**Policies**',
    '',
    '* Pull, don’t push: finish/review before starting new work.',
    '* Limit WIP strictly; swarm aging items first.',
    '* A PR must have: linked issue, small diff, 1–2 reviewers, CI green.',
    '* Every column has an exit criterion matching DoD/DoR.',
    '',
    '---',
    '',
    '## 5) Prioritization',
    '',
    '* **RICE** = Reach × Impact × Confidence ÷ Effort (t-shirt sizes or story points)',
    '* **MoSCoW** for roadmap tiers: Must/Should/Could/Won’t',
    '* **Intake form** for new ideas/requests (template below)',
    '',
    '---',
    '',
    '## 6) Planning & Estimation',
    '',
    '* Capacity = (#devs × focus hours per sprint) × focus factor (0.6–0.7)',
    '* Use **story points** or **t‑shirt sizes**; track **velocity** but optimize **flow** (lead/cycle time).',
    '* Keep a **sprint goal** (1 sentence outcome).',
    '',
    '---',
    '',
    '## 7) Version Control & CI/CD',
    '',
    '* **Trunk-based development**',
    '',
    '  * Short-lived feature branches; PRs merged daily.',
    '  * Protected main with required checks (build, unit, lint, tests).',
    '* **Release train:** e.g., every Wednesday 14:00 CET to production.',
    '* **Hotfixes:** branch from tag, PR to main, tag patch.',
    '* **Conventional Commits** + **Semantic Versioning**; auto-changelog.',
    '* **Feature flags** for safe gradual releases.',
    '',
    '---',
    '',
    '## 8) Quality & Testing',
    '',
    '* Testing pyramid: unit (fast) → integration → e2e smoke/regression.',
    '* Minimum coverage threshold; focus on critical paths over %.',
    '* **Code Review checklist:** correctness, tests, readability, security, perf, telemetry, i18n, accessibility.',
    '* **Non-functional requirements:** performance budgets and basic SLOs.',
    '',
    '---',
    '',
    '## 9) Environments & Release',
    '',
    '* **Envs:** Dev → Staging (pre-prod) → Prod',
    '* **Gate:** DoD + QA pass in staging + changelog + rollback plan.',
    '* **Rollback:** documented procedure; DB migrations reversible.',
    '',
    '---',
    '',
    '## 10) Observability & Incidents',
    '',
    '* **Metrics:** request rate, latency, error rate; business KPIs.',
    '* **Logging/tracing:** structured logs; trace IDs.',
    '* **Incidents:** SEV levels, on-call rota, comms channel, postmortems.',
    '',
    '**SEV ladder**',
    '',
    '* SEV1: Major outage; all users; immediate response; public status.',
    '* SEV2: Degraded core function; fast fix; internal comms.',
    '* SEV3: Minor bug/regression; schedule within sprint.',
    '',
    '---',
    '',
    '## 11) Documentation Structure',
    '',
    '* **Home / Readme**: how to run/build/ship',
    '* **Product**: PRD/specs, user stories, acceptance criteria',
    '* **Design**: UX artifacts, flows, components',
    '* **Engineering**: architecture, ADRs, RFCs, runbooks',
    '* **QA**: test plans, cases, automation strategy',
    '* **Operations**: playbooks, incident process',
    '* **Onboarding**: 1‑week path for new joiners',
    '',
    '---',
    '',
    '## 12) Security & Compliance (Minimums)',
    '',
    '* Secrets via vault/manager; no secrets in repo',
    '* Static/Dynamic scans in CI; dependency update bot',
    '* Least-privilege access; 2FA; audit logs',
    '* Backups & restore drills; data classification & retention',
    '',
    '---',
    '',
    '## 13) Metrics Dashboard (Team & Product)',
    '',
    '* **Delivery:** Lead time, Cycle time, Throughput, WIP, PR size, Review time',
    '* **Quality:** Defect rate, Escaped defects, Flake rate, MTTR',
    '* **Product:** Activation, Retention (D1/W1), NPS (if consumer)',
    '* **Team health:** monthly pulse (1–5); action items in retro',
    '',
    '---',
    '',
    '## 14) Templates (Copy‑paste)',
    '',
    '### 14.1 User Story',
    '',
    FENCE,
    'Title: <As a [user], I want [capability], so that [outcome]>',
    'Context/Notes: <links to designs, research, constraints>',
    'Acceptance Criteria (Gherkin):',
    '- Given <precondition>',
    '  When <action>',
    '  Then <observable result>',
    'Test notes: <edge cases, non-functional>',
    'Estimation: <SP or T-shirt>',
    'Dependencies: <other stories/teams>',
    FENCE,
    '',
    '### 14.2 Bug Report',
    '',
    FENCE,
    'Title: <short, observable>',
    'Environment: <app version, OS, browser/device>',
    'Steps to Reproduce: 1)… 2)… 3)…',
    'Expected:',
    'Actual:',
    'Attachments/Logs:',
    'Severity: <Blocker/Critical/Major/Minor/Trivial>',
    FENCE,
    '',
    '### 14.3 Tech Task',
    '',
    FENCE,
    'Goal:',
    'Approach:',
    'Definition of Done:',
    'Risks/Mitigations:',
    FENCE,
    '',
    '### 14.4 RFC (Max 2–3 pages)',
    '',
    FENCE,
    'Context:',
    'Problem Statement:',
    'Options Considered:',
    'Proposed Solution (with trade-offs):',
    'Impact:',
    'Migration/Release Plan:',
    'Open Questions:',
    'Decision (date):',
    FENCE,
    '',
    '### 14.5 PR Template (Markdown)',
    '',
    FENCE,
    '## Summary',
    '',
    '## Linked Issue(s)',
    '',
    '## Changes',
    '-',
    '',
    '## How to Test',
    '-',
    '',
    '## Checklist',
    '- [ ] Tests added/updated',
    '- [ ] Docs updated',
    '- [ ] Telemetry added',
    '- [ ] Behind feature flag (if applicable)',
    FENCE,
    '',
    '### 14.6 ADR (Architecture Decision Record)',
    '',
    FENCE,
    'Title:',
    'Date:',
    'Status: Proposed/Accepted/Deprecated',
    'Context:',
    'Decision:',
    'Consequences:',
    FENCE,
    '',
    '### 14.7 Incident Report (Postmortem)',
    '',
    FENCE,
    'Summary:',
    'Timeline:',
    'Root Cause:',
    'Impact:',
    'What Worked / What Didn’t:',
    'Actions (Owner, Due date):',
    FENCE,
    '',
    '### 14.8 Idea/Request Intake Form',
    '',
    FENCE,
    'Problem/opportunity:',
    'Who is impacted:',
    'Outcome/metric to move:',
    'Proposed approach (if any):',
    'Priority rationale (RICE/MoSCoW):',
    'Effort estimate:',
    FENCE,
    '',
    '---',
    '',
    '## 15) Setup Checklist (Day 0 → Day 5)',
    '',
    '* [ ] Create repos; protect main; CODEOWNERS; PR template',
    '* [ ] Choose tracker (Jira/Linear/GH Projects); setup workflow + WIP',
    '* [ ] Docs space; templates above; ADR index',
    '* [ ] CI pipelines: build/test/lint; required checks',
    '* [ ] Environments: dev/staging/prod; secrets manager',
    '* [ ] Monitoring/alerts; error tracking; uptime checks',
    '* [ ] Slack/Discord channels: #announcements #dev #design #qa #support',
    '* [ ] Release train calendar invite; on-call rota',
    '',
    '---',
    '',
    '## 16) 90‑Day Adoption Plan',
    '',
    '**Days 1–10:**',
    '',
    '* Establish cadences, board, DoR/DoD, templates, CI checks',
    '* Ship a thin slice to production behind a flag',
    '',
    '**Days 11–45:**',
    '',
    '* Automate testing; add observability; start release train',
    '* Track flow metrics (lead/cycle time)',
    '',
    '**Days 46–90:**',
    '',
    '* Harden incident process; quarterly roadmap via OKRs',
    '* Reduce WIP, shrink PR size; raise merge frequency',
    '',
    '---',
    '',
    '## 17) Optional: PBS/WBS Mapping (useful for games & complex apps)',
    '',
    '* **PBS (Product Breakdown):** Modules → Components → Subsystems (e.g., Auth → OAuth/Login UI; Chat → Widget/UI, Realtime, Storage)',
    '* **WBS (Work Breakdown):** For each PBS leaf, create deliverable‑oriented work packages (Design, API, UI, Tests, Telemetry, Docs).',
    '* Link PBS items to Epics; WBS tasks to Stories/Tasks with DoD.',
    '',
    '---',
    '',
    '## 18) Governance & Change Control (Lightweight)',
    '',
    '* Weekly triage: new requests → score (RICE) → accept/park',
    '* Scope change inside sprint requires PL+TL+PM approval',
    '* Decision logs (ADRs) for reversible/important choices',
    '',
    '---',
    '',
    '## 19) Communication Protocols',
    '',
    '* Default async; use threads; decisions summarized with owners + dates',
    '* One status update per sprint: Goal, Done, Next, Risks',
    '* Stakeholder demo monthly; customer feedback loop embedded',
    '',
    '---',
    '',
    '### How to Tailor This',
    '',
    '* Team size ≤ 6: keep 1‑week sprints, single board',
    '* Regulated domain: add QA sign-off, traceability matrix',
    '* Game dev: add art pipeline gates; build content freeze 1 week pre‑release',
    '',
    '> Start small. Enforce WIP limits, DoR/DoD, and a consistent release train. Everything else can evolve as you grow.',
  ].join('\n');

  const templateBoard = (tpl) => {
    const t = String(tpl||'basic');
    if (t === 'lightpm') {
      const cols = [
        { id:'backlog', title:'Backlog', order:0 },
        { id:'ready', title:'Ready', order:1 },
        { id:'in-progress', title:'In Progress (WIP 2/dev)', order:2 },
        { id:'in-review', title:'In Review', order:3 },
        { id:'in-qa', title:'In QA (WIP 3)', order:4 },
        { id:'ready-release', title:'Ready to Release', order:5 },
        { id:'done', title:'Done', order:6 },
      ];
      const now = Date.now();
      const card = (colId, title, description='') => ({ id:`c_${now}_${Math.random().toString(36).slice(2,8)}`, columnId: colId, title, description, attachments:[] });
      const cards = [
        card('backlog', 'Set team & roles (RACI-lite)', 'Define PL/TL/PM/UX/QA/Stakeholders.'),
        card('backlog', 'Define cadences', 'Standup, planning, demo, grooming, retro, monthly OKR check-in.'),
        card('backlog', 'Write DoR/DoD', 'Ready/Done definitions for stories and releases.'),
        card('backlog', 'Establish board WIP policies', 'WIP limits and exit criteria per column.'),
        card('backlog', 'Setup CI/CD & trunk-based', 'Protected main, checks, release train.'),
        card('backlog', 'Quality guardrails', 'Testing pyramid, review checklist.'),
        card('backlog', 'Observability & incidents', 'Metrics, logging, SEV ladder, postmortems.'),
        card('backlog', 'Documentation spaces', 'PRD/design/engineering/QA/ops/onboarding structure.'),
      ];
      return { columns: cols, cards, updatedAt: now };
    }
    if (t === 'software') {
      return {
        columns: [
          { id:'backlog', title:'Backlog', order:0 },
          { id:'in-progress', title:'En cours', order:1 },
          { id:'review', title:'Revue', order:2 },
          { id:'done', title:'Fait', order:3 },
        ],
        cards: [
          { id:`c_${Date.now()}a`, columnId:'backlog', title:'Setup repo', description:'Init README, CI.', attachments:[] },
          { id:`c_${Date.now()}b`, columnId:'backlog', title:'Define backlog', description:'Collect initial tasks.', attachments:[] },
        ],
        updatedAt: Date.now(),
      };
    }
    if (t === 'bugs') {
      return {
        columns: [
          { id:'triage', title:'Triage', order:0 },
          { id:'fixing', title:'Correction', order:1 },
          { id:'verify', title:'Vérifier', order:2 },
          { id:'done', title:'Fait', order:3 },
        ],
        cards: [ { id:`c_${Date.now()}a`, columnId:'triage', title:'Example bug', description:'Describe steps.', attachments:[] } ],
        updatedAt: Date.now(),
      };
    }
    return {
      columns: [
        { id:'todo', title:'À faire', order:0 },
        { id:'in-progress', title:'En cours', order:1 },
        { id:'done', title:'Fait', order:2 },
      ],
      cards: [ { id:`c_${Date.now()}`, columnId:'todo', title:'Bienvenue 👋', description:'Créez des colonnes et des cartes.', attachments:[] } ],
      updatedAt: Date.now(),
    };
  };

  const broadcast = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {} };
  const saveProjects = (arr) => {
    setProjects(arr);
    lsSet(LS_PROJECTS, arr);
    broadcast('dev-projects-updated', { projects: arr });
    scheduleSync();
  };
  const setCurrent = (pid) => {
    setProjectId(pid);
    lsSetStr(LS_CUR, pid);
    broadcast('dev-project-change', { id: pid });
  };

  // ---- Backup/Restore (to survive cache clears) ----
  const collectAllData = () => {
    try {
      const obj = { version: 1, ts: new Date().toISOString(), projects: projects||[], current: projectId, items: {} };
      for (const p of (projects||[])) {
        const pid = p?.id; if (!pid) continue;
        let board = null, templates = null, doc = '';
        try { board = JSON.parse(localStorage.getItem(boardKey(pid)) || 'null'); } catch {}
        try { templates = JSON.parse(localStorage.getItem(TEMPL_KEY(pid)) || 'null'); } catch {}
        try { doc = getProjectDoc(pid) || ''; } catch {}
        obj.items[pid] = { board, templates, doc };
      }
      return obj;
    } catch { return { version:1, projects:[], current:'', items:{} }; }
  };
  const exportAll = () => {
    try {
      const data = collectAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'dev-projects-backup.json'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch {}
  };
  const importAllFromFile = async (file) => {
    try {
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      const list = Array.isArray(data?.projects) ? data.projects : [];
      saveProjects(list);
      const cur = data?.current && list.find(p=>p?.id===data.current) ? data.current : (list[0]?.id || '');
      setCurrent(cur);
      for (const p of list) {
        const pid = p?.id; if (!pid) continue;
        const it = data?.items?.[pid] || {};
        try { if (it.board) localStorage.setItem(boardKey(pid), JSON.stringify(it.board)); } catch {}
        try { if (it.templates) localStorage.setItem(TEMPL_KEY(pid), JSON.stringify(it.templates)); } catch {}
        try { if (typeof it.doc === 'string') setProjectDoc(pid, it.doc); } catch {}
      }
    } catch {}
  };

  const importAllFromJson = async (data) => {
    try {
      const list = Array.isArray(data?.projects) ? data.projects : [];
      if (!list.length) return false;
      saveProjects(list);
      const cur = data?.current && list.find(p=>p?.id===data.current) ? data.current : (list[0]?.id || '');
      setCurrent(cur);
      for (const p of list) {
        const pid = p?.id; if (!pid) continue;
        const it = data?.items?.[pid] || {};
        try { if (it.board) localStorage.setItem(boardKey(pid), JSON.stringify(it.board)); } catch {}
        try { if (it.templates) localStorage.setItem(TEMPL_KEY(pid), JSON.stringify(it.templates)); } catch {}
        try { if (typeof it.doc === 'string') setProjectDoc(pid, it.doc); } catch {}
      }
      return true;
    } catch { return false; }
  };

  const scheduleSync = () => {
    try { if (syncTimer.current) clearTimeout(syncTimer.current); } catch {}
    syncTimer.current = setTimeout(async () => {
      try {
        const payload = collectAllData();
        await fetch('/api/dev/projects', { method:'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch {}
    }, 800);
  };

  // Ensure initial default project exists
  useEffect(() => {
    try {
      if (!projects || !projects.length) {
        // Try restore from server first
        (async () => {
          try {
            const r = await fetch('/api/dev/projects');
            const j = await r.json().catch(()=>({}));
            const ok = j && j.ok && j.data;
            if (ok) {
              const restored = await importAllFromJson(j.data);
              if (restored) return;
            }
          } catch {}
          const defaultName = 'Alex livechat-app';
          const id = slugify(defaultName) || `proj_${Date.now()}`;
          const list = [{ id, name: defaultName, template: 'basic' }];
          saveProjects(list);
          setCurrent(id);
          const b = templateBoard('basic');
          try { localStorage.setItem(boardKey(id), JSON.stringify(b)); } catch {}
          scheduleSync();
        })();
      } else if (!projectId) {
        setCurrent(projects[0].id);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showDoc, setShowDoc] = useState(false);
  const docText = projectId ? getProjectDoc(projectId) : '';

  // Load attachments when project changes
  useEffect(() => {
    try {
      if (!projectId) { setAttachments([]); return; }
      setAttachments(getProjectFiles(projectId) || []);
    } catch { setAttachments([]); }
  }, [projectId]);

  const sanitizeHTML = (html) => {
    try {
      let s = String(html || '');
      s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      s = s.replace(/on\w+\s*=\s*"[^"]*"/gi, '').replace(/on\w+\s*=\s*'[^']*'/gi, '').replace(/on\w+\s*=\s*[^\s>]+/gi, '');
      s = s.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"').replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
      return s;
    } catch { return String(html || ''); }
  };

  // (Rich text editor for Templates is handled inside the templates form)

  const onFilesSelected = async (e) => {
    try {
      const list = Array.from(e?.target?.files || []);
      if (!list.length || !projectId) return;
      const readAsDataURL = (file) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const now = new Date().toISOString();
      const newItems = [];
      for (const f of list) {
        const dataUrl = await readAsDataURL(f);
        newItems.push({ id: `f_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name: f.name, size: f.size, type: f.type, added_at: now, dataUrl });
      }
      const next = [...(attachments||[]), ...newItems];
      setAttachments(next);
      setProjectFiles(projectId, next);
      if (e && e.target) e.target.value = '';
    } catch {}
  };

  const removeFile = (id) => {
    try {
      const next = (attachments||[]).filter((x) => x && x.id !== id);
      setAttachments(next);
      if (projectId) setProjectFiles(projectId, next);
    } catch {}
  };

  

  // -------- Templates (Lightweight) per project --------
  const TEMPL_KEY = (pid) => `dev_templates__${pid}`;
  const defaultTemplates = () => ({ userStories: [], bugs: [], techTasks: [], rfcs: [], prs: [], adrs: [], incidents: [], ideas: [] });
  const [tplData, setTplData] = useState(defaultTemplates());
  const [tplType, setTplType] = useState('userStories');
  const [tplEditingId, setTplEditingId] = useState('');
  const [tplForm, setTplForm] = useState({});
  const [tplBusy, setTplBusy] = useState(false);
  const [histOpenId, setHistOpenId] = useState('');
  const [rowOpenId, setRowOpenId] = useState('');

  const loadTemplates = (pid) => {
    try {
      const raw = pid && localStorage.getItem(TEMPL_KEY(pid));
      const obj = raw ? JSON.parse(raw) : null;
      setTplData(obj && typeof obj === 'object' ? { ...defaultTemplates(), ...obj } : defaultTemplates());
    } catch { setTplData(defaultTemplates()); }
  };
  const saveTemplates = (pid, data) => {
    try { if (!pid) return; localStorage.setItem(TEMPL_KEY(pid), JSON.stringify(data || tplData)); } catch {} finally { scheduleSync(); }
  };
  useEffect(() => { loadTemplates(projectId); setTplEditingId(''); setTplForm({}); }, [projectId]);

  const idNew = () => `t_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const ensureArray = (x) => Array.isArray(x) ? x : [];
  const updateTypeArray = (typeKey, updater) => {
    setTplData(prev => {
      const next = { ...prev, [typeKey]: updater(ensureArray(prev[typeKey])) };
      saveTemplates(projectId, next);
      return next;
    });
  };

  // Dernière mise à jour (board + templates + files)
  const lastUpdate = React.useMemo(() => {
    try {
      if (!projectId) return null;
      const timestamps = [];
      // Board updatedAt from localStorage
      try {
        const raw = localStorage.getItem(boardKey(projectId));
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.updatedAt) {
            const t = new Date(data.updatedAt).getTime();
            if (!Number.isNaN(t)) timestamps.push(t);
          }
        }
      } catch {}
      // Templates updated_at (max across all types)
      try {
        const allItems = Object.values(tplData || {}).reduce((acc, v) => {
          if (Array.isArray(v)) acc.push(...v);
          return acc;
        }, []);
        for (const it of allItems) {
          const t = it && it.updated_at ? new Date(it.updated_at).getTime() : NaN;
          if (!Number.isNaN(t)) timestamps.push(t);
        }
      } catch {}
      // Files added_at
      try {
        const files = attachments && Array.isArray(attachments) ? attachments : getProjectFiles(projectId);
        for (const f of (files || [])) {
          const t = f && f.added_at ? new Date(f.added_at).getTime() : NaN;
          if (!Number.isNaN(t)) timestamps.push(t);
        }
      } catch {}
      if (!timestamps.length) return null;
      const maxTs = Math.max(...timestamps);
      return new Date(maxTs);
    } catch { return null; }
  }, [projectId, tplData, attachments]);

  // Date format helper: DD/MM/YYYY HH:mm:ss
  const fmtDateTime = (d) => {
    try {
      const dt = d instanceof Date ? d : new Date(d);
      const z = (n) => String(n).padStart(2, '0');
      return `${z(dt.getDate())}/${z(dt.getMonth() + 1)}/${dt.getFullYear()} ${z(dt.getHours())}:${z(dt.getMinutes())}:${z(dt.getSeconds())}`;
    } catch { return ''; }
  };

  const typeLabel = (key) => ({
    userStories: '14.1 User Story',
    bugs: '14.2 Bug Report',
    techTasks: '14.3 Tech Task',
    rfcs: '14.4 RFC',
    prs: '14.5 PR Template',
    adrs: '14.6 ADR',
    incidents: '14.7 Incident',
    ideas: '14.8 Idea/Request',
  })[key] || key || '';

  // Aggregate all template items and sort by latest update
  const allItemsSorted = React.useMemo(() => {
    try {
      const types = Object.keys(tplData || {});
      let items = [];
      for (const t of types) {
        const arr = ensureArray(tplData[t]).map((it) => (it && !it.type ? { ...it, type: t } : it));
        items = items.concat(arr.filter(Boolean));
      }
      items.sort((a, b) => {
        const ta = Date.parse(a?.updated_at || a?.created_at || 0) || 0;
        const tb = Date.parse(b?.updated_at || b?.created_at || 0) || 0;
        return tb - ta;
      });
      return items;
    } catch { return []; }
  }, [tplData]);

  const editFromList = (it) => {
    try {
      const t = it?.type || 'userStories';
      setTplType(t);
      setTplEditingId(it?.id || '');
      const form = { ...(it || {}) };
      if (!form.context_md) form.context_md = form.context_md || (form.context_html ? htmlToText(form.context_html) : (form.context || ''));
      if (!form.ac_md) form.ac_md = form.ac_md || (form.ac_html ? htmlToText(form.ac_html) : (form.ac || ''));
      if (!form.testNotes_md) form.testNotes_md = form.testNotes_md || (form.testNotes_html ? htmlToText(form.testNotes_html) : (form.testNotes || ''));
      setTplForm(form);
      document.getElementById('tpl-panel-anchor')?.scrollIntoView({ behavior:'smooth' });
    } catch {}
  };

  const removeItemType = (id, type) => {
    if (!id) return;
    updateTypeArray(type || tplType, (arr) => arr.filter(x => x && x.id !== id));
    if (tplEditingId === id) cancelEdit();
  };

  // One-time migration: ensure Alex project uses lightpm template
  useEffect(() => {
    try {
      if (!projects || !projects.length) return;
      const idx = projects.findIndex(p => p && (p.id === 'alex-livechat-app' || /alex\s*livechat-app/i.test(p.name || '')));
      if (idx >= 0) {
        const cur = projects[idx];
        if (cur.template !== 'lightpm') {
          const next = projects.slice();
          next[idx] = { ...cur, template: 'lightpm' };
          saveProjects(next);
          if (!getProjectDoc(cur.id)) setProjectDoc(cur.id, buildLightPMDoc());
        }
        if (!projectId) setCurrent(cur.id);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => { setTplEditingId('__new__'); setTplForm({}); };
  const startEdit = (id) => {
    try {
      const arr = ensureArray(tplData[tplType]);
      const it = arr.find(x => x && x.id === id);
      const form = { ...(it || {}) };
      if (!form.context_md) form.context_md = form.context_md || (form.context_html ? htmlToText(form.context_html) : (form.context || ''));
      if (!form.ac_md) form.ac_md = form.ac_md || (form.ac_html ? htmlToText(form.ac_html) : (form.ac || ''));
      if (!form.testNotes_md) form.testNotes_md = form.testNotes_md || (form.testNotes_html ? htmlToText(form.testNotes_html) : (form.testNotes || ''));
      setTplEditingId(id);
      setTplForm(form);
    } catch { setTplEditingId(''); setTplForm({}); }
  };
  const cancelEdit = () => { setTplEditingId(''); setTplForm({}); };
  const removeItem = (id) => {
    if (!id) return;
    updateTypeArray(tplType, (arr) => arr.filter(x => x && x.id !== id));
    if (tplEditingId === id) cancelEdit();
  };
  const saveItem = () => {
    setTplBusy(true);
    try {
      const id = tplEditingId === '__new__' || !tplEditingId ? idNew() : tplEditingId;
      const now = new Date().toISOString();
      updateTypeArray(tplType, (arr) => {
        const idx = arr.findIndex(x => x && x.id === id);
        if (idx >= 0) {
          const copy = arr.slice();
          const prev = copy[idx];
          const history = Array.isArray(prev.history) ? prev.history.slice() : [];
          history.push({ ts: now, data: { ...prev } });
          const clean = { ...prev, ...tplForm, id, type: tplType, updated_at: now, history };
          copy[idx] = clean;
          return copy;
        }
        const cleanNew = { id, type: tplType, created_at: now, updated_at: now, ...tplForm, history: [] };
        return [...arr, cleanNew];
      });
      setTplEditingId(''); setTplForm({});
    } finally { setTplBusy(false); }
  };

  // --- Attachments per item (stored inside each template item) ---
  const readAsDataURL = (file) => new Promise((resolve, reject) => { try { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file); } catch (e) { reject(e); } });
  const addItemFiles = async (type, id, fileList) => {
    try {
      const list = Array.from(fileList || []);
      if (!list.length) return;
      const now = new Date().toISOString();
      const newItems = [];
      for (const f of list) {
        const dataUrl = await readAsDataURL(f);
        newItems.push({ id: `af_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name: f.name, size: f.size, type: f.type, added_at: now, dataUrl });
      }
      updateTypeArray(type, (arr) => {
        const idx = arr.findIndex(x => x && x.id === id);
        if (idx < 0) return arr;
        const copy = arr.slice();
        const cur = copy[idx] || {};
        const files = Array.isArray(cur.files) ? cur.files.slice() : [];
        copy[idx] = { ...cur, files: [...files, ...newItems], updated_at: now };
        return copy;
      });
    } catch {}
  };
  const removeItemFile = (type, id, fileId) => {
    updateTypeArray(type, (arr) => {
      const idx = arr.findIndex(x => x && x.id === id);
      if (idx < 0) return arr;
      const copy = arr.slice();
      const cur = copy[idx] || {};
      const files = Array.isArray(cur.files) ? cur.files : [];
      copy[idx] = { ...cur, files: files.filter(f => f && f.id !== fileId), updated_at: new Date().toISOString() };
      return copy;
    });
  };

  const mdEscape = (s='') => String(s||'');
  const mdCode = (s='') => '```\n' + String(s||'') + '\n```';
  const htmlToText = (html='') => {
    try {
      let s = String(html||'');
      s = s.replace(/<\/(p|div|h\d|li)>/gi, '\n');
      s = s.replace(/<br\s*\/?\s*>/gi, '\n');
      s = s.replace(/<[^>]+>/g, '');
      s = s.replace(/&nbsp;/g, ' ')
           .replace(/&amp;/g, '&')
           .replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>')
           .replace(/&quot;/g, '"')
           .replace(/&#39;/g, "'");
      return s.replace(/\n{3,}/g, '\n\n').trim();
    } catch { return String(html||''); }
  };
  const toMarkdown = (type, it) => {
    switch (type) {
      case 'userStories': {
        const ctx = it.context_md || (it.context_html ? htmlToText(it.context_html) : (it.context || ''));
        const ac = it.ac_md || (it.ac_html ? htmlToText(it.ac_html) : (it.ac || ''));
        const test = it.testNotes_md || (it.testNotes_html ? htmlToText(it.testNotes_html) : (it.testNotes || ''));
        return [
          `Title: ${mdEscape(it.title||'')}`,
          `Context/Notes: ${mdEscape(ctx)}`,
          'Acceptance Criteria (Gherkin):',
          mdCode(ac || ''),
          `Test notes: ${mdEscape(test)}`,
          `Estimation: ${mdEscape(it.estimation||'')}`,
          `Dependencies: ${mdEscape(it.dependencies||'')}`,
        ].join('\n');
      }
      case 'bugs':
        return [
          `Title: ${mdEscape(it.title||'')}`,
          `Environment: ${mdEscape(it.env||'')}`,
          'Steps to Reproduce:',
          mdCode(it.steps||''),
          `Expected: ${mdEscape(it.expected||'')}`,
          `Actual: ${mdEscape(it.actual||'')}`,
          `Attachments/Logs: ${mdEscape(it.attachments||'')}`,
          `Severity: ${mdEscape(it.severity||'')}`,
        ].join('\n');
      case 'techTasks':
        return [
          `Goal: ${mdEscape(it.goal||'')}`,
          `Approach: ${mdEscape(it.approach||'')}`,
          `Definition of Done: ${mdEscape(it.dod||'')}`,
          `Risks/Mitigations: ${mdEscape(it.risks||'')}`,
        ].join('\n');
      case 'rfcs':
        return [
          `Context: ${mdEscape(it.context||'')}`,
          `Problem Statement: ${mdEscape(it.problem||'')}`,
          `Options Considered: ${mdEscape(it.options||'')}`,
          `Proposed Solution (with trade-offs): ${mdEscape(it.proposed||'')}`,
          `Impact: ${mdEscape(it.impact||'')}`,
          `Migration/Release Plan: ${mdEscape(it.plan||'')}`,
          `Open Questions: ${mdEscape(it.questions||'')}`,
          `Decision (date): ${mdEscape(it.decision||'')}`,
        ].join('\n');
      case 'prs':
        return [
          '## Summary',
          mdEscape(it.summary||''),
          '',
          '## Linked Issue(s)',
          mdEscape(it.issues||''),
          '',
          '## Changes',
          mdEscape(it.changes||'-'),
          '',
          '## How to Test',
          mdEscape(it.test||'-'),
          '',
          '## Checklist',
          `- [${it.chk_tests?'x':' '}] Tests added/updated`,
          `- [${it.chk_docs?'x':' '}] Docs updated`,
          `- [${it.chk_tel?'x':' '}] Telemetry added`,
          `- [${it.chk_flag?'x':' '}] Behind feature flag (if applicable)`,
        ].join('\n');
      case 'adrs':
        return [
          `Title: ${mdEscape(it.title||'')}`,
          `Date: ${mdEscape(it.date||'')}`,
          `Status: ${mdEscape(it.status||'Proposed')}`,
          `Context: ${mdEscape(it.context||'')}`,
          `Decision: ${mdEscape(it.decision||'')}`,
          `Consequences: ${mdEscape(it.consequences||'')}`,
        ].join('\n');
      case 'incidents':
        return [
          `Summary: ${mdEscape(it.summary||'')}`,
          `Timeline: ${mdEscape(it.timeline||'')}`,
          `Root Cause: ${mdEscape(it.root||'')}`,
          `Impact: ${mdEscape(it.impact||'')}`,
          `What Worked / What Didn’t: ${mdEscape(it.what||'')}`,
          `Actions (Owner, Due date): ${mdEscape(it.actions||'')}`,
        ].join('\n');
      case 'ideas':
        return [
          `Problem/opportunity: ${mdEscape(it.problem||'')}`,
          `Who is impacted: ${mdEscape(it.impacted||'')}`,
          `Outcome/metric to move: ${mdEscape(it.outcome||'')}`,
          `Proposed approach (if any): ${mdEscape(it.proposed||'')}`,
          `Priority rationale (RICE/MoSCoW): ${mdEscape(it.priority||'')}`,
          `Effort estimate: ${mdEscape(it.effort||'')}`,
        ].join('\n');
      default:
        return '';
    }
  };

  // Removed old MdEditor in favor of shared TipTap RichEditor

  const renderForm = () => {
    const on = (k) => ({ value: tplForm[k] || '', onChange: (e) => setTplForm((f) => ({ ...f, [k]: e.target.value })) });
    const onChk = (k) => ({ checked: !!tplForm[k], onChange: (e) => setTplForm((f) => ({ ...f, [k]: e.target.checked })) });
    if (!tplEditingId) return null;
    if (tplType === 'userStories') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><div className="text-xs mb-1">Title</div><input className="border rounded px-2 py-1 w-full" {...on('title')} /></div>
          <div><div className="text-xs mb-1">Estimation</div><input className="border rounded px-2 py-1 w-full" {...on('estimation')} /></div>
          <div className="md:col-span-2">
            <div className="text-xs mb-1">Context/Notes</div>
            <RichEditor valueHtml={tplForm.context_html || ''} onChange={(html, text)=>setTplForm(f=>({ ...f, context_html: html, context_md: text }))} />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs mb-1">Acceptance Criteria (Gherkin)</div>
            <RichEditor valueHtml={tplForm.ac_html || ''} onChange={(html, text)=>setTplForm(f=>({ ...f, ac_html: html, ac_md: text }))} />
          </div>
          <div>
            <div className="text-xs mb-1">Test notes</div>
            <RichEditor valueHtml={tplForm.testNotes_html || ''} onChange={(html, text)=>setTplForm(f=>({ ...f, testNotes_html: html, testNotes_md: text }))} />
          </div>
          <div><div className="text-xs mb-1">Dependencies</div><input className="border rounded px-2 py-1 w-full" {...on('dependencies')} /></div>
        </div>
      );
    }
    if (tplType === 'bugs') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><div className="text-xs mb-1">Title</div><input className="border rounded px-2 py-1 w-full" {...on('title')} /></div>
          <div><div className="text-xs mb-1">Severity</div><input className="border rounded px-2 py-1 w-full" {...on('severity')} placeholder="Blocker/Critical/Major/Minor/Trivial" /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Environment</div><input className="border rounded px-2 py-1 w-full" {...on('env')} placeholder="app version, OS, browser/device" /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Steps to Reproduce</div><textarea className="border rounded px-2 py-1 w-full h-28 font-mono text-xs" {...on('steps')} /></div>
          <div><div className="text-xs mb-1">Expected</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('expected')} /></div>
          <div><div className="text-xs mb-1">Actual</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('actual')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Attachments/Logs</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('attachments')} /></div>
        </div>
      );
    }
    if (tplType === 'techTasks') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><div className="text-xs mb-1">Goal</div><input className="border rounded px-2 py-1 w-full" {...on('goal')} /></div>
          <div><div className="text-xs mb-1">Definition of Done</div><input className="border rounded px-2 py-1 w-full" {...on('dod')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Approach</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('approach')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Risks/Mitigations</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('risks')} /></div>
        </div>
      );
    }
    if (tplType === 'rfcs') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><div className="text-xs mb-1">Context</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('context')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Problem Statement</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('problem')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Options Considered</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('options')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Proposed Solution (trade-offs)</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('proposed')} /></div>
          <div><div className="text-xs mb-1">Impact</div><input className="border rounded px-2 py-1 w-full" {...on('impact')} /></div>
          <div><div className="text-xs mb-1">Migration/Release Plan</div><input className="border rounded px-2 py-1 w-full" {...on('plan')} /></div>
          <div><div className="text-xs mb-1">Open Questions</div><input className="border rounded px-2 py-1 w-full" {...on('questions')} /></div>
          <div><div className="text-xs mb-1">Decision (date)</div><input className="border rounded px-2 py-1 w-full" {...on('decision')} /></div>
        </div>
      );
    }
    if (tplType === 'prs') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><div className="text-xs mb-1">Summary</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('summary')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Linked Issue(s)</div><input className="border rounded px-2 py-1 w-full" {...on('issues')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Changes</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('changes')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">How to Test</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('test')} /></div>
          <div className="md:col-span-2">
            <div className="flex items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="checkbox" {...onChk('chk_tests')} /> Tests added/updated</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" {...onChk('chk_docs')} /> Docs updated</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" {...onChk('chk_tel')} /> Telemetry added</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" {...onChk('chk_flag')} /> Behind feature flag</label>
            </div>
          </div>
        </div>
      );
    }
    if (tplType === 'adrs') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><div className="text-xs mb-1">Title</div><input className="border rounded px-2 py-1 w-full" {...on('title')} /></div>
          <div><div className="text-xs mb-1">Date</div><input className="border rounded px-2 py-1 w-full" {...on('date')} placeholder="YYYY-MM-DD" /></div>
          <div><div className="text-xs mb-1">Status</div><input className="border rounded px-2 py-1 w-full" {...on('status')} placeholder="Proposed/Accepted/Deprecated" /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Context</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('context')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Decision</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('decision')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Consequences</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('consequences')} /></div>
        </div>
      );
    }
    if (tplType === 'incidents') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><div className="text-xs mb-1">Summary</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('summary')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Timeline</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('timeline')} /></div>
          <div><div className="text-xs mb-1">Root Cause</div><input className="border rounded px-2 py-1 w-full" {...on('root')} /></div>
          <div><div className="text-xs mb-1">Impact</div><input className="border rounded px-2 py-1 w-full" {...on('impact')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">What Worked / What Didn’t</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('what')} /></div>
          <div className="md:col-span-2"><div className="text-xs mb-1">Actions (Owner, Due date)</div><textarea className="border rounded px-2 py-1 w-full h-20" {...on('actions')} /></div>
        </div>
      );
    }
    if (tplType === 'ideas') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><div className="text-xs mb-1">Problem/opportunity</div><input className="border rounded px-2 py-1 w-full" {...on('problem')} /></div>
          <div><div className="text-xs mb-1">Who is impacted</div><input className="border rounded px-2 py-1 w-full" {...on('impacted')} /></div>
          <div><div className="text-xs mb-1">Outcome/metric to move</div><input className="border rounded px-2 py-1 w-full" {...on('outcome')} /></div>
          <div><div className="text-xs mb-1">Proposed approach (if any)</div><input className="border rounded px-2 py-1 w-full" {...on('proposed')} /></div>
          <div><div className="text-xs mb-1">Priority rationale (RICE/MoSCoW)</div><input className="border rounded px-2 py-1 w-full" {...on('priority')} /></div>
          <div><div className="text-xs mb-1">Effort estimate</div><input className="border rounded px-2 py-1 w-full" {...on('effort')} /></div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full w-full flex min-h-0">
      <aside className="w-64 border-r bg-white p-3 flex flex-col">
        <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Projets</div>
        <div className="flex-1 overflow-auto space-y-1">
          {(projects || []).map((p) => (
            <button
              key={p.id}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                projectId === p.id ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-gray-50'
              }`}
              onClick={() => { setCurrent(p.id); setMsg(''); }}
              title={p.name}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 flex items-center gap-1">
                <button
                  className="text-[11px] px-1 py-0.5 border rounded text-red-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm(`Supprimer « ${p.name} » ?`)) return;
                    const idx = projects.findIndex((x) => x.id === p.id);
                    const rest = projects.filter((x) => x.id !== p.id);
                    saveProjects(rest);
                    try { localStorage.removeItem(boardKey(p.id)); } catch {}
                    scheduleSync();
                    const next = rest[idx] || rest[idx - 1] || rest[0] || null;
                    setCurrent(next ? next.id : '');
                  }}
                >Suppr.</button>
              </span>
            </button>
          ))}
          {!projects?.length && (
            <div className="text-xs text-gray-500 px-2 py-1">Aucun projet</div>
          )}
        </div>
        <div className="mt-3 border-t pt-3 space-y-2">
          <div className="text-xs mb-1">Ajouter un projet</div>
          <input
            className="border rounded px-2 py-1 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du projet"
          />
          <select className="border rounded px-2 py-1 w-full" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            <option value="basic">Kanban basique</option>
            <option value="software">Livraison logiciel</option>
            <option value="bugs">Triage de bugs</option>
            <option value="lightpm">Lightweight Project Mgmt</option>
          </select>
          <button
            className="px-3 py-1 rounded border disabled:opacity-60 w-full"
            disabled={busy || !name.trim()}
            onClick={async () => {
              try {
                setBusy(true); setMsg('');
                const nm = name.trim(); if (!nm) return;
                const id = slugify(nm) || `proj_${Date.now()}`;
                if (projects.some((p) => p.id === id)) { setMsg('Existe déjà'); return; }
                const list = [...projects, { id, name: nm, template: tpl }];
                saveProjects(list);
                setCurrent(id);
                const b = templateBoard(tpl);
                try { localStorage.setItem(boardKey(id), JSON.stringify(b)); } catch {}
                scheduleSync();
                if (tpl === 'lightpm') setProjectDoc(id, buildLightPMDoc());
                setName(''); setTpl('basic');
              } finally { setBusy(false); }
            }}
          >{busy ? '…' : 'Créer'}</button>
          {msg && <div className="text-[11px] text-gray-600">{msg}</div>}
        </div>
      </aside>
      <main className="flex-1 min-h-0 p-4">
        <div className="p-2 border rounded bg-white">
          <div className="font-medium mb-1">Détails du projet</div>
          {projectId ? (
            <div className="text-sm text-gray-700">
              <div className="text-xs text-gray-700 mb-2 overflow-x-auto whitespace-nowrap flex items-center gap-4">
                <span>Nom: <span className="font-medium">{projects.find(p=>p.id===projectId)?.name || projectId}</span></span>
                <span>ID: {projectId}</span>
                <span>Dernière mise à jour: {lastUpdate ? fmtDateTime(lastUpdate) : '—'}</span>
                <span>Éléments ({tplType})</span>
              </div>
              {/* Template + Guide on a single compact row */}
              <div className="text-[11px] text-gray-700 mt-1 flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2">
                  <span className="text-gray-500">Template:</span>
                  <select className="border rounded px-2 h-7 text-xs" value={(projects.find(p=>p.id===projectId)?.template)||'basic'} onChange={(e)=>{
                    const v = e.target.value;
                    const list = (projects||[]).map(p => p.id===projectId ? { ...p, template: v } : p);
                    saveProjects(list);
                    if (v==='lightpm' && !getProjectDoc(projectId)) setProjectDoc(projectId, buildLightPMDoc());
                  }}>
                    <option value="basic">Kanban basique</option>
                    <option value="software">Livraison logiciel</option>
                    <option value="bugs">Triage de bugs</option>
                    <option value="lightpm">Lightweight Project Mgmt</option>
                  </select>
                </label>
                {!!docText && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-500">Guide:</span>
                    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>setShowDoc(v=>!v)}>{showDoc ? 'Masquer' : 'Afficher'}</button>
                    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={async()=>{ try { await navigator.clipboard.writeText(docText); } catch {} }}>Copier</button>
                    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>{ try { const blob = new Blob([docText], { type:'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${projects.find(p=>p.id===projectId)?.name || 'project'}-guide.md`; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); } catch {} }}>Télécharger</button>
                  </div>
                )}
                {/* Backup/Restore */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-500">Sauvegarde:</span>
                  <button className="text-[11px] px-2 py-0.5 border rounded" onClick={exportAll}>Exporter</button>
                  <label className="text-[11px] px-2 py-0.5 border rounded cursor-pointer">
                    <input type="file" accept="application/json" className="hidden" onChange={async(e)=>{ const f=e.target?.files?.[0]; await importAllFromFile(f); try { e.target.value=''; } catch {} }} />
                    Importer…
                  </label>
                </div>
              </div>
              {showDoc && (
                <pre className="text-[11px] bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-[30vh] overflow-auto mt-1">{docText}</pre>
              )}


              {/* Tableau des éléments et guide déplacés en section séparée */}
            </div>
          ) : (
            <div className="text-sm text-gray-500">Sélectionnez ou créez un projet dans la barre de gauche.</div>
          )}
        </div>

        {/* Éléments du template (section séparée) */}
        {projectId && (projects.find(p=>p.id===projectId)?.template === 'lightpm') && (
          <div className="p-3 border rounded bg-white mt-3">
            <div className="text-xs text-gray-600 mb-1">Éléments (tous, récents)</div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-2 py-1">Titre</th>
                    <th className="text-left px-2 py-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ensureArray(allItemsSorted).map((it) => (
                    <>
                      <tr key={it.id} className="border-b">
                        <td className="px-2 py-1 truncate">
                          <div
                            className="flex items-center gap-2 flex-wrap cursor-pointer"
                            title="Cliquer pour développer et éditer"
                            onClick={()=>{
                              if (rowOpenId === it.id) { setRowOpenId(''); return; }
                              setRowOpenId(it.id);
                              setTplType(it.type || 'userStories');
                              setTplEditingId(it.id);
                              const form = { ...(it || {}) };
                              if (!form.context_md) form.context_md = form.context_md || (form.context_html ? htmlToText(form.context_html) : (form.context || ''));
                              if (!form.ac_md) form.ac_md = form.ac_md || (form.ac_html ? htmlToText(form.ac_html) : (form.ac || ''));
                              if (!form.testNotes_md) form.testNotes_md = form.testNotes_md || (form.testNotes_html ? htmlToText(form.testNotes_html) : (form.testNotes || ''));
                              setTplForm(form);
                            }}
                          >
                            <span className="truncate">{it.title || it.summary || it.goal || it.problem || it.context || it.id}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 border text-gray-700">{typeLabel(it.type || tplType)}</span>
                            <span className="text-[11px] text-gray-500">{it.updated_at ? new Date(it.updated_at).toLocaleString() : ''}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button className="text-xs px-2 py-0.5 rounded border" onClick={(e)=>{ e.stopPropagation(); editFromList(it); setRowOpenId(it.id); }}>Éditer</button>
                            <button className="text-xs px-2 py-0.5 rounded border" onClick={async(e)=>{ e.stopPropagation(); try { await navigator.clipboard.writeText(toMarkdown(it.type || tplType, it)); } catch {} }}>Copier MD</button>
                            <button className="text-xs px-2 py-0.5 rounded border" onClick={(e)=>{ e.stopPropagation(); setHistOpenId(h=>h===it.id?'':it.id); }}>{histOpenId===it.id?'Masquer hist.':'Historique'}</button>
                            <button className="text-xs px-2 py-0.5 rounded border text-red-700" onClick={(e)=>{ e.stopPropagation(); removeItemType(it.id, it.type); }}>Supprimer</button>
                          </div>
                        </td>
                      </tr>
                      {rowOpenId===it.id && (
                        <tr>
                          <td colSpan={2} className="px-2 py-2 bg-gray-50">
                            <div className="mb-2 flex items-center gap-2 flex-wrap">
                              <button className="text-xs px-2 py-0.5 rounded bg-emerald-600 text-white disabled:opacity-60" disabled={tplBusy} onClick={(e)=>{ e.stopPropagation(); saveItem(); }}>Enregistrer</button>
                              <button className="text-xs px-2 py-0.5 rounded border" onClick={(e)=>{ e.stopPropagation(); cancelEdit(); setRowOpenId(''); }}>Annuler</button>
                              <button className="text-xs px-2 py-0.5 rounded border" onClick={async(e)=>{ e.stopPropagation(); try { await navigator.clipboard.writeText(toMarkdown(it.type || tplType, tplForm)); } catch {} }}>Copier MD</button>
                              {/* Upload files */}
                              <label className="text-xs px-2 py-0.5 rounded border cursor-pointer">
                                <input type="file" className="hidden" multiple onChange={async(e)=>{ e.stopPropagation(); const files = e.target?.files; await addItemFiles(it.type || tplType, it.id, files); try { e.target.value = ''; } catch {} }} />
                                Ajouter fichier
                              </label>
                            </div>
                          {/* Inline editor */}
                          {renderForm()}

                          {/* Bottom save (as requested) */}
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <button className="text-xs px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-60" disabled={tplBusy} onClick={(e)=>{ e.stopPropagation(); saveItem(); }}>Enregistrer</button>
                          </div>

                          {/* Attachments for this item */}
                          {(() => { const cur = ensureArray(tplData[it.type || tplType]).find(x => x && x.id === it.id) || it; const files = Array.isArray(cur.files) ? cur.files : []; return (
                            <div className="mt-2">
                              <div className="text-xs text-gray-600 mb-1">Fichiers ({files.length})</div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                {files.map((f) => (
                                  <div key={f.id} className="border rounded p-2 bg-white">
                                    <div className="text-xs font-medium truncate" title={f.name}>{f.name}</div>
                                    <div className="text-[11px] text-gray-500">{(f.size/1024).toFixed(1)} Ko • {f.type || 'type inconnu'}</div>
                                    {/^image\//.test(f.type||'') && (
                                      <img src={f.dataUrl} alt={f.name} className="mt-2 max-h-32 object-contain border rounded" />
                                    )}
                                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                                      <a className="text-xs px-2 py-0.5 border rounded" href={f.dataUrl} download={f.name} target="_blank" rel="noreferrer">Ouvrir/Télécharger</a>
                                      <button className="text-xs px-2 py-0.5 border rounded text-red-700" onClick={(e)=>{ e.stopPropagation(); removeItemFile(it.type || tplType, it.id, f.id); }}>Supprimer</button>
                                    </div>
                                    <div className="text-[11px] text-gray-500 mt-1">Ajouté: {f.added_at ? new Date(f.added_at).toLocaleString() : ''}</div>
                                  </div>
                                ))}
                                {!files.length && (
                                  <div className="text-xs text-gray-500">Aucun fichier.</div>
                                )}
                              </div>
                            </div>
                          ); })()}

                          {/* Older versions */}
                          <div className="mt-3">
                            <div className="text-xs text-gray-600 mb-1">Anciennes versions ({Array.isArray(it.history)?it.history.length:0})</div>
                              <div className="space-y-2">
                                {(Array.isArray(it.history)?it.history:[]).slice().reverse().map((h, idx) => (
                                  <div key={idx} className="">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <span className="text-[11px] text-gray-500">{new Date(h.ts).toLocaleString()}</span>
                                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={async(e)=>{ e.stopPropagation(); try { await navigator.clipboard.writeText(toMarkdown(it.type || tplType, h.data || {})); } catch {} }}>Copier MD</button>
                                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={(e)=>{ e.stopPropagation(); setTplType(it.type || 'userStories'); setTplEditingId(it.id); setTplForm({ ...(h.data||{}) }); }}>Restaurer dans éditeur</button>
                                    </div>
                                    <pre className="text-[11px] bg-white border rounded p-2 whitespace-pre-wrap overflow-auto">{toMarkdown(it.type || tplType, h.data || {})}</pre>
                                  </div>
                                ))}
                              {!(Array.isArray(it.history)?it.history.length:0) && (
                                <div className="text-[11px] text-gray-500">Aucun historique.</div>
                              )}
                             </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {histOpenId===it.id && (
                        <tr>
                          <td colSpan={2} className="px-2 py-2 bg-gray-50">
                            <div className="text-xs text-gray-600 mb-1">Historique ({Array.isArray(it.history)?it.history.length:0})</div>
                            <div className="space-y-2">
                              {(Array.isArray(it.history)?it.history:[]).slice().reverse().map((h, idx) => (
                                <div key={idx}>
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className="text-[11px] text-gray-500">{new Date(h.ts).toLocaleString()}</span>
                                    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={async()=>{ try { await navigator.clipboard.writeText(toMarkdown(it.type || tplType, h.data || {})); } catch {} }}>Copier MD</button>
                                    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>{ setTplType(it.type || 'userStories'); setTplEditingId(it.id); setTplForm({ ...(h.data||{}) }); document.getElementById('tpl-panel-anchor')?.scrollIntoView({ behavior:'smooth' }); }}>Restaurer dans éditeur</button>
                                  </div>
                                  <pre className="text-[11px] bg-white border rounded p-2 whitespace-pre-wrap overflow-auto">{toMarkdown(it.type || tplType, h.data || {})}</pre>
                                </div>
                              ))}
                              {!(Array.isArray(it.history)?it.history.length:0) && (
                                <div className="text-[11px] text-gray-500">Aucun historique.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {!ensureArray(allItemsSorted).length && (
                    <tr><td className="px-2 py-2 text-gray-500" colSpan={2}>Aucun élément</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Guide du template déplacé dans Détails du projet */}
          </div>
        )}

        {/* Templates manager */}
        {projectId && (projects.find(p=>p.id===projectId)?.template === 'lightpm') && (
          <div className="p-3 border rounded bg-white mt-4">
            <div className="font-medium mb-2">Templates (Lightweight)</div>
            {/* Outline */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              {[
                { key:'userStories', label:'14.1 User Story' },
                { key:'bugs', label:'14.2 Bug Report' },
                { key:'techTasks', label:'14.3 Tech Task' },
                { key:'rfcs', label:'14.4 RFC' },
                { key:'prs', label:'14.5 PR Template' },
                { key:'adrs', label:'14.6 ADR' },
                { key:'incidents', label:'14.7 Incident' },
                { key:'ideas', label:'14.8 Idea/Request' },
              ].map((s) => (
                <div key={s.key} className="border rounded p-2 bg-white">
                  <div className="text-xs text-gray-500">{s.label}</div>
                  <div className="text-sm font-medium">{(ensureArray(tplData[s.key]).length)} item(s)</div>
                  <div className="flex items-center gap-2 mt-2">
                    <button className="text-xs px-2 py-0.5 border rounded" onClick={()=>{ setTplType(s.key); setTplEditingId('__new__'); setTplForm({}); document.getElementById('tpl-panel-anchor')?.scrollIntoView({ behavior:'smooth' }); }}>Ajouter</button>
                    <button className="text-xs px-2 py-0.5 border rounded" onClick={()=>{ setTplType(s.key); setTplEditingId(''); document.getElementById('tpl-panel-anchor')?.scrollIntoView({ behavior:'smooth' }); }}>Voir</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2 flex-wrap mb-3">
              <div>
                <div className="text-xs mb-1">Type</div>
                <select className="border rounded px-2 py-1" value={tplType} onChange={(e)=>{ setTplType(e.target.value); cancelEdit(); }}>
                  <option value="userStories">14.1 User Story</option>
                  <option value="bugs">14.2 Bug Report</option>
                  <option value="techTasks">14.3 Tech Task</option>
                  <option value="rfcs">14.4 RFC</option>
                  <option value="prs">14.5 PR Template</option>
                  <option value="adrs">14.6 ADR</option>
                  <option value="incidents">14.7 Incident Report</option>
                  <option value="ideas">14.8 Idea/Request</option>
                </select>
              </div>
              <button className="px-3 py-1 rounded border" onClick={startNew}>Nouveau</button>
              {tplEditingId && (
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-60" disabled={tplBusy} onClick={saveItem}>{tplBusy?'…':'Enregistrer'}</button>
                  <button className="px-3 py-1 rounded border" onClick={cancelEdit}>Annuler</button>
                  <button className="px-3 py-1 rounded border" onClick={async()=>{ try { await navigator.clipboard.writeText(toMarkdown(tplType, tplForm)); } catch {} }}>Copier MD</button>
                </div>
              )}
            </div>
            <span id="tpl-panel-anchor" />
            {!rowOpenId ? (
              renderForm()
            ) : (
              <div className="text-xs text-gray-500">Édition en ligne ouverte ci-dessus.</div>
            )}

          </div>
        )}
      </main>
    </div>
  );
}
