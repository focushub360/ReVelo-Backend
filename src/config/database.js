import mongoose from 'mongoose';
import { env } from './env.js';
export async function connectDatabase() { mongoose.set('strictQuery', true); await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); mongoose.connection.on('error', error => console.error(JSON.stringify({ level: 'error', event: 'mongo_error', message: error.message }))); }
