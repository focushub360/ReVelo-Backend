import mongoose from 'mongoose';
const { Schema } = mongoose;
export const activitySchema=new Schema({type:String,message:String,actor:{type:Schema.Types.ObjectId,ref:'User'},metadata:Schema.Types.Mixed,at:{type:Date,default:Date.now}},{_id:false});
export const stamped={timestamps:true};
