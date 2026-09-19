import dotenv from 'dotenv';
import { buildRelayServer } from './server.js';

dotenv.config();

const port = Number(process.env.PORT || process.env.RELAY_PORT || 4000);
const host = process.env.RELAY_HOST || '0.0.0.0';

const { app } = buildRelayServer({ port, host });

app.listen({ port, host }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`[relay] Server running at ${address}`);
  console.log(`[relay] WebSocket endpoint ready at ws://${host === '0.0.0.0' ? 'localhost' : host}:${port}/ws`);
});
