const { MongoClient } = require('mongodb');

function getMongoUri() {
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/shotclock-connect';
}

async function withDb(fn) {
  const client = new MongoClient(getMongoUri());
  await client.connect();
  try {
    const db = client.db();
    return await fn(db);
  } finally {
    await client.close();
  }
}

async function resetConnectionAttempts() {
  return withDb((db) => db.collection('connectionattempts').deleteMany({}));
}

async function resetPreMatchSends() {
  return withDb((db) => db.collection('prematchsends').deleteMany({}));
}

async function countPreMatchSends() {
  return withDb((db) => db.collection('prematchsends').countDocuments({}));
}

async function countByOutcome(outcome) {
  return withDb((db) => db.collection('connectionattempts').countDocuments({ outcome }));
}

async function findLatestBySession(sessionId) {
  return withDb((db) =>
    db
      .collection('connectionattempts')
      .find({ sessionId })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray()
  );
}

async function countBySession(sessionId) {
  return withDb((db) => db.collection('connectionattempts').countDocuments({ sessionId }));
}

module.exports = {
  resetConnectionAttempts,
  countByOutcome,
  findLatestBySession,
  countBySession,
  resetPreMatchSends,
  countPreMatchSends,
};
