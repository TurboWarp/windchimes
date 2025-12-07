import fsPromises from 'node:fs/promises';
import { PORT, UNIX_SOCKET_PERMISSIONS } from './config.js';
import { app } from './server.js';
import { flushToDatabase, startTimers } from './counter.js';

app.listen(PORT, () => {
  // Update permissions of unix sockets
  if (typeof PORT === 'string' && PORT.startsWith('/') && UNIX_SOCKET_PERMISSIONS >= 0) {
    fsPromises.chmod(PORT, UNIX_SOCKET_PERMISSIONS);
  }

  console.log(`Started on port ${PORT}`);
});

const handleSignal = (signal) => {
  console.log(`Received ${signal}`);
  flushToDatabase();
  process.exit(0);
};

process.on('SIGTERM', handleSignal);
process.on('SIGINT', handleSignal);

startTimers();
