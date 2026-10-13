/**
 * attendanceScheduleValidator — منطق التحقق من صلاحية تسجيل الحضور للطلاب عبر المجموعات
 * 
 * القواعد الأساسية:
 * 1. يُسجَّل الطالب دائمًا في مجموعته الأصلية، وليس مجموعة الـ Scanner
 * 2. يُسمح بالتسجيل إذا كان موعد المجموعة الأصلية في الأسبوع الحالي (سبت-جمعة)
 * 3. يُمنع التسجيل إذا كان موعد المجموعة الأصلية في الأسبوع القادم
 * 4. يجب التحقق من صلاحيات المدرس والحالات الخاصة (التعليق، الصف المختلف)
 */

import { getTodayInTimezone } from "./timezoneUtils";

const DAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export interface ValidationResult {
  decision: "allow" | "deny" | "confirm";
  reason: string;
  studentGroupId: string | null;
  studentGroupName: string;
  studentGroupSchedule: string;
  nextScheduledDate: string | null;
  scheduledDateIsToday: boolean;
  scheduledDateIsFuture: boolean;
  scheduledDateInCurrentWeek: boolean;
  scheduledDateInNextWeek: boolean;
}

/**
 * استخراج أرقام الأيام (0=الأحد..6=السبت) من حقل day_of_week النصي
 */
function parseGroupDayNumbers(day_of_week: string): number[] {
  if (!day_of_week) return [];
  return day_of_week
    .split(/\s*[,،]\s*/)
    .map(d => DAYS_AR.indexOf(d.trim()))
    .filter(n => n !== -1);
}

/**
 * حساب بداية ونهاية الأسبوع الحالي (سبت-جمعة)
 * يتوافق مع منطق getValidSessionDates في Frontend
 */
function getCurrentWeekBounds(timezone = "Africa/Cairo"): { start: Date; end: Date } {
  const today = new Date(getTodayInTimezone(timezone) + "T00:00:00Z");
  const dayOfWeek = today.getUTCDay(); // 0=أحد, 6=سبت

  // بداية الأسبوع (السبت الماضي أو اليوم إذا كان سبت)
  const diffToSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - diffToSat);
  weekStart.setUTCHours(0, 0, 0, 0);

  // نهاية الأسبوع (الجمعة القادمة)
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { start: weekStart, end: weekEnd };
}

/**
 * حساب أقرب موعد قادم للمجموعة بناءً على أيام الأسبوع المحددة
 * يبحث في الأسبوع الحالي والأسبوع القادم
 */
function getNextScheduledDate(
  groupDayNumbers: number[],
  groupStartDate: string | null,
  timezone = "Africa/Cairo"
): { date: string; isToday: boolean; inCurrentWeek: boolean; inNextWeek: boolean } | null {
  if (groupDayNumbers.length === 0) return null;

  const todayStr = getTodayInTimezone(timezone);
  const today = new Date(todayStr + "T00:00:00Z");
  const todayDayNum = today.getUTCDay();

  const { start: weekStart, end: weekEnd } = getCurrentWeekBounds(timezone);

  // البحث عن أقرب موعد في الأسبوع الحالي (اليوم أو بعده)
  const cursor = new Date(today);
  for (let i = 0; i < 7; i++) {
    const cursorDayNum = cursor.getUTCDay();
    const cursorDateStr = cursor.toISOString().slice(0, 10);

    if (groupDayNumbers.includes(cursorDayNum)) {
      // التحقق من أن التاريخ بعد start_date المجموعة
      if (groupStartDate && cursorDateStr < groupStartDate) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      // التحقق من أن التاريخ ضمن الأسبوع الحالي
      const inCurrentWeek = cursor >= weekStart && cursor <= weekEnd;
      const isToday = cursorDateStr === todayStr;

      return {
        date: cursorDateStr,
        isToday,
        inCurrentWeek,
        inNextWeek: !inCurrentWeek,
      };
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // إذا لم نجد موعدًا في الأسبوع الحالي، نبحث في الأسبوع القادم
  const nextWeekStart = new Date(weekEnd);
  nextWeekStart.setUTCDate(weekEnd.getUTCDate() + 1);
  nextWeekStart.setUTCHours(0, 0, 0, 0);

  const nextCursor = new Date(nextWeekStart);
  for (let i = 0; i < 7; i++) {
    const cursorDayNum = nextCursor.getUTCDay();
    const cursorDateStr = nextCursor.toISOString().slice(0, 10);

    if (groupDayNumbers.includes(cursorDayNum)) {
      if (groupStartDate && cursorDateStr < groupStartDate) {
        nextCursor.setUTCDate(nextCursor.getUTCDate() + 1);
        continue;
      }

      return {
        date: cursorDateStr,
        isToday: false,
        inCurrentWeek: false,
        inNextWeek: true,
      };
    }

    nextCursor.setUTCDate(nextCursor.getUTCDate() + 1);
  }

  return null;
}

/**
 * التحقق من صلاحية تسجيل حضور طالب عبر المجموعات
 * 
 * @param studentGroup - المجموعة الأصلية للطالب
 * @param scannerGroupId - المجموعة التي يعمل عليها الـ Scanner
 * @param requestedDate - التاريخ المطلوب تسجيل الحضور فيه
 * @param timezone - المنطقة الزمنية للمدرس
 */
export async function validateCrossGroupAttendance(
  studentGroup: {
    id: string;
    name: string;
    day_of_week: string;
    start_date?: string | null;
  } | null,
  scannerGroupId: string,
  requestedDate: string,
  timezone = "Africa/Cairo"
): Promise<ValidationResult> {
  // إذا لم يكن للطالب مجموعة، نرفض
  if (!studentGroup) {
    return {
      decision: "deny",
      reason: "الطالب غير منتمي لأي مجموعة",
      studentGroupId: null,
      studentGroupName: "لا توجد مجموعة",
      studentGroupSchedule: "—",
      nextScheduledDate: null,
      scheduledDateIsToday: false,
      scheduledDateIsFuture: false,
      scheduledDateInCurrentWeek: false,
      scheduledDateInNextWeek: false,
    };
  }

  const todayStr = getTodayInTimezone(timezone);
  const groupDayNumbers = parseGroupDayNumbers(studentGroup.day_of_week);

  // إذا لم تكن للمجموعة أيام محددة
  if (groupDayNumbers.length === 0) {
    return {
      decision: "deny",
      reason: "مجموعة الطالب ليس لها موعد محدد",
      studentGroupId: studentGroup.id,
      studentGroupName: studentGroup.name,
      studentGroupSchedule: studentGroup.day_of_week || "—",
      nextScheduledDate: null,
      scheduledDateIsToday: false,
      scheduledDateIsFuture: false,
      scheduledDateInCurrentWeek: false,
      scheduledDateInNextWeek: false,
    };
  }

  // حساب أقرب موعد قادم لمجموعة الطالب
  const nextSchedule = getNextScheduledDate(
    groupDayNumbers,
    studentGroup.start_date || null,
    timezone
  );

  if (!nextSchedule) {
    return {
      decision: "deny",
      reason: "لا يوجد موعد قادم للمجموعة",
      studentGroupId: studentGroup.id,
      studentGroupName: studentGroup.name,
      studentGroupSchedule: studentGroup.day_of_week,
      nextScheduledDate: null,
      scheduledDateIsToday: false,
      scheduledDateIsFuture: false,
      scheduledDateInCurrentWeek: false,
      scheduledDateInNextWeek: false,
    };
  }

  const scheduledDate = nextSchedule.date;
  const scheduledDateIsToday = nextSchedule.isToday;
  const scheduledDateInCurrentWeek = nextSchedule.inCurrentWeek;
  const scheduledDateInNextWeek = nextSchedule.inNextWeek;
  const scheduledDateIsFuture = scheduledDate > todayStr;

  // نفس المجموعة → اسمح مباشرة
  if (studentGroup.id === scannerGroupId) {
    return {
      decision: "allow",
      reason: "الطالب في نفس المجموعة",
      studentGroupId: studentGroup.id,
      studentGroupName: studentGroup.name,
      studentGroupSchedule: studentGroup.day_of_week,
      nextScheduledDate: scheduledDate,
      scheduledDateIsToday,
      scheduledDateIsFuture,
      scheduledDateInCurrentWeek,
      scheduledDateInNextWeek,
    };
  }

  // مجموعة مختلفة ولكن موعد المجموعة في الأسبوع القادم → امنع
  if (scheduledDateInNextWeek) {
    const DAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const dayName = DAYS_AR[new Date(scheduledDate + "T00:00:00Z").getUTCDay()];
    return {
      decision: "deny",
      reason: `موعد حصة الطالب في الأسبوع القادم (${dayName} ${scheduledDate})، لا يمكن تسجيله الآن`,
      studentGroupId: studentGroup.id,
      studentGroupName: studentGroup.name,
      studentGroupSchedule: studentGroup.day_of_week,
      nextScheduledDate: scheduledDate,
      scheduledDateIsToday,
      scheduledDateIsFuture,
      scheduledDateInCurrentWeek,
      scheduledDateInNextWeek,
    };
  }

  // مجموعة مختلفة وموعد المجموعة في الأسبوع الحالي → اعرض تأكيد
  if (scheduledDateInCurrentWeek) {
    const DAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    let confirmReason = "هذا ليس موعد مجموعته المعتاد";
    
    if (scheduledDateIsToday) {
      confirmReason = `موعد حصة الطالب اليوم (${studentGroup.day_of_week})`;
    } else if (scheduledDateIsFuture) {
      const dayName = DAYS_AR[new Date(scheduledDate + "T00:00:00Z").getUTCDay()];
      confirmReason = `موعد حصته القادمة ${dayName} ${scheduledDate}`;
    } else {
      const dayName = DAYS_AR[new Date(scheduledDate + "T00:00:00Z").getUTCDay()];
      confirmReason = `موعد حصته كان ${dayName} ${scheduledDate}`;
    }

    return {
      decision: "confirm",
      reason: confirmReason,
      studentGroupId: studentGroup.id,
      studentGroupName: studentGroup.name,
      studentGroupSchedule: studentGroup.day_of_week,
      nextScheduledDate: scheduledDate,
      scheduledDateIsToday,
      scheduledDateIsFuture,
      scheduledDateInCurrentWeek,
      scheduledDateInNextWeek,
    };
  }

  // حالة افتراضية (لا ينبغي الوصول إليها)
  return {
    decision: "deny",
    reason: "لا يمكن تحديد صلاحية التسجيل",
    studentGroupId: studentGroup.id,
    studentGroupName: studentGroup.name,
    studentGroupSchedule: studentGroup.day_of_week,
    nextScheduledDate: scheduledDate,
    scheduledDateIsToday,
    scheduledDateIsFuture,
    scheduledDateInCurrentWeek,
    scheduledDateInNextWeek,
  };
}
