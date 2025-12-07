import pathUtil from 'node:path';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { getFirstDate, getTotal, submit } from './counter.js';
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

/**
 * Get minimum non-zero date.
 * @param {number[]} dates
 * @returns {number}
 */
const getMinDate = (dates) => {
  let min = 0;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (date > 0 && (date < min || min === 0)) {
      min = date;
    }
  }
  return min;
};

app.get('/api/scratch/:id', cors(readonlyCorsOptions), (req, res) => {
  const resource = `scratch/${req.params.id}`;

  res.header('cache-control', 'public, max-age=3600');

  const indexViews = getTotal(resource, 'view/index');
  const embedViews = getTotal(resource, 'view/embed');
  const totalViews = indexViews + embedViews;

  if (totalViews === 0) {
    res.status(404);
    res.json({
      total: 0,
      firstDate: 0
    });
  } else {
    const indexFirstDate = getFirstDate(resource, 'view/index');
    const embedFirstDate = getFirstDate(resource, 'view/embed');
    const firstDate = getMinDate([indexFirstDate, embedFirstDate]);

    res.json({
      total: totalViews,
      firstDate
    });
  }
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
