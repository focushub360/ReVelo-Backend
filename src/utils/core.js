import crypto from 'crypto';
export const id=(prefix)=>`${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`.toUpperCase();
export const token=()=>crypto.randomBytes(32).toString('hex');
export const audit=async (Audit, actor, action, entity, entityId, data={})=>Audit.create({actor,action,entity,entityId:String(entityId),data});
export const httpError=(status,message)=>Object.assign(new Error(message),{status});
