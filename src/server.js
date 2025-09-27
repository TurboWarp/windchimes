import * as pathUtil from 'node:path';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { getTotal, submit } from './counter.js';
import { ALLOWED_ORIGINS } from './config.js';

export const app = express();

app.set('x-powered-by', false);
app.set('query parser', (query) => new URLSearchParams(query));

app.use((req, res, next) => {
  res.header('x-frame-options', 'DENY');
  res.header('x-content-type-options', 'nosniff');
  next();
});

app.get('/api/total', (req, res) => {
  const resource = req.query.get('resource');
  const event = req.query.get('event');

  if (typeof resource === 'string' && typeof event === 'string') {
    res.json({
      total: getTotal(resource, event)
    });
  } else {
    res.status(400).end();
  }
});

const chimeCorsOptions = {
  origin: ALLOWED_ORIGINS,
  methods: ['PUT'],
  allowedHeaders: ['content-type'],
  maxAge: 60 * 60 * 24
};

app.options('/api/chime', cors(chimeCorsOptions));
app.put('/api/chime', cors(chimeCorsOptions), bodyParser.json({
  inflate: false,
  limit: 1024,
  type: 'application/json'
}), (req, res) => {
  if (req.headers['sec-gpc'] === '1' || req.headers['dnt'] === '1') {
    res.send('Opted out per your browser settings.');
    return;
  }

  const ip = req.socket.remoteAddress || req.headers['x-real-ip'];
  const resource = req.body.resource;
  const event = req.body.event;
  res.send('🎐');

  if (
    typeof ip === 'string' &&
    typeof resource === 'string' &&
    typeof event === 'string'
  ) {
    submit(ip, resource, event);
  }
});

app.use(express.static(pathUtil.join(import.meta.dirname, '../static/')));

app.use((req, res) => {
  res.status(404).end();
});
