import http from 'node:http';
import client from '@prometheus-io/client';

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['method', 'route', 'status']
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status']
});

export const events = new client.Counter({
  name: 'windchimes_events_total',
  help: 'Submitted events',
  labelNames: ['result']
});

// Start counters at 0 instead of blank
for (const result of [
  'tallied',
  'bad_request',
  'invalid_resource_or_event',
  'not_in_sample',
  'duplicate_event',
  'too_many_events_per_user',
  'too_many_users'
]) {
  events.inc({ result }, 0);
}

const getLowCardinalityPath = (req) => {
  // Explicit route name
  if (req.metricsRoute) {
    return req.metricsRoute;
  }
  // Express route
  if (req.route && typeof req.route.path === 'string') {
    return (req.baseUrl || '') + req.route.path;
  }
  // Fallback - don't let 404 explode cardinality
  return 'other';
};

export const middleware = (req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('close', () => {
    try {
      const labels = {
        method: req.method,
        route: getLowCardinalityPath(req),
        status: res.writableFinished ? res.statusCode : 'aborted'
      };
      httpRequests.inc(labels);
      end(labels);
    } catch (error) {
      console.error(error);
    }
  });
  next();
};

export const listen = () => {
  if (!process.env.METRICS_PORT) {
    return;
  }

  const port = +process.env.METRICS_PORT;
  client.collectDefaultMetrics();

  const metricsServer = http.createServer((req, res) => {
    client.register.metrics()
      .then((body) => {
        res.setHeader('Content-Type', client.register.contentType);
        res.end(body);
      })
      .catch((error) => {
        console.error(error);
        res.statusCode = 500;
        res.end();
      });
  });

  metricsServer.listen(port, '127.0.0.1', () => {
    console.log(`Metrics on port ${port}`);
  });
};
