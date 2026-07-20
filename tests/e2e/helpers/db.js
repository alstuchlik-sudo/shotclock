const { MongoClient, ObjectId } = require('mongodb');

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

async function findPreMatchSendById(id) {
  return withDb((db) => db.collection('prematchsends').findOne({ _id: new ObjectId(id) }));
}

async function findPreMatchSendsBySession(sessionId) {
  return withDb((db) =>
    db.collection('prematchsends').find({ sessionId }).sort({ createdAt: 1 }).toArray()
  );
}

async function resetPostGameSends() {
  return withDb((db) => db.collection('postgamesends').deleteMany({}));
}

async function countPostGameSends() {
  return withDb((db) => db.collection('postgamesends').countDocuments({}));
}

async function findPostGameSendsBySession(sessionId) {
  return withDb((db) =>
    db.collection('postgamesends').find({ sessionId }).sort({ createdAt: 1 }).toArray()
  );
}

// Inserts a document straight into the postgamesends collection, bypassing
// the app/Mongoose entirely. Used to simulate a record shaped like it was
// created before a schema field existed (e.g. a pre-SHOT-31 PostGameSend
// with no streak/personalBest), which the app itself can never produce
// going forward but real historical data already contains.
async function insertRawPostGameSend(doc) {
  return withDb((db) => db.collection('postgamesends').insertOne(doc));
}

module.exports = {
  resetConnectionAttempts,
  countByOutcome,
  findLatestBySession,
  countBySession,
  resetPreMatchSends,
  countPreMatchSends,
  findPreMatchSendById,
  findPreMatchSendsBySession,
  resetPostGameSends,
  countPostGameSends,
  findPostGameSendsBySession,
  insertRawPostGameSend,
};
