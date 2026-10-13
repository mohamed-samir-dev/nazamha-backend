import { OperationCounter } from "../models/OperationCounter";
import type { Collection } from "mongodb";
export async function nextSequence(key:string, initial:()=>Promise<number>):Promise<number>{
 // Counters deliberately allocate outside the caller's transaction. A rollback may
 // leave a gap, but another transaction must never receive an allocated number.
 const counters = OperationCounter.collection as unknown as Collection<{_id:string;value:number}>;
 if(!await counters.findOne({_id:key})){
  const value=await initial();
  try{await counters.updateOne({_id:key},{$setOnInsert:{value}},{upsert:true});}catch(e:any){if(e.code!==11000)throw e;}
 }
 const counter=await counters.findOneAndUpdate({_id:key},{$inc:{value:1}},{returnDocument:"after",includeResultMetadata:false});
 if(!counter)throw new Error("Counter not initialized");
 return counter.value!;
}
