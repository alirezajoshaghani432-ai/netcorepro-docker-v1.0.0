module.exports = {
  apps: [{
    name: 'netcorepro',
    script: 'dist/server.js',
    node_args: '--env-file=.env',
    cwd: '/home/root/webapp/netcorepro',
    env: {
      NODE_ENV: 'production'
    },
    autorestart: true,
    max_restarts: 20,
    watch: false,
    out_file: '/home/root/webapp/netcorepro/pm2-out.log',
    error_file: '/home/root/webapp/netcorepro/pm2-err.log'
  }]
};
