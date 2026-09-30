// PM2 app for the shared demos box. A fixed NODE_APP_INSTANCE makes @colyseus/tools bind
// /run/colyseus/<2567 + NODE_APP_INSTANCE>.sock, which nginx routes /one-prompt-game/<port>/ to.
const SLUG      = 'one-prompt-game';
const BASE      = 113;   // first socket 2567 + 113 = 2680
const INSTANCES = 1;     // reserved decade 2680-2689; one process needs no Redis

module.exports = {
  apps: Array.from({ length: INSTANCES }, (_, i) => ({
    name: `${SLUG}-${i}`,
    script: 'dist/server/server.mjs',
    instances: 1,
    exec_mode: 'fork',
    wait_ready: true,
    listen_timeout: 20000,
    kill_timeout: 15000,
    max_memory_restart: '300M',
    autorestart: true,
    time: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      NODE_APP_INSTANCE: String(BASE + i),
      PUBLIC_ADDRESS_BASE: `demos.colyseus.cloud/${SLUG}`,
    },
  })),
};
