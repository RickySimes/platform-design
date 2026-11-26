#!/usr/bin/env node
// The design check: reads the platform design files in this repo and reports every rule they break.
// It only parses files. It never runs anything from the repo. Run it with `npm run check`.
// Every rule has an id (P1, T4, ...). The course module that introduces a file explains its rules.
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const problems = [];
const report = [];
const fail = (file, id, msg) => problems.push({ file, id, msg });

const TEAM_TYPES = ['stream-aligned', 'platform', 'enabling', 'complicated-subsystem'];
const MODES = ['collaboration', 'x-as-a-service', 'facilitating'];
const LAYERS = ['interfaces', 'agent-control', 'context', 'model-gateway', 'delivery', 'runtime', 'observe-cost-trust'];
const STATUSES = ['offered', 'beta', 'planned'];
const SELF_SERVICE = ['portal', 'cli', 'api', 'git', 'mcp'];
const INTERFACES = [...SELF_SERVICE, 'ticket'];
const MACHINE = ['api', 'mcp', 'git', 'cli'];
const USERS = ['humans', 'agents'];
const METRIC_KINDS = ['delivery', 'stability', 'adoption', 'experience', 'cost'];
// A mission is an outcome for people, not a tool roll-out.
const TOOLS = /\b(kubernetes|k8s|backstage|argo ?cd|argo|terraform|opentofu|helm|crossplane|jenkins|github actions|gitlab|istio|docker|openshift|port|humanitec|cortex)\b/i;
// Output counts that rise even when outcomes get worse.
const VANITY = /(lines? of code|\bloc\b|number of (pull requests|prs|commits|deploy(ment)?s per developer)|(pull requests|prs|commits) (per|merged)|(%|percent|share) of code (written|generated) by ai|ai[- ]generated code (share|%|percent)|code written by ai)/i;
const READ_ONLY = /^(read|get|list|describe|view|search|plan)\b/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => typeof x === 'string' && x.trim() !== '';

let loadMark = 0;
function load(rel) {
  loadMark = problems.length;
  if (!exists(rel)) return undefined;
  const doc = parseDocument(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { prettyErrors: true });
  if (doc.errors.length) {
    for (const e of doc.errors) fail(rel, 'Y1', `not valid YAML: ${e.message.split('\n')[0].replace(/:$/, '')}`);
    return null;
  }
  const v = doc.toJS();
  if (v === null || typeof v !== 'object' || Array.isArray(v)) { fail(rel, 'Y1', 'must be a YAML mapping (key: value) at the top'); return null; }
  return v;
}
function section(rel, v) {
  const before = loadMark;
  return () => report.push([rel, v === undefined ? 'not written yet' : problems.slice(before).length ? 'FAIL' : 'ok']);
}

// ---------- platform.yaml: the platform as a product ----------
const PF = 'platform.yaml';
const platform = load(PF);
let done = section(PF, platform);
if (platform) {
  if (!str(platform.name)) fail(PF, 'P1', '`name` is missing');
  if (!str(platform.mission)) fail(PF, 'P1', '`mission` is missing');
  else if (TOOLS.test(platform.mission)) fail(PF, 'P2', `the mission names a tool ("${platform.mission.match(TOOLS)[0]}"). Say what changes for the users, not what you install`);
  if (!str(platform.productOwner)) fail(PF, 'P3', '`productOwner` is missing: a product without an owner is a project');
  if (!str(platform.owner)) fail(PF, 'P3', '`owner` (the team that runs the platform) is missing');
  const users = arr(platform.users);
  if (!users.length) fail(PF, 'P4', '`users` is empty: a platform nobody uses is not a product');
  for (const u of users) {
    if (!str(u?.id)) { fail(PF, 'P4', 'every user needs an `id`'); continue; }
    if (u.kind !== undefined && !['human', 'agent'].includes(u.kind)) fail(PF, 'P4', `user ${u.id}: kind must be human or agent`);
    const pr = arr(u.problems);
    if (!pr.length) fail(PF, 'P4', `user ${u.id} has no problems listed: what does the platform solve for them?`);
    for (const p of pr) if (!str(p?.problem) || !str(p?.evidence)) fail(PF, 'P5', `user ${u.id}: every problem needs \`problem\` and \`evidence\` (where you heard or measured it)`);
  }
  if (!arr(platform.nonGoals).length) fail(PF, 'P6', '`nonGoals` is empty: say at least one thing the platform will not do');
}
done();

// ---------- teams.yaml: who works with whom, and how ----------
const TF = 'teams.yaml';
const teamsDoc = load(TF);
done = section(TF, teamsDoc);
const teams = new Map();
if (teamsDoc) {
  const list = arr(teamsDoc.teams);
  if (list.length < 2) fail(TF, 'T1', 'list at least two teams: a platform team and a team it serves');
  for (const t of list) {
    if (!str(t?.id)) { fail(TF, 'T1', 'every team needs an `id`'); continue; }
    if (teams.has(t.id)) fail(TF, 'T1', `team id ${t.id} is used twice`);
    teams.set(t.id, t);
    if (!TEAM_TYPES.includes(t.type)) fail(TF, 'T2', `team ${t.id}: type must be one of ${TEAM_TYPES.join(', ')}`);
    if (!str(t.contact)) fail(TF, 'T2', `team ${t.id}: \`contact\` is missing (where people reach them)`);
  }
  for (const i of arr(teamsDoc.interactions)) {
    const name = `${i?.from} -> ${i?.to}`;
    for (const k of ['from', 'to']) if (!teams.has(i?.[k])) fail(TF, 'T3', `interaction ${name}: ${k} is not a team in this file`);
    if (!MODES.includes(i?.mode)) { fail(TF, 'T3', `interaction ${name}: mode must be one of ${MODES.join(', ')}`); continue; }
    if (!str(i.why)) fail(TF, 'T3', `interaction ${name}: say \`why\``);
    if (i.mode === 'collaboration' && !DATE.test(String(i.until ?? ''))) fail(TF, 'T4', `interaction ${name} is collaboration with no \`until\` date (YYYY-MM-DD). Collaboration is expensive and meant to end`);
    if (i.mode === 'collaboration' && !MODES.includes(i.then)) fail(TF, 'T4', `interaction ${name}: say what it becomes \`then\` (x-as-a-service or facilitating)`);
  }
  if (platform && str(platform.owner)) {
    const o = teams.get(platform.owner);
    if (!o) fail(TF, 'T5', `platform.yaml owner ${platform.owner} is not a team here`);
    else if (o.type !== 'platform') fail(TF, 'T5', `platform.yaml owner ${platform.owner} is a ${o.type} team, not a platform team`);
  }
}
done();
const ownerOk = (file, what, owner) => {
  if (!str(owner)) fail(file, 'O1', `${what}: \`owner\` is missing`);
  else if (teamsDoc && !teams.has(owner)) fail(file, 'O1', `${what}: owner ${owner} is not a team in teams.yaml`);
};

// ---------- capabilities.yaml: what the platform offers ----------
const CF = 'capabilities.yaml';
const capDoc = load(CF);
done = section(CF, capDoc);
const caps = new Map();
if (capDoc) {
  const list = arr(capDoc.capabilities);
  if (!list.length) fail(CF, 'C1', '`capabilities` is empty');
  for (const c of list) {
    if (!str(c?.id)) { fail(CF, 'C1', 'every capability needs an `id`'); continue; }
    if (caps.has(c.id)) fail(CF, 'C1', `capability id ${c.id} is used twice`);
    caps.set(c.id, c);
    if (!LAYERS.includes(c.layer)) fail(CF, 'C1', `${c.id}: layer must be one of ${LAYERS.join(', ')}`);
    if (!STATUSES.includes(c.status)) fail(CF, 'C1', `${c.id}: status must be one of ${STATUSES.join(', ')}`);
    ownerOk(CF, c.id, c.owner);
    const ifs = arr(c.interfaces);
    for (const x of ifs) if (!INTERFACES.includes(x)) fail(CF, 'C2', `${c.id}: unknown interface ${x} (use ${INTERFACES.join(', ')})`);
    if (c.status !== 'planned' && !ifs.some((x) => SELF_SERVICE.includes(x))) fail(CF, 'C2', `${c.id} is ${c.status} but only through a ticket. A ticket queue is not self-service: give it a portal, CLI, API, Git or MCP interface, or mark it planned`);
    const us = arr(c.users);
    if (!us.length || us.some((u) => !USERS.includes(u))) fail(CF, 'C3', `${c.id}: users must list humans and/or agents`);
    if (us.includes('agents') && !ifs.some((x) => MACHINE.includes(x))) fail(CF, 'C3', `${c.id} says agents use it, but it has no interface a program can call (api, mcp, git or cli)`);
  }
}
done();

// ---------- golden-paths/*.yaml: the paved road ----------
const GP = 'golden-paths';
const pathFiles = exists(GP) ? fs.readdirSync(path.join(ROOT, GP)).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
const paths = new Map();
if (!pathFiles.length) report.push([GP + '/', 'not written yet']);
for (const f of pathFiles) {
  const rel = `${GP}/${f}`;
  const g = load(rel);
  done = section(rel, g);
  if (g) {
    if (!str(g.id) || !str(g.name)) fail(rel, 'G1', '`id` and `name` are required');
    else paths.set(g.id, g);
    ownerOk(rel, g.id || f, g.owner);
    const forU = arr(g.for);
    if (!forU.length || forU.some((u) => !USERS.includes(u))) fail(rel, 'G1', '`for` must list humans and/or agents');
    const steps = arr(g.steps);
    if (!steps.length) fail(rel, 'G2', '`steps` is empty');
    for (const s of steps) {
      if (!str(s?.t)) fail(rel, 'G2', 'every step needs a title `t`');
      if (s?.capability === undefined) continue;
      const c = caps.get(s.capability);
      if (capDoc && !c) fail(rel, 'G2', `step "${s.t}": capability ${s.capability} is not in capabilities.yaml`);
      else if (c && c.status === 'planned') fail(rel, 'G2', `step "${s.t}" uses ${s.capability}, which is only planned. A path can only pave with what exists today`);
      else if (c && forU.includes('agents') && !arr(c.users).includes('agents')) fail(rel, 'G5', `step "${s.t}": the path is for agents, but ${s.capability} is not offered to agents`);
    }
    if (g.optional !== true) fail(rel, 'G3', '`optional` must be true. A path people are forced onto is a mandate; put mandatory rules in policy instead');
    if (!str(g.escapeHatch)) fail(rel, 'G3', '`escapeHatch` is missing: say what a team does when the path does not fit them');
    if (!str(g.support)) fail(rel, 'G4', '`support` is missing: an unsupported path is just a suggestion');
    if (forU.includes('agents')) {
      if (!str(g.agentInstructions)) fail(rel, 'G5', 'the path is for agents, so `agentInstructions` must name the AGENTS.md agents read');
      else if (!exists(g.agentInstructions)) fail(rel, 'G5', `agentInstructions ${g.agentInstructions} does not exist`);
    }
  }
  done();
}

// ---------- agents/policy.yaml: agents as users with limits ----------
const AF = 'agents/policy.yaml';
const pol = load(AF);
done = section(AF, pol);
if (pol) {
  if (pol.default !== 'deny') fail(AF, 'A1', '`default` must be deny: an agent may do only what is listed');
  const agents = arr(pol.agents);
  if (!agents.length) fail(AF, 'A1', '`agents` is empty');
  if (platform && !arr(platform.users).some((u) => u?.kind === 'agent')) fail(AF, 'A2', 'platform.yaml has no user with kind: agent. Agents that act on the platform are its users');
  for (const a of agents) {
    const n = a?.id || '(no id)';
    if (!str(a?.id)) fail(AF, 'A1', 'every agent needs an `id`');
    ownerOk(AF, n, a?.owner);
    if (a?.identity?.kind !== 'non-human' || !str(a?.identity?.name)) fail(AF, 'A3', `${n}: identity must be its own (kind: non-human, with a name), never a person's token`);
    if (!str(a?.actsFor)) fail(AF, 'A3', `${n}: \`actsFor\` is missing (whose request the agent carries out)`);
    if (!(Number(a?.budget?.monthlyEur) > 0)) fail(AF, 'A5', `${n}: budget.monthlyEur must be a number above 0`);
    if (a?.audit !== true) fail(AF, 'A6', `${n}: audit must be true (every action logged with the agent and the person it acts for)`);
    const envs = a?.allow && typeof a.allow === 'object' ? a.allow : {};
    if (!Object.keys(envs).length) fail(AF, 'A4', `${n}: \`allow\` lists no environment`);
    for (const [env, rules] of Object.entries(envs)) for (const r of arr(rules)) {
      const what = `${n} in ${env}: ${r?.action}`;
      if (!str(r?.action)) { fail(AF, 'A4', `${n} in ${env}: every rule needs an \`action\``); continue; }
      const c = caps.get(r.capability);
      if (capDoc && !c) fail(AF, 'A4', `${what}: capability ${r.capability} is not in capabilities.yaml`);
      else if (c && !arr(c.interfaces).some((x) => x === 'api' || x === 'mcp')) fail(AF, 'A4', `${what}: ${r.capability} has no api or mcp interface for an agent to call`);
      else if (c && !arr(c.users).includes('agents')) fail(AF, 'A4', `${what}: ${r.capability} is not offered to agents in capabilities.yaml`);
      if (env === 'prod' && !READ_ONLY.test(r.action) && r.approval !== 'human') fail(AF, 'A7', `${what} changes prod without approval: human. Writes to production need a person who says yes`);
    }
  }
}
done();

// ---------- metrics/scorecard.yaml: is it working? ----------
const MF = 'metrics/scorecard.yaml';
const sc = load(MF);
done = section(MF, sc);
const metrics = new Map();
if (sc) {
  const list = arr(sc.metrics);
  for (const m of list) {
    if (!str(m?.id) || !str(m?.name)) { fail(MF, 'M1', 'every metric needs `id` and `name`'); continue; }
    metrics.set(m.id, m);
    if (!METRIC_KINDS.includes(m.kind)) fail(MF, 'M1', `${m.id}: kind must be one of ${METRIC_KINDS.join(', ')}`);
    if (!str(m.source)) fail(MF, 'M1', `${m.id}: \`source\` is missing (where the number comes from)`);
    ownerOk(MF, m.id, m.owner);
    if (m.baseline === undefined || m.baseline === null || m.baseline === '') fail(MF, 'M2', `${m.id}: \`baseline\` is missing. Write the number today, or "unknown" and measure it first`);
    if (m.target === undefined || m.target === null || m.target === '') fail(MF, 'M2', `${m.id}: \`target\` is missing`);
    if (VANITY.test(m.name)) fail(MF, 'M3', `${m.id} ("${m.name}") counts output, not outcomes. It rises even when things get worse: move it to \`avoid\``);
  }
  for (const k of ['delivery', 'stability', 'adoption', 'experience']) if (!list.some((m) => m?.kind === k)) fail(MF, 'M4', `no ${k} metric. Measure delivery, stability, adoption and experience together`);
  if (pol && !list.some((m) => m?.kind === 'cost')) fail(MF, 'M4', 'agents have budgets in agents/policy.yaml, so add a cost metric (for example cost per merged change)');
  for (const a of arr(sc.avoid)) if (!str(a?.metric) || !str(a?.why)) fail(MF, 'M5', 'every entry in `avoid` needs `metric` and `why`');
}
done();

// ---------- docs/adr/*.md: decisions with their reasons ----------
const AD = 'docs/adr';
const adrs = exists(AD) ? fs.readdirSync(path.join(ROOT, AD)).filter((f) => /^\d{4}-[a-z0-9-]+\.md$/.test(f)).sort() : [];
if (!adrs.length) report.push([AD + '/', 'not written yet']);
for (const f of adrs) {
  const rel = `${AD}/${f}`;
  const before = problems.length;
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (!/^# \S/m.test(text)) fail(rel, 'D1', 'needs a `# ` title line');
  const st = text.match(/^Status:\s*(\w+)/mi);
  if (!st || !['proposed', 'accepted', 'superseded', 'rejected'].includes(st[1].toLowerCase())) fail(rel, 'D1', 'needs a `Status:` line: proposed, accepted, superseded or rejected');
  for (const h of ['Context', 'Options considered', 'Decision', 'Consequences']) if (!new RegExp(`^## ${h}\\s*$`, 'mi').test(text)) fail(rel, 'D2', `needs a \`## ${h}\` section`);
  const opts = (text.split(/^## Options considered\s*$/mi)[1] || '').split(/^## /m)[0];
  if ((opts.match(/^\s*[-*] /gm) || []).length < 2) fail(rel, 'D3', 'list at least two options under Options considered: a decision with one option was not a decision');
  report.push([rel, problems.length > before ? 'FAIL' : 'ok']);
}

// ---------- plan/90-days.yaml: the first 90 days ----------
const NF = 'plan/90-days.yaml';
const plan = load(NF);
done = section(NF, plan);
if (plan) {
  const phases = arr(plan.phases);
  if (phases.length !== 3) fail(NF, 'N1', 'write three phases (days 0-30, 31-60, 61-90)');
  const want = ['0-30', '31-60', '61-90'];
  phases.forEach((p, i) => {
    const n = p?.name || `phase ${i + 1}`;
    if (String(p?.days) !== want[i]) fail(NF, 'N1', `${n}: days must be ${want[i]}`);
    const items = arr(p?.items);
    if (!items.length) fail(NF, 'N2', `${n} has no items`);
    for (const it of items) {
      if (!str(it?.t)) fail(NF, 'N2', `${n}: every item needs a title \`t\``);
      for (const ref of arr(it?.builds)) if (!caps.has(ref) && !paths.has(ref)) fail(NF, 'N2', `${n}, "${it?.t}": builds ${ref}, which is no capability or golden path`);
    }
    const ex = p?.exit;
    if (!ex || !metrics.has(ex.metric) || !str(ex.when)) fail(NF, 'N3', `${n}: \`exit\` needs a \`metric\` from the scorecard and \`when\` (the result that ends the phase)`);
  });
  const ds = arr(plan.decisions);
  if (!ds.length) fail(NF, 'N4', '`decisions` is empty: link the ADR behind the plan');
  for (const d of ds) if (!exists(d)) fail(NF, 'N4', `decision ${d} does not exist`);
}
done();

// ---------- output ----------
const width = Math.max(...report.map(([f]) => f.length));
for (const [f, s] of report) console.log(`${s === 'ok' ? '  ok  ' : s === 'FAIL' ? '  FAIL' : '  -   '}  ${f.padEnd(width)}  ${s === 'FAIL' ? '' : s === 'ok' ? '' : s}`.trimEnd());
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`${p.file} [${p.id}] ${p.msg}`);
  console.log(`\n${problems.length} problem(s). Fix them and run the check again.`);
  process.exit(1);
}
console.log(report.every(([, s]) => s === 'not written yet') ? '\nNothing written yet. The check is ready.' : '\nAll checks passed.');
