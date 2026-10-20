import { OperationCounter } from "../models/OperationCounter";
import type { Collection } from "mongodb";
export async function nextSequence(key:string, initial:()=>Promise<number>):Promise<number>{
 return reserveSequence(key, 1, initial);
}

/** Returns the first number in a reserved, contiguous block. */
export async function reserveSequence(key:string, count:number, initial:()=>Promise<number>):Promise<number>{
 if(!Number.isInteger(count) || count<1) throw new Error("Invalid sequence reservation");
 // Counters deliberately allocate outside the caller's transaction. A rollback may
 // leave a gap, but another transaction must never receive an allocated number.
 const counters = OperationCounter.collection as unknown as Collection<{_id:string;value:number}>;
 const reserved=await counters.findOneAndUpdate({_id:key},{$inc:{value:count}},{returnDocument:"after",includeResultMetadata:false});
 if(reserved)return reserved.value-count+1;
 {
  const value=await initial();
  try{await counters.updateOne({_id:key},{$setOnInsert:{value}},{upsert:true});}catch(e:any){if(e.code!==11000)throw e;}
 }
 const counter=await counters.findOneAndUpdate({_id:key},{$inc:{value:count}},{returnDocument:"after",includeResultMetadata:false});
 if(!counter)throw new Error("Counter not initialized");
 return counter.value-count+1;
}
