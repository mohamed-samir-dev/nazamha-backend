import {attendanceJob} from "../controllers/attendanceJobController";
import {withJobLease} from "../services/jobLease";
jest.mock("../services/jobLease",()=>({withJobLease:jest.fn().mockResolvedValue(true)}));
jest.mock("../services/attendanceBackfill",()=>({backfillAttendance:jest.fn()}));
const res=():any=>({statusCode:200,status(n:number){this.statusCode=n;return this;},json:jest.fn()});
afterEach(()=>{delete process.env.CRON_SECRET;jest.clearAllMocks();});
test("unconfigured scheduler never starts a job",async()=>{delete process.env.CRON_SECRET;const r=res();await attendanceJob({headers:{}} as any,r);expect(r.statusCode).toBe(503);expect(withJobLease).not.toHaveBeenCalled();});
test("a teacher or incorrect scheduler credential cannot trigger global attendance",async()=>{process.env.CRON_SECRET="scheduler-test-secret";const r=res();await attendanceJob({headers:{authorization:"Bearer teacher-token"}} as any,r);expect(r.statusCode).toBe(401);expect(withJobLease).not.toHaveBeenCalled();});
test("valid scheduler credential runs under the shared job lease",async()=>{process.env.CRON_SECRET="scheduler-test-secret";const r=res();await attendanceJob({headers:{authorization:"Bearer scheduler-test-secret"}} as any,r);expect(withJobLease).toHaveBeenCalledWith("auto-absent",expect.any(Function));expect(r.json).toHaveBeenCalledWith({status:"completed"});});
