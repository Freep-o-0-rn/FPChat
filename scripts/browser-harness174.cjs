'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }

exports.run = async function run(task) {
  const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpchat-174-'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.env.FPCHAT_TEST_NODE || process.execPath,
    ['-r', './src/message-actions-bootstrap.js', 'server.js'], {
      cwd:root, env:{...process.env, APP_HOST:'127.0.0.1', APP_PORT:String(port), DATABASE_PATH:path.join(temp,'test.sqlite'), VAPID_PUBLIC_KEY:'', VAPID_PRIVATE_KEY:''},
      stdio:['ignore','pipe','pipe']
    });
  let browser;
  try {
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(Error('Server startup timeout')), 15000);
      server.stdout.on('data', chunk => { if (chunk.toString().includes('FPChat listening')) {clearTimeout(timer);resolve();} });
      server.stderr.on('data', chunk => process.stderr.write(chunk));
      server.once('error', reject);
      server.once('exit', code => {clearTimeout(timer);reject(Error(`Server exited: ${code}`));});
    });
    browser = await playwright.chromium.launch({headless:true, executablePath:process.env.BROWSER_EXECUTABLE_PATH || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
    const errors = [];
    const origin = `http://127.0.0.1:${port}`;
    const newClient = async (prepare) => {
      const page = await browser.newPage({viewport:{width:1100,height:760}});
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.dismiss());
      if(prepare)await prepare(page);
      await page.goto(origin);
      await page.waitForFunction(() => window.FPMediaSend170 && window.FPVoice && window.FPViewport173 && !document.getElementById('bootHold152'));
      return page;
    };
    await task({browser,newClient,origin,errors,temp,root});
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null) {server.kill();await new Promise(resolve => server.once('exit',resolve));}
    fs.rmSync(temp,{recursive:true,force:true});
  }
};
