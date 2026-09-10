const path = require('path');

// Resolved from this file so the app can be deployed to any directory
// without editing the process manager configuration.
const ROOT = __dirname;

module.exports = {
  apps: [{
    name: 'netcorepro',
    script: path.join(ROOT, 'dist/server.js'),
    node_args: '--env-file=.env',
    cwd: ROOT,
    env: {
      NODE_ENV: 'production'
    },
    autorestart: true,
    max_restarts: 20,
    watch: false,
    out_file: path.join(ROOT, 'logs/pm2-out.log'),
    error_file: path.join(ROOT, 'logs/pm2-err.log')
  }]
};
