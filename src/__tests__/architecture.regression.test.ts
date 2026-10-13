import { EventEmitter } from "events";
import { AuditLog } from "../models/AuditLog";
import { auditRequest } from "../middleware/auditLog";
import { sharedRateStore } from "../services/sharedRateStore";
import { getRedisClient } from "../config/redis";
jest.mock("../config/redis",()=>({getRedisClient:jest.fn()}));
afterEach(()=>jest.restoreAllMocks());
test("audit waits for completion and preserves the assistant actor on failure",async()=>{
 const create=jest.spyOn(AuditLog,"create").mockResolvedValue({} as never);
 const response=Object.assign(new EventEmitter(),{locals:{},statusCode:409});
 const req:any={method:"PATCH",path:"/api/students/s",params:{id:"s"},user:{actor_id:"actor",actor_type:"staff",user_type:"teacher",id:"owner",effective_teacher_id:"owner"},body:{password:"do not record"}};
 auditRequest(req,response as any,jest.fn());expect(create).not.toHaveBeenCalled();
 response.emit("finish");await Promise.resolve();
 expect(create).toHaveBeenCalledWith(expect.objectContaining({actor_id:"actor",actor_type:"staff",teacher_id:"owner",outcome:"failure",status_code:409}));
 expect(create.mock.calls[0][0]).not.toHaveProperty("new_data");
});
test("shared rate limiting uses a shared atomic counter and never falls back on Redis failure",async()=>{
 const prior=process.env.REDIS_URL;process.env.REDIS_URL="redis://test";
 try {
   const evalCommand=jest.fn().mockResolvedValue([7,10000]);
   (getRedisClient as jest.Mock).mockResolvedValue({eval:evalCommand});
   const store=sharedRateStore("login")!;store.init!({windowMs:15000} as any);
   expect((await store.increment("client")).totalHits).toBe(7);
   expect(evalCommand.mock.calls[0][2]).toMatch(/^rate:login:/);
   (getRedisClient as jest.Mock).mockResolvedValue(null);
   await expect(store.increment("client")).rejects.toThrow("unavailable");
 } finally {if(prior===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=prior;}
});
