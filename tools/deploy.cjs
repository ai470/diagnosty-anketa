const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
process.chdir(root);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return (result.stdout || '').trim();
}
const git = (...args) => run('git', args, {stdio: 'pipe'});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function committedBytes(revision, file) {
  const result = spawnSync('git', ['show', `${revision}:${file}`], {cwd: root, maxBuffer: 10 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`Cannot read committed file: ${file}`);
  return result.stdout;
}

async function main() {
  if (git('branch', '--show-current') !== 'main') throw new Error('Deploy only from main.');
  if (git('status', '--porcelain')) throw new Error('Commit all changes before deploying.');
  const revision = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid revision.');
  const key = process.env.DEPLOY_SSH_KEY || path.join(os.homedir(), '.ssh', 'id_ed25519');
  if (!fs.existsSync(key)) throw new Error(`SSH key not found: ${key}`);
  const host = process.env.DEPLOY_HOST || 'root@111.88.251.214';
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host) || host.startsWith('-')) throw new Error('Invalid SSH host.');
  console.log('Running tests before publication…');
  run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(f=>f.endsWith('.test.cjs')).map(f=>`tests/${f}`)]);
  run('git', ['push', 'origin', 'HEAD:main']);
  console.log(`Deploying ${revision} using PM2…`);
  run('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', host, `bash -s -- ${revision}`], {
    input: fs.readFileSync(path.join(__dirname, 'deploy-remote.sh'), 'utf8').replace(/\r\n/g, '\n'),
    stdio: ['pipe', 'inherit', 'inherit']
  });
  // Check actual public bytes, not just a successful HTTP status or an old page.
  const site = 'https://diagnostika-anketa.monterium-edu.ru';
  const resources = ['index.html', ...fs.readdirSync('assets', {recursive:true}).filter(f=>/\.(css|js|ttf)$/.test(f)).map(f=>'assets/'+f.replaceAll('\\','/'))];
  for (const file of resources) {
    const response = await fetch(`${site}/${file}?deploy=${revision}`, {signal: AbortSignal.timeout(15000)});
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(committedBytes(revision, file))) throw new Error(`Public resource mismatch: ${file}. Remote deployment completed; inspect the public proxy/cache.`);
  }
  console.log(`Deployed ${revision}: ${site}. Verified ${resources.length} public resources.`);
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
