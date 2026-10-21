// controller/attendanceController.ts
import { Response } from 'express';
import Attendance, {
  ATTENDANCE_STATUSES,
  ATTENDED_STATUSES,
  type AttendanceStatus,
} from '../model/attendance';
import Holiday from '../model/holiday';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';
import {
  ATTENDANCE_RULES,
  normalizeDate,
  isValidISODate,
  isWeekend,
  deriveStatus,
  computeWorkedHours,
} from '../utils/attendanceHelper';
import { markAttendanceFromAuth } from '../utils/attendanceAutoMark';

/* ══════════════════════════════════════════════════════════════
   RULES re-export
   ══════════════════════════════════════════════════════════════ */
export { ATTENDANCE_RULES };

/* ══════════════════════════════════════════════════════════════
   Allowed sort keys
   ══════════════════════════════════════════════════════════════ */
const ALLOWED_SORTS = new Set([
  '-date', 'date',
  '-createdAt', 'createdAt',
  '-updatedAt', 'updatedAt',
  'employeeName', '-employeeName',
  'employeeId', '-employeeId',
  'status', '-status',
]);

function safeSort(raw: unknown): string {
  const s = String(raw ?? '-date');
  return ALLOWED_SORTS.has(s) ? s : '-date';
}

/* ══════════════════════════════════════════════════════════════
   HELPER — resolve Employee from auth user
   Accepts ObjectId | string (mongoose-compatible)
   ══════════════════════════════════════════════════════════════ */
async function resolveMyEmployee(userId: any) {
  return Employee.findOne({ user: userId, isDeleted: false });
}

/* ══════════════════════════════════════════════════════════════
   LIST
   ══════════════════════════════════════════════════════════════ */
export async function listAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      from,
      to,
      employeeId,
      department,
      status,
      search,
      page = '1',
      limit = '50',
      sort = '-date',
    } = req.query;

    const filter: any = { isDeleted: false };

    if (from || to) {
      filter.date = {};
      if (from && isValidISODate(from)) filter.date.$gte = normalizeDate(String(from));
      if (to && isValidISODate(to)) filter.date.$lte = normalizeDate(String(to));
      if (Object.keys(filter.date).length === 0) delete filter.date;
    }

    if (employeeId) {
      const val = String(employeeId).trim();
      if (/^[a-f\d]{24}$/i.test(val)) {
        filter.employee = val;
      } else {
        filter.employeeId = val;
      }
    }

    if (department) filter.department = String(department);

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is AttendanceStatus =>
          (ATTENDANCE_STATUSES as string[]).includes(s)
        );
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (search) {
      filter.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      Attendance.find(filter)
        .populate('employee', 'name employeeId department designation')
        .populate('markedBy', 'name username')
        .sort(safeSort(sort))
        .skip(skip)
        .limit(limitNum),
      Attendance.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listAttendance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   GET ONE
   ══════════════════════════════════════════════════════════════ */
export async function getAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const rec = await Attendance.findById(req.params.id)
      .populate('employee', 'name employeeId department designation')
      .populate('markedBy', 'name username');

    if (!rec || rec.isDeleted) {
      res.status(404).json({ success: false, message: 'Attendance record not found' });
      return;
    }

    res.json({ success: true, data: rec });
  } catch (err: any) {
    console.error('getAttendance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   UPSERT ONE (admin manual override)
   ══════════════════════════════════════════════════════════════ */
export async function upsertAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      employee: employeeId,
      date,
      status,
      arrivalAt,
      departureAt,
      notes,
    } = req.body;

    if (!employeeId || !date) {
      res.status(400).json({
        success: false,
        message: 'employee and date are required',
      });
      return;
    }

    if (!isValidISODate(date)) {
      res.status(400).json({
        success: false,
        message: 'date must be a valid YYYY-MM-DD',
      });
      return;
    }

    if (status && !ATTENDANCE_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${ATTENDANCE_STATUSES.join(', ')}`,
      });
      return;
    }

    const emp = await Employee.findOne({
      _id: employeeId,
      isDeleted: false,
    });
    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    if (emp.user && String(emp.user) === String(req.user!._id)) {
      res.status(403).json({
        success: false,
        message: 'You cannot mark your own attendance',
      });
      return;
    }

    const normalizedDate = normalizeDate(date);
    const arr = arrivalAt ? new Date(arrivalAt) : null;
    const dep = departureAt ? new Date(departureAt) : null;

    let finalStatus: AttendanceStatus;
    if (status === 'leave' || status === 'holiday') {
      finalStatus = status;
    } else if (arr || dep) {
      finalStatus = deriveStatus(normalizedDate, arr, dep);
    } else if (status) {
      finalStatus = status as AttendanceStatus;
    } else {
      finalStatus = deriveStatus(normalizedDate, arr, dep);
    }

    const payload = {
      employee: emp._id,
      user: emp.user || null,
      employeeId: emp.employeeId,
      employeeName: emp.name,
      department: emp.department || '',
      date: normalizedDate,
      arrivalAt: arr,
      departureAt: dep,
      workedHours: computeWorkedHours(arr, dep),
      status: finalStatus,
      notes: notes || undefined,
      source: 'manual' as const,
      markedBy: req.user!._id,
      isDeleted: false,
    };

    const rec = await Attendance.findOneAndUpdate(
      { employee: emp._id, date: normalizedDate },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
      .populate('employee', 'name employeeId department designation')
      .populate('markedBy', 'name username');

    res.json({
      success: true,
      message: 'Attendance saved',
      data: rec,
    });
  } catch (err: any) {
    console.error('upsertAttendance error:', err);
    if (err?.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'Attendance already exists for this employee and date',
      });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   UPDATE BY ID
   ══════════════════════════════════════════════════════════════ */
export async function updateAttendanceById(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const rec = await Attendance.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      res.status(404).json({ success: false, message: 'Attendance record not found' });
      return;
    }

    const { status, arrivalAt, departureAt, notes } = req.body;

    if (status && !ATTENDANCE_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${ATTENDANCE_STATUSES.join(', ')}`,
      });
      return;
    }

    if (rec.user && String(rec.user) === String(req.user!._id)) {
      res.status(403).json({
        success: false,
        message: 'You cannot edit your own attendance',
      });
      return;
    }

    const arr = arrivalAt !== undefined
      ? (arrivalAt ? new Date(arrivalAt) : null)
      : rec.arrivalAt;
    const dep = departureAt !== undefined
      ? (departureAt ? new Date(departureAt) : null)
      : rec.departureAt;

    let finalStatus: AttendanceStatus;
    if (status === 'leave' || status === 'holiday') {
      finalStatus = status;
    } else if (status === 'weekend') {
      finalStatus = 'weekend';
    } else if (arr || dep) {
      finalStatus = deriveStatus(rec.date, arr, dep);
    } else if (status) {
      finalStatus = status as AttendanceStatus;
    } else {
      finalStatus = deriveStatus(rec.date, arr, dep);
    }

    rec.arrivalAt = arr;
    rec.departureAt = dep;
    rec.workedHours = computeWorkedHours(arr, dep);
    rec.status = finalStatus;
    if (notes !== undefined) rec.notes = notes || undefined;
    rec.source = 'manual';
    rec.markedBy = req.user!._id;

    await rec.save();
    await rec.populate('employee', 'name employeeId department designation');
    await rec.populate('markedBy', 'name username');

    res.json({
      success: true,
      message: 'Attendance updated',
      data: rec,
    });
  } catch (err: any) {
    console.error('updateAttendanceById error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   BULK MARK DAY
   ══════════════════════════════════════════════════════════════ */
export async function bulkMarkDay(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { date, entries } = req.body;

    if (!date) {
      res.status(400).json({ success: false, message: 'date is required' });
      return;
    }
    if (!isValidISODate(date)) {
      res.status(400).json({
        success: false,
        message: 'date must be a valid YYYY-MM-DD',
      });
      return;
    }
    if (!Array.isArray(entries)) {
      res.status(400).json({ success: false, message: 'entries array is required' });
      return;
    }

    const normalizedDate = normalizeDate(date);
    const markedBy = req.user!._id;

    const weekend = isWeekend(normalizedDate);
    const holidays = await Holiday.forDate(normalizedDate);
    const isHoliday = holidays.length > 0;

    const autoDayStatus: AttendanceStatus | null = isHoliday
      ? 'holiday'
      : weekend
      ? 'weekend'
      : null;

    const seen = new Set<string>();
    const cleanEntries: any[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const key = String(e?.employee ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      cleanEntries.push(e);
    }
    cleanEntries.reverse();

    const employeeIds = cleanEntries.map((e) => e.employee).filter(Boolean);
    const employees = await Employee.find({
      _id: { $in: employeeIds },
      isDeleted: false,
    });
    const empMap = new Map(employees.map((e) => [String(e._id), e]));

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const entry of cleanEntries) {
      const emp = empMap.get(String(entry.employee));
      if (!emp) {
        skipped.push(String(entry.employee));
        continue;
      }

      if (emp.user && String(emp.user) === String(req.user!._id)) {
        errors.push(`${emp.name}: cannot mark own attendance`);
        continue;
      }

      const arr = entry.arrivalAt ? new Date(entry.arrivalAt) : null;
      const dep = entry.departureAt ? new Date(entry.departureAt) : null;

      let finalStatus: AttendanceStatus;
      if (
        entry.status === 'leave' ||
        entry.status === 'holiday' ||
        entry.status === 'weekend'
      ) {
        finalStatus = entry.status;
      } else if (arr || dep) {
        finalStatus = deriveStatus(normalizedDate, arr, dep);
      } else if (entry.status) {
        finalStatus = entry.status;
      } else if (autoDayStatus) {
        finalStatus = autoDayStatus;
      } else {
        finalStatus = deriveStatus(normalizedDate, arr, dep);
      }

      const payload = {
        employee: emp._id,
        user: emp.user || null,
        employeeId: emp.employeeId,
        employeeName: emp.name,
        department: emp.department || '',
        date: normalizedDate,
        arrivalAt: arr,
        departureAt: dep,
        workedHours: computeWorkedHours(arr, dep),
        status: finalStatus,
        notes: entry.notes || undefined,
        source: 'manual' as const,
        markedBy,
        isDeleted: false,
      };

      const existing = await Attendance.findOne({
        employee: emp._id,
        date: normalizedDate,
      });

      if (existing) {
        existing.set(payload);
        await existing.save();
        updated++;
      } else {
        await new Attendance(payload).save();
        created++;
      }
    }

    let autoCreated = 0;
    if (autoDayStatus) {
      const allEmployees = await Employee.find({ isDeleted: false });
      const alreadyHave = await Attendance.find({
        date: normalizedDate,
        isDeleted: false,
      }).select('employee');
      const alreadySet = new Set(alreadyHave.map((a) => String(a.employee)));

      for (const emp of allEmployees) {
        if (alreadySet.has(String(emp._id))) continue;
        if (emp.user && String(emp.user) === String(req.user!._id)) continue;

        const payload = {
          employee: emp._id,
          user: emp.user || null,
          employeeId: emp.employeeId,
          employeeName: emp.name,
          department: emp.department || '',
          date: normalizedDate,
          status: autoDayStatus,
          source: 'auto' as const,
          markedBy,
          isDeleted: false,
        };
        try {
          await new Attendance(payload).save();
          autoCreated++;
        } catch (e: any) {
          if (e?.code !== 11000) {
            console.error('autoCreate failed:', e);
            errors.push(`${emp.name}: ${e?.message ?? 'auto-create failed'}`);
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Marked ${created + updated + autoCreated} records`,
      data: {
        created,
        updated,
        autoCreated,
        skipped,
        errors,
        isWeekend: weekend,
        isHoliday,
        holidayNames: holidays.map((h) => h.name),
      },
    });
  } catch (err: any) {
    console.error('bulkMarkDay error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   RECONCILE
   ══════════════════════════════════════════════════════════════ */
export async function reconcileDay(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { date } = req.body;
    if (!date || !isValidISODate(date)) {
      res.status(400).json({ success: false, message: 'Valid date required' });
      return;
    }

    const normalizedDate = normalizeDate(String(date));
    const weekend = isWeekend(normalizedDate);
    const holidays = await Holiday.forDate(normalizedDate);
    const isHoliday = holidays.length > 0;

    const records = await Attendance.find({
      date: normalizedDate,
      isDeleted: false,
    });

    let changed = 0;
    for (const rec of records) {
      if (rec.status === 'leave' || rec.source === 'manual') continue;

      let next: AttendanceStatus;
      if (isHoliday) {
        next = 'holiday';
      } else if (weekend) {
        next = 'weekend';
      } else {
        next = deriveStatus(normalizedDate, rec.arrivalAt, rec.departureAt);
      }

      if (rec.status !== next) {
        rec.status = next;
        rec.source = 'auto';
        rec.workedHours = computeWorkedHours(rec.arrivalAt, rec.departureAt);
        await rec.save();
        changed++;
      }
    }

    res.json({
      success: true,
      message: `Reconciled ${records.length} records`,
      data: { changed, total: records.length, isWeekend: weekend, isHoliday },
    });
  } catch (err: any) {
    console.error('reconcileDay error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   DELETE (soft)
   ══════════════════════════════════════════════════════════════ */
export async function deleteAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const rec = await Attendance.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      res.status(404).json({ success: false, message: 'Attendance record not found' });
      return;
    }
    rec.isDeleted = true;
    await rec.save();
    res.json({ success: true, message: 'Attendance deleted' });
  } catch (err: any) {
    console.error('deleteAttendance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   STATS
   ══════════════════════════════════════════════════════════════ */
export async function getAttendanceStats(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { date } = req.query;

    if (!date || !isValidISODate(date)) {
      res.status(400).json({
        success: false,
        message: 'date query param is required (YYYY-MM-DD)',
      });
      return;
    }

    const normalizedDate = normalizeDate(String(date));
    const baseFilter = { isDeleted: false, date: normalizedDate };

    const totalEmployees = await Employee.countDocuments({ isDeleted: false });

    const raw = await Attendance.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const byStatus: Record<AttendanceStatus | 'unknown', number> = {
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      weekend: 0,
      wfh: 0,
      unknown: 0,
    };
    let marked = 0;
    let attended = 0;
    for (const row of raw) {
      const key = (row._id ?? 'unknown') as AttendanceStatus | 'unknown';
      if (key in byStatus) byStatus[key] = row.count;
      else byStatus.unknown += row.count;
      marked += row.count;
      if ((ATTENDED_STATUSES as string[]).includes(String(key))) {
        attended += row.count;
      }
    }

    if (marked > totalEmployees) {
      console.warn(
        `getAttendanceStats: marked (${marked}) > totalEmployees (${totalEmployees}) on ${normalizedDate.toISOString().slice(0, 10)} — possible orphaned rows`
      );
    }

    res.json({
      success: true,
      data: {
        date: normalizedDate,
        totalEmployees,
        marked,
        unmarked: Math.max(0, totalEmployees - marked),
        attended,
        byStatus,
        isWeekend: isWeekend(normalizedDate),
        holidays: (await Holiday.forDate(normalizedDate)).map((h) => ({
          _id: h._id,
          name: h.name,
        })),
      },
    });
  } catch (err: any) {
    console.error('getAttendanceStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   MY ATTENDANCE  (self-service list — scoped to logged-in user)
   ══════════════════════════════════════════════════════════════ */
export async function getMyAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) {
      res.status(404).json({
        success: false,
        message: 'No employee record linked to your account',
      });
      return;
    }

    const { from, to, page = '1', limit = '31' } = req.query;

    const filter: any = { isDeleted: false, employee: emp._id };

    if (from || to) {
      filter.date = {};
      if (from && isValidISODate(from))
        filter.date.$gte = normalizeDate(String(from));
      if (to && isValidISODate(to))
        filter.date.$lte = normalizeDate(String(to));
      if (Object.keys(filter.date).length === 0) delete filter.date;
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(120, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      Attendance.find(filter).sort({ date: -1 }).skip(skip).limit(limitNum),
      Attendance.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('getMyAttendance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   MY TODAY  (self-service — today's record only)
   ══════════════════════════════════════════════════════════════ */
export async function getMyToday(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) {
      res.status(404).json({
        success: false,
        message: 'No employee record linked to your account',
      });
      return;
    }

    const today = normalizeDate(new Date());
    const rec = await Attendance.findOne({
      employee: emp._id,
      date: today,
      isDeleted: false,
    });

    res.json({
      success: true,
      data: rec,
      meta: {
        date: today,
        isWeekend: isWeekend(today),
      },
    });
  } catch (err: any) {
    console.error('getMyToday error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   MY MONTHLY  (self-service calendar view — scoped to logged-in user)
   GET /attendance/me/monthly?year=2025&month=0
   ══════════════════════════════════════════════════════════════ */
export async function getMyMonthly(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) {
      res.status(404).json({
        success: false,
        message: 'No employee record linked to your account',
      });
      return;
    }

    const { year, month } = req.query;
    if (!year || !month) {
      res.status(400).json({
        success: false,
        message: 'year and month query params are required',
      });
      return;
    }

    const yearNum = parseInt(String(year), 10);
    const monthNum = parseInt(String(month), 10);

    if (
      Number.isNaN(yearNum) ||
      Number.isNaN(monthNum) ||
      monthNum < 0 ||
      monthNum > 11
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid year or month (month is 0-indexed)',
      });
      return;
    }

    const firstDay = new Date(Date.UTC(yearNum, monthNum, 1));
    const lastDay = new Date(Date.UTC(yearNum, monthNum + 1, 0));
    const from = normalizeDate(firstDay);
    const to = normalizeDate(lastDay);
    const daysInMonth = lastDay.getUTCDate();

    const records = await Attendance.find({
      employee: emp._id,
      date: { $gte: from, $lte: to },
      isDeleted: false,
    }).sort({ date: 1 });

    const recordMap = new Map<string, any>();
    records.forEach((rec) => {
      const d = new Date(rec.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getUTCDate()).padStart(2, '0')}`;
      recordMap.set(key, rec);
    });

    const holidays = await Holiday.find({
      date: { $gte: from, $lte: to },
    }).lean();
    const holidayMap = new Map<string, string>();
    holidays.forEach((h: any) => {
      const d = new Date(h.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getUTCDate()).padStart(2, '0')}`;
      holidayMap.set(key, h.name);
    });

    const days: Array<{
      date: string;
      dayOfWeek: number;
      dayOfMonth: number;
      isWeekend: boolean;
      holidayName: string | null;
      record: any | null;
      status: AttendanceStatus | null;
    }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(yearNum, monthNum, d));
      const key = `${yearNum}-${String(monthNum + 1).padStart(2, '0')}-${String(
        d
      ).padStart(2, '0')}`;
      const dow = dt.getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const holidayName = holidayMap.get(key) || null;
      const record = recordMap.get(key) || null;

      let status: AttendanceStatus | null = record?.status ?? null;
      if (!status) {
        if (holidayName) status = 'holiday';
        else if (weekend) status = 'weekend';
      }

      days.push({
        date: key,
        dayOfWeek: dow,
        dayOfMonth: d,
        isWeekend: weekend,
        holidayName,
        record: record
          ? {
              _id: record._id,
              status: record.status,
              arrivalAt: record.arrivalAt,
              departureAt: record.departureAt,
              workedHours: record.workedHours,
              notes: record.notes,
              source: record.source,
            }
          : null,
        status,
      });
    }

    const summary = {
      totalDays: daysInMonth,
      workingDays: days.filter((d) => !d.isWeekend && !d.holidayName).length,
      present: days.filter((d) => d.status === 'present').length,
      late: days.filter((d) => d.status === 'late').length,
      halfDay: days.filter((d) => d.status === 'half_day').length,
      leave: days.filter((d) => d.status === 'leave').length,
      absent: days.filter((d) => d.status === 'absent').length,
      holiday: days.filter((d) => d.status === 'holiday').length,
      weekend: days.filter((d) => d.status === 'weekend').length,
      wfh: days.filter((d) => d.status === 'wfh').length,
      marked: days.filter((d) => d.record !== null).length,
      totalWorkedHours: days.reduce(
        (sum, d) => sum + (d.record?.workedHours || 0),
        0
      ),
    };

    res.json({
      success: true,
      data: {
        employee: {
          _id: emp._id,
          name: emp.name,
          employeeId: emp.employeeId,
          department: emp.department || '',
          designation: emp.designation || '',
        },
        year: yearNum,
        month: monthNum,
        monthLabel: new Date(yearNum, monthNum).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        }),
        from,
        to,
        days,
        summary,
      },
    });
  } catch (err: any) {
    console.error('getMyMonthly error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   PREVIEW
   ══════════════════════════════════════════════════════════════ */
export async function previewStatus(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { date, status, arrivalAt, departureAt } = req.body;
    if (!date) {
      res.status(400).json({ success: false, message: 'date required' });
      return;
    }
    if (!isValidISODate(date)) {
      res.status(400).json({
        success: false,
        message: 'date must be a valid YYYY-MM-DD',
      });
      return;
    }

    const normalizedDate = normalizeDate(date);
    const arr = arrivalAt ? new Date(arrivalAt) : null;
    const dep = departureAt ? new Date(departureAt) : null;

    const holidays = await Holiday.forDate(normalizedDate);
    const weekend = isWeekend(normalizedDate);

    let computed: AttendanceStatus;
    if (status === 'leave' || status === 'holiday') {
      computed = status;
    } else if (arr || dep) {
      computed = deriveStatus(normalizedDate, arr, dep);
    } else if (status && ATTENDANCE_STATUSES.includes(status)) {
      computed = status;
    } else if (holidays.length > 0) {
      computed = 'holiday';
    } else if (weekend) {
      computed = 'weekend';
    } else {
      computed = deriveStatus(normalizedDate, arr, dep);
    }

    res.json({
      success: true,
      data: {
        status: computed,
        workedHours: computeWorkedHours(arr, dep),
        isWeekend: weekend,
        isHoliday: holidays.length > 0,
        holidayNames: holidays.map((h) => h.name),
      },
    });
  } catch (err: any) {
    console.error('previewStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   EMPLOYEE MONTHLY ATTENDANCE  (admin — by employee id)
   ══════════════════════════════════════════════════════════════ */
export async function getEmployeeMonthlyAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { year, month } = req.query;

    if (!year || !month) {
      res.status(400).json({
        success: false,
        message: 'year and month query params are required',
      });
      return;
    }

    const yearNum = parseInt(String(year), 10);
    const monthNum = parseInt(String(month), 10);

    if (
      Number.isNaN(yearNum) ||
      Number.isNaN(monthNum) ||
      monthNum < 0 ||
      monthNum > 11
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid year or month (month is 0-indexed)',
      });
      return;
    }

    const employeeIdStr = String(employeeId);
    const isObjectId = /^[a-f\d]{24}$/i.test(employeeIdStr);
    const emp = await Employee.findOne(
      isObjectId
        ? { _id: employeeIdStr, isDeleted: false }
        : { employeeId: employeeIdStr, isDeleted: false }
    );

    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const firstDay = new Date(Date.UTC(yearNum, monthNum, 1));
    const lastDay = new Date(Date.UTC(yearNum, monthNum + 1, 0));
    const from = normalizeDate(firstDay);
    const to = normalizeDate(lastDay);
    const daysInMonth = lastDay.getUTCDate();

    const records = await Attendance.find({
      employee: emp._id,
      date: { $gte: from, $lte: to },
      isDeleted: false,
    })
      .sort({ date: 1 })
      .populate('markedBy', 'name username');

    const recordMap = new Map<string, any>();
    records.forEach((rec) => {
      const d = new Date(rec.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getUTCDate()).padStart(2, '0')}`;
      recordMap.set(key, rec);
    });

    const holidays = await Holiday.find({
      date: { $gte: from, $lte: to },
    }).lean();
    const holidayMap = new Map<string, string>();
    holidays.forEach((h: any) => {
      const d = new Date(h.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getUTCDate()).padStart(2, '0')}`;
      holidayMap.set(key, h.name);
    });

    const days: Array<{
      date: string;
      dayOfWeek: number;
      dayOfMonth: number;
      isWeekend: boolean;
      holidayName: string | null;
      record: any | null;
      status: AttendanceStatus | null;
    }> = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(yearNum, monthNum, d));
      const key = `${yearNum}-${String(monthNum + 1).padStart(2, '0')}-${String(
        d
      ).padStart(2, '0')}`;
      const dow = dt.getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const holidayName = holidayMap.get(key) || null;
      const record = recordMap.get(key) || null;

      let status: AttendanceStatus | null = record?.status ?? null;
      if (!status) {
        if (holidayName) status = 'holiday';
        else if (weekend) status = 'weekend';
      }

      days.push({
        date: key,
        dayOfWeek: dow,
        dayOfMonth: d,
        isWeekend: weekend,
        holidayName,
        record: record
          ? {
              _id: record._id,
              status: record.status,
              arrivalAt: record.arrivalAt,
              departureAt: record.departureAt,
              workedHours: record.workedHours,
              notes: record.notes,
              source: record.source,
              markedBy: record.markedBy,
            }
          : null,
        status,
      });
    }

    const summary = {
      totalDays: daysInMonth,
      workingDays: days.filter((d) => !d.isWeekend && !d.holidayName).length,
      present: days.filter((d) => d.status === 'present').length,
      late: days.filter((d) => d.status === 'late').length,
      halfDay: days.filter((d) => d.status === 'half_day').length,
      leave: days.filter((d) => d.status === 'leave').length,
      absent: days.filter((d) => d.status === 'absent').length,
      holiday: days.filter((d) => d.status === 'holiday').length,
      weekend: days.filter((d) => d.status === 'weekend').length,
      wfh: days.filter((d) => d.status === 'wfh').length,
      marked: days.filter((d) => d.record !== null).length,
      totalWorkedHours: days.reduce(
        (sum, d) => sum + (d.record?.workedHours || 0),
        0
      ),
    };

    res.json({
      success: true,
      data: {
        employee: {
          _id: emp._id,
          name: emp.name,
          employeeId: emp.employeeId,
          department: emp.department || '',
          designation: emp.designation || '',
        },
        year: yearNum,
        month: monthNum,
        monthLabel: new Date(yearNum, monthNum).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        }),
        from,
        to,
        days,
        summary,
      },
    });
  } catch (err: any) {
    console.error('getEmployeeMonthlyAttendance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTO CHECK-IN / CHECK-OUT
   ══════════════════════════════════════════════════════════════ */

/**
 * POST /attendance/check-in
 * Called after successful login. Only the FIRST call of the day
 * creates the record; every other call is a no-op.
 */
export async function checkIn(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const result = await markAttendanceFromAuth(req.user._id, 'login');

    if (result.reason === 'no-employee') {
      res.status(404).json({
        success: false,
        message: 'No employee record linked to your account',
      });
      return;
    }

    res.json({
      success: true,
      action: result.action,
      reason: result.reason,
      data: result.record,
    });
  } catch (err: any) {
    // Race: two simultaneous logins both saw "no row" and both tried
    // to insert. Unique index rejects the second. Return the winner.
    if (err?.code === 11000) {
      try {
        const emp = await Employee.findOne({
          user: req.user!._id,
          isDeleted: false,
        });
        const rec = emp
          ? await Attendance.findOne({
              employee: emp._id,
              date: normalizeDate(new Date()),
            })
          : null;

        res.json({
          success: true,
          action: 'skipped',
          reason: 'already-marked-today',
          data: rec,
        });
        return;
      } catch {
        /* fall through to 500 */
      }
    }
    console.error('checkIn error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /attendance/check-out
 * Called on logout. Updates departureAt, workedHours, status.
 * Never touches arrivalAt.
 */
export async function checkOut(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const result = await markAttendanceFromAuth(req.user._id, 'logout');

    if (result.reason === 'no-employee') {
      res.status(404).json({
        success: false,
        message: 'No employee record linked to your account',
      });
      return;
    }

    res.json({
      success: true,
      action: result.action,
      reason: result.reason,
      data: result.record,
    });
  } catch (err: any) {
    console.error('checkOut error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}