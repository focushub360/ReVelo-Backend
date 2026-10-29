import mongoose from 'mongoose';import { stamped } from './activity.js';
export const Session=mongoose.model('Session',new mongoose.Schema({token:{type:String,unique:true,index:true},user:{type:mongoose.Schema.Types.ObjectId,ref:'User',index:true},csrfToken:String,sessionVersion:{type:Number,required:true},ipHash:String,userAgent:String,expiresAt:{type:Date,index:true}},stamped));
