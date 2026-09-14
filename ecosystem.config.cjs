module.exports = {
  apps: [{
    name: 'diagnosty-anketa',
    cwd: __dirname,
    script: 'tools/serve.cjs',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '160M',
    kill_timeout: 6000,
    time: true,
    env: {
      NODE_ENV: 'production',
      PORT: '4173',
      DEPLOY_REVISION: process.env.DEPLOY_REVISION || 'local'
    }
  }]
};
