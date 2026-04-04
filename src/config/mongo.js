const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'kareergrowth';

let client = null;
let db = null;

const COLLECTIONS = {
  NOTIFICATIONS: 'notifications',
};

async function connectToMongo() {
  if (db) return db;
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB (AdminBackend)');
    return db;
  } catch (error) {
    console.error('MongoDB connection error (AdminBackend):', error);
    throw error;
  }
}

async function getDb() {
  if (!db) await connectToMongo();
  return db;
}

module.exports = {
  getDb,
  COLLECTIONS,
};
