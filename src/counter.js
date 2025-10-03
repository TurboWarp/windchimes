import * as pathUtil from 'node:path';
import * as nodeCrypto from 'node:crypto';
import sqlite3 from 'better-sqlite3';

const SALT_SIZE_BYTES = 256;

const MAX_EVENTS_PER_USER_PER_PERIOD = 10;
const MAX_USERS_PER_PERIOD = 10000;
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

/**
 * It's funny to do it this way.
 * @returns {number}
 */
const daysSince2000 = () => Math.floor((Date.now() - 946684800000) / (24 * 60 * 60 * 1000));

let periodDay = daysSince2000();

const initialHashState = nodeCrypto.createHash('sha256');

/**
 * Maps anonymized user ID to the number of events they submitted in this period.
 * Used to prevent spamming events.
 * @type {Map<number, number>}
 */
const eventsPerUser = new Map();

/**
 * Set of anonymized event IDs seen during this period.
 * @type {Set<number>}
 */
const eventsThisPeriod = new Set();

/**
 * Maps resources to their events, and then events to tallies.
 * @type {Map<string, Map<string, number>>}
 */
const eventTallies = new Map();

const untalliedReasons = {
  invalidResourceOrEvent: 0,
  notInSample: 0,
  duplicateEvent: 0,
  tooManyEventsPerUser: 0,
  tooManyUsers: 0
};

export const flushToDatabase = db.transaction(() => {
  console.log(`Tallying for day ${periodDay}`);
  console.log(`Final unique events: ${eventsThisPeriod.size}`);
  console.log(`Events ignored due to invalid resource: ${untalliedReasons.invalidResourceOrEvent}`);
  console.log(`Events ignored due to random sample: ${untalliedReasons.notInSample}`);
  console.log(`Events ignored due to duplicate: ${untalliedReasons.duplicateEvent}`);
  console.log(`Events ignored due to too many per-user: ${untalliedReasons.tooManyEventsPerUser}`);
  console.log(`Events ignored due to too many users: ${untalliedReasons.tooManyUsers}`);

  for (const resource of eventTallies.keys()) {
    const resourceMap = eventTallies.get(resource);
    for (const event of resourceMap.keys()) {
      const tally = Math.floor(resourceMap.get(event) / COUNTING_PROBABILITY);
      if (tally > 0) {
        _updateTotals.run(resource, event, tally, tally);
        _updateDaily.run(resource, event, periodDay, tally, tally);
      }
    }
  }
});

const beginNewCollectionPeriod = () => {
  initialHashState.update(nodeCrypto.randomBytes(SALT_SIZE_BYTES));
  eventsPerUser.clear();
  eventsThisPeriod.clear();
  eventTallies.clear();
  periodDay = daysSince2000();
  for (const reason of Object.keys(untalliedReasons)) {
    untalliedReasons[reason] = 0;
  }
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
 * @param {string} resource Validated resource
 * @param {string} event Validated event
 */
const increment = (resource, event) => {
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
 * @param {string} userId
 * @param {string} resource A possibly-invalid resource. Must be string
 * @param {string} event A possibly-invalid event. Must be string
 */
export const submit = (userId, resource, event) => {
  if (!isValidResource(resource) || !isValidEvent(event)) {
    untalliedReasons.invalidResourceOrEvent++;
    return;
  }

  const anonymizedUserId = initialHashState
    .copy()
    .update(userId)
    .digest()
    .readUint32LE();

  if (anonymizedUserId > COUNTING_PROBABILITY * (2 ** 32)) {
    // User is not in the sample being considered right now.
    untalliedReasons.notInSample++;
    return;
  }

  const anonymizedEventId = initialHashState
    .copy()
    .update(`${anonymizedUserId}`)
    .update('\0')
    .update(event)
    .update('\0')
    .update(resource)
    .digest()
    .readUint32LE();

  if (eventsThisPeriod.has(anonymizedEventId)) {
    // Event was already counted in this period.
    untalliedReasons.duplicateEvent++;
    return;
  }

  const alreadySubmittedByUser = eventsPerUser.get(anonymizedUserId) || 0;
  if (alreadySubmittedByUser > MAX_EVENTS_PER_USER_PER_PERIOD) {
    // This user has already submitted too many events.
    untalliedReasons.tooManyEventsPerUser++;
    return;
  }

  if (alreadySubmittedByUser === 0 && eventsPerUser.size > MAX_USERS_PER_PERIOD) {
    // We've seen too many users this period. Something strange is going on.
    untalliedReasons.tooManyUsers++;
    return;
  }

  eventsPerUser.set(anonymizedUserId, alreadySubmittedByUser + 1);
  eventsThisPeriod.add(anonymizedEventId);
  increment(resource, event);
};

/**
 * @param {string} resource A possibly-invalid resource. Must be string
 * @param {string} event A possibly-invalid event. Must be string
 * @returns {number} The total, or 0 if no data.
 */
export const getTotal = (resource, event) => {
  if (!isValidEvent(event) || !isValidResource(resource)) {
    return 0;
  }
  const result = _getTotal.get(resource, event);
  if (result) {
    return result.tally;
  }
  return 0;
};

export const startTimers = () => {
  setInterval(() => {
    flushToDatabase();
    beginNewCollectionPeriod();
  }, PERIOD_DURATION_MS);
};
