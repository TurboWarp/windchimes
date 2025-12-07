import pathUtil from 'node:path';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { getTotal, submit } from './counter.js';
import { READONLY_ORIGINS, SUBMISSION_ORIGINS } from './config.js';

export const app = express();

app.set('x-powered-by', false);
app.set('query parser', (query) => new URLSearchParams(query));
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.header('x-frame-options', 'DENY');
  res.header('x-content-type-options', 'nosniff');
  next();
});

const readonlyCorsOptions = {
  origin: READONLY_ORIGINS,
  methods: ['GET'],
  allowedHeaders: [],
  maxAge: 60 * 60 * 24
};

app.get('/api/scratch/:id', cors(readonlyCorsOptions), (req, res) => {
  const resource = `scratch/${req.params.id}`;
  const index = getTotal(resource, 'view/index');
  const embed = getTotal(resource, 'view/embed');
  res.header('cache-control', 'public, max-age=600');
  res.json({
    total: index + embed
  });
});

const submissionCorsOptions = {
  origin: SUBMISSION_ORIGINS,
  methods: ['PUT'],
  allowedHeaders: ['content-type'],
  maxAge: 60 * 60 * 24
};

app.options('/api/chime', cors(submissionCorsOptions));
app.put('/api/chime', cors(submissionCorsOptions), bodyParser.json({
  inflate: false,
  limit: 1024,
  type: 'application/json'
}), (req, res) => {
  const ip = req.ip;
  const resource = req.body?.resource;
  const event = req.body?.event;

  if (
    typeof ip === 'string' &&
    typeof resource === 'string' &&
    typeof event === 'string'
  ) {
    res.send('🎐');
    submit(ip, resource, event);
  } else {
    res.status(400).end();
  }
});

app.use(express.static(pathUtil.join(import.meta.dirname, '../static/'), {
  maxAge: 1000 * 60 * 10
}));

app.use((req, res) => {
  res.status(404).end();
});
