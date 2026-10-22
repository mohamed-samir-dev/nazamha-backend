import { reportAttendance } from "../utils/reportAttendance";
const member = {group_id:{_id:'A',name:'مجموعة أ'},starts_on:'2026-10-10',ends_on:'2026-10-19'};
const session=(date:string,group_id='A')=>({_id:{date,group_id}});
test('missing group sessions during membership appear once while explicit attendance wins',()=>{
  const rows=reportAttendance([{session_date:'2026-10-11',status:'present',group_id:member.group_id}], [member], [session('2026-10-11'),session('2026-10-12'),session('2026-10-12')],'2026-10-23');
  expect(rows).toEqual([{date:'2026-10-11',status:'present',group:'مجموعة أ'},{date:'2026-10-12',status:'unrecorded',group:'مجموعة أ'}]);
});
test('never infer absence before joining, after leaving, for another group, today or future',()=>{
  expect(reportAttendance([], [member], [session('2026-10-09'),session('2026-10-20'),session('2026-10-12','B'),session('2026-10-23'),session('2026-10-24')],'2026-10-23')).toEqual([]);
});
test('previous groups stay visible after transfer without inventing sessions',()=>{
  const rows=reportAttendance([], [member,{group_id:{_id:'B',name:'مجموعة ب'},starts_on:'2026-10-20'}], [session('2026-10-18'),session('2026-10-21','B')],'2026-10-23');
  expect(rows.map(r=>r.group)).toEqual(['مجموعة أ','مجموعة ب']);
  expect(reportAttendance([], [member], [],'2026-10-23')).toEqual([]);
});
