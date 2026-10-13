import { randomUUID } from "crypto";
import { JobLease } from "../models/JobLease";
export async function withJobLease(name:string, work:()=>Promise<void>):Promise<boolean> {
 const owner=randomUUID(), duration=300_000;
 try { await JobLease.findOneAndUpdate({_id:name,expires_at:{$lte:new Date()}},{$set:{owner,expires_at:new Date(Date.now()+duration)}},{upsert:true}); }
 catch(error:any){if(error.code===11000)return false;throw error;}
 const timer=setInterval(()=>{void JobLease.updateOne({_id:name,owner},{$set:{expires_at:new Date(Date.now()+duration)}}).catch(error=>console.error("[lease renewal]",name,error.message));},60_000);
 timer.unref();
 try {await work();return true;} finally {clearInterval(timer);await JobLease.deleteOne({_id:name,owner});}
}
