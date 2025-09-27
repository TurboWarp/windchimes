import * as pathUtil from 'node:path';
import * as nodeCrypto from 'node:crypto';
import sqlite3 from 'better-sqlite3';

const SALT_SIZE_BYTES = 256;

const MAX_EVENTS_PER_USER_PER_PERIOD = 10;
const MAX_USERS_PER_PERIOD = 100000;
const PERIOD_DURATION_MS = 1000 * 60 * 60;

// percent from 0 (count nobody) to 1 (count everybody)
const COUNTING_PROBABILITY = 1.0;

const databaseDirectory = process.env.STATE_DIRECTORY || pathUtil.join(import.meta.dirname, '..');
const databasePath = pathUtil.join(databaseDirectory, 'windchimes.db');
console.log(`Database path: ${databasePath}`);

const db = sqlite3(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('secure_delete = true');

db.exec(`
CREATE TABLE IF NOT EXISTS totals (
  resource TEXT NOT NULL,
  event TEXT NOT NULL,
  tally INTEGER NOT NULL,
  PRIMARY KEY (resource, event)
) STRICT;

CREATE TABLE IF NOT EXISTS daily (
  resource TEXT NOT NULL,
  event TEXT NOT NULL,
  day INTEGER NOT NULL,
  tally INTEGER NOT NULL,
  PRIMARY KEY (resource, event, day)
) STRICT;
`);

const _updateTotals = db.prepare(`
INSERT INTO totals (resource, event, tally) VALUES (?, ?, ?)
ON CONFLICT (resource, event) DO UPDATE SET tally = totals.tally + ?;
`);

const _updateDaily = db.prepare(`
INSERT INTO daily (resource, event, day, tally) VALUES (?, ?, ?, ?)
ON CONFLICT (resource, event, day) DO UPDATE SET tally = daily.tally + ?;
`);

const _getTotal = db.prepare(`SELECT tally FROM totals WHERE resource = ? AND event = ?;`);

let periodStart = Date.now();

const initialHashState = nodeCrypto.createHash('sha256');

/**
 * Maps anonymized user ID to the number of events they submitted in this period.
 * Used to prevent spamming events.
 * @type {Map<number, number>}
 */
const eventsPerUser = new Map();

/**
 * Maps resources to their events, and then events to tallies.
 * @type {Map<string, Map<string, number>>}
 */
const eventTallies = new Map();

const flushToDatabase = db.transaction(() => {
  const day = Math.floor(periodStart / (1000 * 60 * 60 * 24));

  for (const resource of eventTallies.keys()) {
    const resourceMap = eventTallies.get(resource);
    for (const event of resourceMap.keys()) {
      const tally = Math.floor(resourceMap.get(event) / COUNTING_PROBABILITY);
      if (tally > 0) {
        _updateTotals.run(resource, event, tally, tally);
        _updateDaily.run(resource, event, day, tally, tally);
      }
    }
  }
});

const beginNewCollectionPeriod = () => {
  flushToDatabase();
  initialHashState.update(nodeCrypto.randomBytes(SALT_SIZE_BYTES));
  eventsPerUser.clear();
  eventTallies.clear();
  periodStart = Date.now();
};

beginNewCollectionPeriod();

/**
 * @param {string} resource
 * @returns {boolean} true if valid resource
 */
export const isValidResource = (resource) => /^scratch\/\d{3,11}$/.test(resource);

/**
 * @param {string} event
 * @returns {boolean} true if valid event
 */
export const isValidEvent = (event) => event === 'view/index' || event === 'view/embed';

/**
 * @param {string} userId
 * @param {string} resource A possibly-invalid resource. Must be string
 * @param {string} event A possibly-invalid event. Must be string
 */
export const submit = (userId, resource, event) => {
  if (!isValidResource(resource) || !isValidEvent(event)) {
    return;
  }

  const anonymizedUserId = initialHashState
    .copy()
    .update(userId)
    .digest()
    .readUint32LE(0);
  
  if (anonymizedUserId > COUNTING_PROBABILITY * (2 ** 32)) {
    return;
  }
  
  const alreadySubmitted = eventsPerUser.get(anonymizedUserId) || 0;
  if (alreadySubmitted > MAX_EVENTS_PER_USER_PER_PERIOD) {
    return;
  }
  if (alreadySubmitted === 0 && eventsPerUser.size > MAX_USERS_PER_PERIOD) {
    return;
  }
  eventsPerUser.set(anonymizedUserId, alreadySubmitted + 1);

  let resourceMap;
  if (eventTallies.has(resource)) {
    resourceMap = eventTallies.get(resource);
  } else {
    resourceMap = new Map();
    eventTallies.set(resource, resourceMap);
  }

  const eventTally = resourceMap.get(event) || 0;
  resourceMap.set(event, eventTally + 1);
};

/**
 * @param {string} resource A possibly-invalid resource. Must be string
 * @param {string} event A possibly-invalid event. Must be string
 * @returns {number} The total, or 0 if never seen before.
 */
export const getTotal = (resource, event) => {
  const result = _getTotal.get(resource, event);
  if (result) {
    return result.tally;
  }
  return 0;
};

export const startTimers = () => {
  setInterval(() => {
    beginNewCollectionPeriod();
  }, PERIOD_DURATION_MS);
};
