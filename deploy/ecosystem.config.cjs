module.exports = {
  apps: [{
    name: 'mercado-superamplitude',
    script: 'src/server.js',
    cwd: process.env.APP_DIR || '/home/mercado/htdocs/mercado.superamplitude.com',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '700M',
    env: { NODE_ENV: 'production', PORT: 3010 }
  }]
};
