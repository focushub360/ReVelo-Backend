import dotenv from 'dotenv';
const primaryEnv = dotenv.config({ path: new URL('./.env', import.meta.url) });
if (primaryEnv.error) dotenv.config({ path: new URL('./src/.env', import.meta.url) });
const mongoose = (await import('mongoose')).default;
const { env } = await import('./src/config/env.js');
const { connectDatabase } = await import('./src/config/database.js');
const { default: app } = await import('./src/app.js');
let server;
try {
  await connectDatabase();
  server = app.listen(env.PORT, () =>
    console.log(JSON.stringify({ level: 'info', event: 'server_started', port: env.PORT }))
  );
} catch (error) {
  console.error(JSON.stringify({ level: 'fatal', event: 'startup_failed', message: error.message }));
  process.exit(1);
}
async function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', event: 'shutdown', signal }));
  server?.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
