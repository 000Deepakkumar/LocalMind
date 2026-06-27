const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  prompt:     { type: String, required: true },
  filename:   { type: String, required: true },
  minioKey:   { type: String },
  num_frames: { type: Number },
  fps:        { type: Number },
}, { timestamps: true });

module.exports = mongoose.model('Video', videoSchema);
