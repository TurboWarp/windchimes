import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import pathUtil from 'node:path';
import { after, test } from 'node:test';

const ENTRY_POINT = pathUtil.join(import.meta.dirname, '../src/index.js');
const PORT = 20000 + Math.floor(Math.random() * 10000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ID = '60917032';

const stateDirectory = await fsPromises.mkdtemp(pathUtil.join(os.tmpdir(), 'windchimes-test-'));

const startServer = () => new Promise((resolve, reject) => {
  const child = childProcess.spawn(process.execPath, [ENTRY_POINT], {
    env: {
      ...process.env,
      PORT: `${PORT}`,
      STATE_DIRECTORY: stateDirectory,
      METRICS_PORT: ''
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });

  let stdout = '';
  child.stdout.on('data', (data) => {
    process.stdout.write(data);
    stdout += data;
    if (stdout.includes('Started on port')) {
      resolve(child);
    }
  });
  child.on('error', reject);
  child.on('exit', (code) => reject(new Error(`Server exited early with code ${code}`)));
});

const stopServer = (child) => new Promise((resolve) => {
  child.removeAllListeners('exit');
  child.on('exit', (code) => {
    assert.equal(code, 0);
    resolve();
  });
  child.kill('SIGTERM');
});

const getViews = async () => {
  const res = await fetch(`${BASE_URL}/api/scratch/${PROJECT_ID}`);
  const json = await res.json();
  return json.total;
};

const submitView = async () => {
  const res = await fetch(`${BASE_URL}/api/chime`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      resource: `scratch/${PROJECT_ID}`,
      event: 'view/index'
    })
  });
  assert.equal(res.status, 200);
};

after(async () => {
  await fsPromises.rm(stateDirectory, {
    recursive: true,
    force: true
  });
});

test('can submit views and they get counted', async () => {
  const serverA = await startServer();
  const before = await getViews();
  await submitView();
  await stopServer(serverA);

  const serverB = await startServer();
  const afterRestart = await getViews();
  await stopServer(serverB);

  assert.equal(afterRestart, before + 1);
});
