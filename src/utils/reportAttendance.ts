interface Membership { group_id: any; starts_on: string; ends_on?: string | null }
interface RecordRow { session_date: string; status: string; group_id?: any }
interface Session { _id: { group_id: any; date: string } }
const id = (group: any) => String(group?._id ?? group ?? "");
const name = (group: any) => group?.name || "مجموعة سابقة";

/** Infer only past group sessions during membership, never a mutable schedule. */
export function reportAttendance(records: RecordRow[], memberships: Membership[], sessions: Session[], today: string) {
  const rows = new Map(records.map(r => [r.session_date, { date: r.session_date, status: r.status, group: name(r.group_id) }]));
  for (const session of sessions) {
    const date = session._id.date;
    if (date >= today || rows.has(date)) continue;
    const membership = memberships.find(m => id(m.group_id) === id(session._id.group_id) && m.starts_on <= date && (!m.ends_on || m.ends_on >= date));
    if (membership) rows.set(date, { date, status: "unrecorded", group: name(membership.group_id) });
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
