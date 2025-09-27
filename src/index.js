import * as fs from 'node:fs/promises';
import { PORT, UNIX_SOCKET_PERMISSIONS } from './config.js';
import { app } from './server.js';
import { startTimers } from './counter.js';

app.listen(PORT, () => {
  // Update permissions of unix sockets
  if (typeof PORT === 'string' && PORT.startsWith('/') && UNIX_SOCKET_PERMISSIONS >= 0) {
    fs.chmod(PORT, UNIX_SOCKET_PERMISSIONS);
  }

  console.log(`Started on port ${PORT}`);
});

startTimers();
