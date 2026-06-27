const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  prompt:   { type: String, required: true },
  filename: { type: String, required: true },
  minioKey: { type: String },
  width:    { type: Number },
  height:   { type: Number },
  steps:    { type: Number },
}, { timestamps: true });

module.exports = mongoose.model('Image', imageSchema);
