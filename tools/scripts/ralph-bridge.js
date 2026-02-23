#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const PORT = Number.parseInt(process.env.RALPH_BRIDGE_PORT || '8765', 10);
const RALPH_REPO_PATH = process.env.RALPH_REPO_PATH;
const RALPH_N8N_PATH = process.env.RALPH_N8N_PATH;
const RALPH_PRD_JSON = process.env.RALPH_PRD_JSON;
const RALPH_STATE_FILE = process.env.RALPH_STATE_FILE;
const RALPH_CLAUDE_MD = process.env.RALPH_CLAUDE_MD;
const RALPH_ARCHIVE_DIR = process.env.RALPH_ARCHIVE_DIR;
const RALPH_WEBHOOK_TOKEN = process.env.RALPH_WEBHOOK_TOKEN;
const RALPH_ITERATION_TIMEOUT = Number.parseInt(process.env.RALPH_ITERATION_TIMEOUT || '18000', 10);

const missingEnvVars = [];
if (!RALPH_REPO_PATH) missingEnvVars.push('RALPH_REPO_PATH');
if (!RALPH_N8N_PATH) missingEnvVars.push('RALPH_N8N_PATH');
if (!RALPH_PRD_JSON) missingEnvVars.push('RALPH_PRD_JSON');
if (!RALPH_STATE_FILE) missingEnvVars.push('RALPH_STATE_FILE');
if (!RALPH_CLAUDE_MD) missingEnvVars.push('RALPH_CLAUDE_MD');
if (!RALPH_ARCHIVE_DIR) missingEnvVars.push('RALPH_ARCHIVE_DIR');
if (!RALPH_WEBHOOK_TOKEN) missingEnvVars.push('RALPH_WEBHOOK_TOKEN');

if (missingEnvVars.length > 0) {
  logError(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

if (!Number.isFinite(PORT) || PORT <= 0) {
  logError('RALPH_BRIDGE_PORT must be a positive integer');
  process.exit(1);
}
if (!Number.isFinite(RALPH_ITERATION_TIMEOUT) || RALPH_ITERATION_TIMEOUT <= 0) {
  logError('RALPH_ITERATION_TIMEOUT must be a positive integer (seconds)');
  process.exit(1);
}

const DEFAULT_STATE = {
  running: false,
  jobId: null,
  iteration: 0,
  maxIterations: 10,
  startedAt: null,
  tool: null,
  callbackUrl: null,
  childPid: null,
};

const STATE_PATH = path.join(RALPH_N8N_PATH, RALPH_STATE_FILE);
const PRD_PATH = path.join(RALPH_REPO_PATH, RALPH_PRD_JSON);
const PROMPT_PATH = path.join(RALPH_REPO_PATH, RALPH_CLAUDE_MD);
const ARCHIVE_PATH = path.join(RALPH_REPO_PATH, RALPH_ARCHIVE_DIR);

let activeChild = null;
let abortRequested = false;
let iterationTimer = null;
let timedOut = false;

function isChildStillRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logError(message) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
}

function logWarn(message) {
  console.warn(`[${new Date().toISOString()}] WARN: ${message}`);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...DEFAULT_STATE };
    }

    logWarn(`Failed to load state file, falling back to default state: ${error.message}`);
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  const nextState = { ...DEFAULT_STATE, ...state };
  const stateDir = path.dirname(STATE_PATH);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(nextState, null, 2)}\n`, 'utf-8');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        const data = Buffer.concat(chunks).toString();
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleGetStatus(res) {
  const state = loadState();
  sendJson(res, 200, state);
}

function handleGetPrd(res) {
  try {
    const content = fs.readFileSync(PRD_PATH, 'utf-8');
    const prd = JSON.parse(content);
    sendJson(res, 200, prd);
  } catch (error) {
    sendJson(res, 500, {
      error: 'read_failed',
      message: `Could not read PRD file at ${RALPH_PRD_JSON}: ${error.message}`,
    });
  }
}

function clearIterationTimer() {
  if (iterationTimer) {
    clearTimeout(iterationTimer);
    iterationTimer = null;
  }
}

async function handlePostRunRalph(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'bad_request', message: 'Invalid JSON' });
    return;
  }

  const { tool, callbackUrl, maxIterations } = body;

  if (!tool || !callbackUrl || maxIterations === undefined || maxIterations === null) {
    sendJson(res, 400, {
      error: 'bad_request',
      message: 'Missing required fields: tool, callbackUrl, maxIterations',
    });
    return;
  }

  if (!['claude', 'codex'].includes(tool)) {
    sendJson(res, 400, {
      error: 'bad_request',
      message: 'tool must be "claude" or "codex"',
    });
    return;
  }

  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    sendJson(res, 400, {
      error: 'bad_request',
      message: 'maxIterations must be a positive integer',
    });
    return;
  }

  const state = loadState();

  if (state.running) {
    sendJson(res, 200, {
      status: 'already_running',
      jobId: state.jobId,
    });
    return;
  }

  state.maxIterations = maxIterations;
  if (state.iteration >= maxIterations) {
    sendJson(res, 200, {
      status: 'max_iterations_reached',
      iteration: state.iteration,
      maxIterations: state.maxIterations,
    });
    return;
  }

  const jobId = crypto.randomUUID();
  state.iteration += 1;
  state.running = true;
  state.jobId = jobId;
  state.startedAt = new Date().toISOString();
  state.tool = tool;
  state.callbackUrl = callbackUrl;

  spawnCli(state, jobId);
  sendJson(res, 200, { status: 'started', jobId });
}

function spawnCli(state, jobId) {
  let prompt;
  try {
    prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  } catch (error) {
    logError(`Failed to read prompt file: ${error.message}`);
    state.running = false;
    state.childPid = null;
    saveState(state);
    sendCallback(state, { success: false, exitCode: null, timedOut: false, aborted: false, logFile: null });
    return;
  }

  let command;
  let args;
  if (state.tool === 'claude') {
    command = 'claude';
    args = ['--dangerously-skip-permissions', '--no-session-persistence', '--print', prompt];
  } else {
    command = 'codex';
    args = ['exec', '--dangerously-bypass-approvals-and-sandbox', prompt];
  }

  let logFilename;
  let logPath;
  let logStream;
  try {
    fs.mkdirSync(ARCHIVE_PATH, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
    logFilename = `iteration_${state.iteration}_${timestamp}.log`;
    logPath = path.join(ARCHIVE_PATH, logFilename);
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch (error) {
    logError(`Failed to initialize archive log: ${error.message}`);
    state.running = false;
    state.childPid = null;
    saveState(state);
    sendCallback(state, { success: false, exitCode: null, timedOut: false, aborted: false, logFile: null });
    return;
  }

  log(`Spawning ${command} for iteration ${state.iteration} (job ${jobId})`);
  log(`Archive log: ${logPath}`);

  let child;
  try {
    child = spawn(command, args, {
      cwd: RALPH_REPO_PATH,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    logError(`Failed to spawn ${command}: ${error.message}`);
    logStream.end();
    state.running = false;
    state.childPid = null;
    saveState(state);
    sendCallback(state, { success: false, exitCode: null, timedOut: false, aborted: false, logFile: null });
    return;
  }

  activeChild = child;
  abortRequested = false;
  timedOut = false;
  let errorFired = false;
  if (child.stdin) {
    child.stdin.end();
  }
  if (child.stdout) {
    child.stdout.pipe(logStream);
  }
  if (child.stderr) {
    child.stderr.pipe(logStream);
  }

  state.childPid = child.pid ?? null;
  saveState(state);

  const timeoutSeconds = RALPH_ITERATION_TIMEOUT;
  const timeoutMs = timeoutSeconds * 1000;
  log(`Iteration timeout set: ${timeoutSeconds}s (${timeoutMs}ms)`);

  iterationTimer = setTimeout(() => {
    if (isChildStillRunning(activeChild)) {
      log(`Timeout reached for job ${state.jobId} after ${timeoutSeconds}s`);
      timedOut = true;

      activeChild.kill('SIGTERM');
      setTimeout(() => {
        if (isChildStillRunning(activeChild)) {
          log(`SIGKILL escalation after timeout for job ${state.jobId}`);
          activeChild.kill('SIGKILL');
        }
      }, 5000);
    }
  }, timeoutMs);

  child.on('close', (exitCode, signal) => {
    if (errorFired) {
      log(`Skipping close callback for job ${jobId} (spawn error already handled)`);
      return;
    }
    log(`CLI exited: exitCode=${exitCode}, signal=${signal}, job=${jobId}`);
    clearIterationTimer();
    const wasAborted = abortRequested;
    const wasTimedOut = timedOut;
    abortRequested = false;
    timedOut = false;
    activeChild = null;
    logStream.end();

    const currentState = loadState();
    if (currentState.jobId !== jobId) {
      log(`Ignoring exit for stale job ${jobId} (current: ${currentState.jobId})`);
      return;
    }

    currentState.running = false;
    currentState.childPid = null;
    saveState(currentState);

    const success = !wasAborted && !wasTimedOut && exitCode === 0;
    const relativeLogFile = path.join(RALPH_ARCHIVE_DIR, logFilename);

    sendCallback(currentState, {
      success,
      exitCode: wasTimedOut ? 124 : (exitCode ?? null),
      timedOut: wasTimedOut,
      aborted: wasAborted,
      logFile: relativeLogFile,
    });
  });

  child.on('error', (error) => {
    errorFired = true;
    logError(`Failed to spawn ${command}: ${error.message}`);
    clearIterationTimer();
    abortRequested = false;
    timedOut = false;
    activeChild = null;
    logStream.end();

    const currentState = loadState();
    if (currentState.jobId !== jobId) {
      return;
    }

    currentState.running = false;
    currentState.childPid = null;
    saveState(currentState);

    sendCallback(currentState, {
      success: false,
      exitCode: null,
      timedOut: false,
      aborted: false,
      logFile: null,
    });
  });
}

function handlePostAbort(res) {
  const state = loadState();

  if (!state.running) {
    sendJson(res, 200, { status: 'idle', jobId: null });
    return;
  }

  const jobId = state.jobId;
  log(`Aborting job ${jobId} (PID ${state.childPid})`);
  abortRequested = true;

  if (activeChild) {
    activeChild.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      if (isChildStillRunning(activeChild)) {
        log(`SIGKILL escalation for job ${jobId}`);
        activeChild.kill('SIGKILL');
      }
    }, 5000);

    activeChild.once('close', () => {
      clearTimeout(killTimer);
    });
  } else if (state.childPid) {
    try {
      process.kill(state.childPid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(state.childPid, 'SIGKILL');
        } catch {
          // Process may have exited before escalation.
        }
      }, 5000);
    } catch (error) {
      log(`PID ${state.childPid} already dead: ${error.message}`);
    }
  }

  sendJson(res, 200, { status: 'aborting', jobId });
}

function sendCallback(state, result) {
  if (!state.callbackUrl) {
    logError('Callback URL missing; unable to notify n8n');
    return;
  }

  let callbackUrl;
  try {
    callbackUrl = new URL(state.callbackUrl);
  } catch (error) {
    logError(`Invalid callback URL "${state.callbackUrl}": ${error.message}`);
    return;
  }

  const payload = {
    action: 'done',
    jobId: state.jobId,
    iteration: state.iteration,
    tool: state.tool,
    success: result.success,
    callbackUrl: state.callbackUrl,
    maxIterations: state.maxIterations,
    exitCode: result.exitCode ?? null,
    timedOut: result.timedOut ?? false,
    aborted: result.aborted ?? false,
    logFile: result.logFile ?? null,
  };

  const body = JSON.stringify(payload);
  const transport = callbackUrl.protocol === 'https:' ? https : http;
  const requestOptions = {
    hostname: callbackUrl.hostname,
    port: callbackUrl.port || (callbackUrl.protocol === 'https:' ? 443 : 80),
    path: callbackUrl.pathname + callbackUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Authorization: `Bearer ${RALPH_WEBHOOK_TOKEN}`,
    },
  };

  log(`Sending callback to ${state.callbackUrl}: success=${result.success}`);

  const callbackReq = transport.request(requestOptions, (callbackRes) => {
    let responseBody = '';
    callbackRes.on('data', (chunk) => {
      responseBody += chunk;
    });
    callbackRes.on('end', () => {
      if (callbackRes.statusCode >= 200 && callbackRes.statusCode < 300) {
        log(`Callback accepted (${callbackRes.statusCode})`);
      } else {
        logError(`Callback rejected (${callbackRes.statusCode}): ${responseBody}`);
      }
    });
  });

  callbackReq.on('error', (error) => {
    logError(`Callback failed: ${error.message}`);
  });

  callbackReq.write(body);
  callbackReq.end();
}

async function handlePostReset(req, res) {
  try {
    await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'bad_request', message: 'Invalid JSON' });
    return;
  }

  const state = loadState();

  if (state.running) {
    sendJson(res, 409, {
      error: 'conflict',
      message: 'Cannot reset while running. Call POST /abort first.',
    });
    return;
  }

  state.iteration = 0;
  state.jobId = null;
  state.startedAt = null;
  state.tool = null;
  state.callbackUrl = null;
  state.childPid = null;
  state.running = false;

  saveState(state);
  sendJson(res, 200, { status: 'reset' });
}

function resetOrphanedState(state) {
  state.running = false;
  state.childPid = null;
  saveState(state);

  if (state.callbackUrl) {
    sendCallback(state, {
      success: false,
      exitCode: null,
      timedOut: false,
      aborted: false,
      logFile: null,
    });
  } else {
    log('No callbackUrl stored — cannot notify n8n of orphaned process');
  }
}

function checkOrphanedProcess(state) {
  if (!state.running) {
    return;
  }

  const pid = state.childPid;
  if (!pid) {
    log('State shows running=true but no childPid — resetting');
    resetOrphanedState(state);
    return;
  }

  try {
    process.kill(pid, 0);
    log(`Process ${pid} is still alive — re-attaching is not supported. Killing.`);
    try {
      process.kill(pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may already be dead.
        }
      }, 5000);
    } catch {
      // Ignore kill failures and continue with state recovery.
    }
    setTimeout(() => {
      resetOrphanedState(state);
    }, 6000);
  } catch {
    log(`Orphaned process ${pid} is dead — sending failure callback`);
    resetOrphanedState(state);
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const requestUrl = req.url || '/';
  const pathname = new URL(requestUrl, 'http://localhost').pathname;

  log(`${method} ${pathname}`);

  if (method === 'GET' && pathname === '/status') {
    handleGetStatus(res);
    return;
  }

  if (method === 'GET' && pathname === '/prd.json') {
    handleGetPrd(res);
    return;
  }

  if (method === 'POST' && pathname === '/reset') {
    await handlePostReset(req, res);
    return;
  }

  if (method === 'POST' && pathname === '/abort') {
    handlePostAbort(res);
    return;
  }

  if (method === 'POST' && pathname === '/run-ralph') {
    await handlePostRunRalph(req, res);
    return;
  }

  sendJson(res, 404, { error: 'not_found', message: 'Unknown endpoint' });
});

const startupState = loadState();
if (!fs.existsSync(STATE_PATH)) {
  saveState(startupState);
}
checkOrphanedProcess(startupState);

server.listen(PORT, '0.0.0.0', () => {
  log(`ralph-bridge listening on 0.0.0.0:${PORT}`);
  log(`state: running=${startupState.running}, iteration=${startupState.iteration}`);
});
