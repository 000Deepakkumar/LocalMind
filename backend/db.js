const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
  if (connected) return;
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/localmind';
  await mongoose.connect(uri);
  connected = true;
  console.log('[db] MongoDB connected');
}

module.exports = { connectDB };
