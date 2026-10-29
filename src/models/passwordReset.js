import mongoose from 'mongoose';import { stamped } from './activity.js';
export const PasswordReset=mongoose.model('PasswordReset',new mongoose.Schema({tokenHash:{type:String,unique:true,index:true},user:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},expiresAt:{type:Date,required:true,index:true},usedAt:Date},stamped));
