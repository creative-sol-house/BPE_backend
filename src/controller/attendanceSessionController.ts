// controller/attendanceSessionController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import AttendanceSession, {
  BREAK_LIMIT_MIN,
  CHECK_INTERVAL_MIN,
  type IAttendanceSession,
} from '../model/AttendanceSession';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Resolve the Employee doc for the logged-in user. */
async function resolveMyEmployee(userId: any) {
  return Employee.findOne({ user: userId, isDeleted: false });
}

/** Is the caller an admin? (main admin OR has `attendance:view`) */
async function isAdmin(req: AuthRequest): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.isMainAdmin) return true;
  return req.user.can('attendance', 'view');
}

/** Throws if the caller is not an admin. */
async function requireAdmin(req: AuthRequest): Promise<boolean> {
  const ok = await isAdmin(req);
  if (!ok) {
    throw Object.assign(new Error('Admin access required'), { status: 403 });
  }
  return true;
}

/** Unified error responder. */
function fail(res: Response, err: any) {
  const status = err?.status ?? 500;
  if (status >= 500) console.error('attendanceSession error:', err);
  res.status(status).json({ success: false, message: err?.message ?? 'Server error' });
}

/* ══════════════════════════════════════════════════════════════
   SELF-SERVICE — ME
   Every endpoint below resolves session from req.user._id,
   so an employee can only ever touch their own data.
   ══════════════════════════════════════════════════════════════ */

// ── POST /api/attendance-session/me/start ───────────────────────────────
export async function startMyDay(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const session = await AttendanceSession.startDay(req.user._id);

    res.json({ success: true, message: 'Day started', data: session });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/me/check-in ────────────────────────────
export async function checkIn(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const session = await AttendanceSession.checkIn(req.user._id);

    res.json({
      success: true,
      message: 'Checked in',
      data: {
        checkInCount: session.checkInCount,
        missedCount: session.missedCount,
        lastCheckIn: session.checkIns[session.checkIns.length - 1],
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/me/break/start ─────────────────────────
export async function startBreak(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const session = await AttendanceSession.startBreak(req.user._id);

    res.json({
      success: true,
      message: 'Break started',
      data: {
        breakUsedMin: session.breakUsedMin,
        breakLimitMin: BREAK_LIMIT_MIN,
        remainingBreakMin: Math.max(0, BREAK_LIMIT_MIN - session.breakUsedMin),
        activeBreak: session.breaks[session.breaks.length - 1],
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/me/break/end ───────────────────────────
export async function endBreak(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const session = await AttendanceSession.endBreak(req.user._id);

    res.json({
      success: true,
      message: 'Break ended',
      data: {
        breakUsedMin: session.breakUsedMin,
        breakLimitMin: BREAK_LIMIT_MIN,
        remainingBreakMin: Math.max(0, BREAK_LIMIT_MIN - session.breakUsedMin),
        breaks: session.breaks,
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/me/end ─────────────────────────────────
export async function endMyDay(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const session = await AttendanceSession.endDay(req.user._id);

    res.json({
      success: true,
      message: 'Day ended',
      data: {
        startAt: session.startAt,
        endAt: session.endAt,
        workedMin: session.workedMin,
        workedHours: session.workedHours,
        breakUsedMin: session.breakUsedMin,
        checkInCount: session.checkInCount,
        missedCount: session.missedCount,
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── GET /api/attendance-session/me/today ────────────────────────────────
export async function getMyToday(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const today = AttendanceSession.normalizeDate(new Date());
    const session = await AttendanceSession.findOne({
      user: req.user._id,
      date: today,
      isDeleted: false,
    });

    res.json({
      success: true,
      data: session,
      meta: {
        date: today,
        breakLimitMin: BREAK_LIMIT_MIN,
        checkIntervalMin: CHECK_INTERVAL_MIN,
        remainingBreakMin: session ? Math.max(0, BREAK_LIMIT_MIN - session.breakUsedMin) : BREAK_LIMIT_MIN,
        canCheckIn: session ? session.isActive && !session.breaks.some((b) => !b.end) : false,
        canBreak:
          session
            ? session.isActive && session.breakUsedMin < BREAK_LIMIT_MIN && !session.breaks.some((b) => !b.end)
            : false,
        onBreak: session ? session.breaks.some((b) => !b.end) : false,
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── GET /api/attendance-session/me/day?date=YYYY-MM-DD ──────────────────
export async function getMyDay(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const dateStr = String(req.query.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return void res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
    }

    const target = AttendanceSession.normalizeDate(dateStr);
    const session = await AttendanceSession.findOne({
      user: req.user._id,
      date: target,
      isDeleted: false,
    });

    res.json({ success: true, data: session });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── GET /api/attendance-session/me/monthly?year=2025&month=0 ────────────
export async function getMyMonthly(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const { year, month } = req.query;
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);

    if (Number.isNaN(y) || Number.isNaN(m) || m < 0 || m > 11) {
      return void res.status(400).json({ success: false, message: 'Valid year and month (0-11) required' });
    }

    const summary = await AttendanceSession.getMonthlySummary(req.user._id, new Date(Date.UTC(y, m, 1)));

    res.json({ success: true, data: summary });
  } catch (err: any) {
    fail(res, err);
  }
}

/* ══════════════════════════════════════════════════════════════
   ADMIN — LIST, VIEW ANY, FORCE-END, MANUAL ADJUST
   All of these require admin (main admin OR attendance:view).
   ══════════════════════════════════════════════════════════════ */

// ── GET /api/attendance-session?date=&employeeId=&department=&page=&limit= ─
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const {
      date,
      from,
      to,
      employeeId,
      department,
      search,
      active,
      page = '1',
      limit = '50',
    } = req.query;

    const filter: any = { isDeleted: false };

    // Single-day filter (preferred)
    if (date) {
      filter.date = AttendanceSession.normalizeDate(String(date));
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = AttendanceSession.normalizeDate(String(from));
      if (to) filter.date.$lte = AttendanceSession.normalizeDate(String(to));
    }

    if (employeeId) {
      const v = String(employeeId).trim();
      filter[newFunction() ? 'employee' : 'employeeId'] =
        /^[a-f\d]{24}$/i.test(v) ? v : v;
    }

    if (department) filter.department = String(department);
    if (active !== undefined) filter.isActive = active === 'true';

    if (search) {
      filter.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(String(page), 10));
    const limitNum = Math.min(500, Math.max(1, parseInt(String(limit), 10)));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      AttendanceSession.find(filter)
        .sort({ date: -1, startAt: -1 })
        .skip(skip)
        .limit(limitNum),
      AttendanceSession.countDocuments(filter),
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
    fail(res, err);
  }

    function newFunction() {
        return `/^[a-f\\d]{24}$/i.test(v)`;
    }
}

// ── GET /api/attendance-session/:id ─────────────────────────────────────
export async function getSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const rec = await AttendanceSession.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      return void res.status(404).json({ success: false, message: 'Session not found' });
    }

    res.json({ success: true, data: rec });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── GET /api/attendance-session/employee/:employeeId/monthly?year=&month= ─
export async function getEmployeeMonthly(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const { employeeId } = req.params;
    const { year, month } = req.query;
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);

    if (Number.isNaN(y) || Number.isNaN(m) || m < 0 || m > 11) {
      return void res.status(400).json({ success: false, message: 'Valid year and month (0-11) required' });
    }

    const idStr = String(employeeId);
    const emp = await Employee.findOne(
      /^[a-f\d]{24}$/i.test(idStr)
        ? { _id: idStr, isDeleted: false }
        : { employeeId: idStr, isDeleted: false }
    );
    if (!emp) return void res.status(404).json({ success: false, message: 'Employee not found' });
    if (!emp.user) {
      return void res.status(400).json({ success: false, message: 'Employee has no linked user account' });
    }

    const summary = await AttendanceSession.getMonthlySummary(emp.user, new Date(Date.UTC(y, m, 1)));

    res.json({
      success: true,
      data: {
        employee: {
          _id: emp._id,
          name: emp.name,
          employeeId: emp.employeeId,
          department: emp.department,
          designation: emp.designation,
        },
        ...summary,
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── GET /api/attendance-session/stats?date=YYYY-MM-DD ───────────────────
export async function getDayStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const dateStr = String(req.query.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return void res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
    }

    const target = AttendanceSession.normalizeDate(dateStr);

    const [totalEmployees, agg] = await Promise.all([
      Employee.countDocuments({ isDeleted: false }),
      AttendanceSession.aggregate([
        { $match: { date: target, isDeleted: false } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            ended: { $sum: { $cond: ['$endAt', 1, 0] } },
            totalCheckIns: { $sum: '$checkInCount' },
            totalMissed: { $sum: '$missedCount' },
            totalWorkedMin: { $sum: '$workedMin' },
            totalBreakMin: { $sum: '$breakUsedMin' },
          },
        },
      ]),
    ]);

    const s = agg[0] ?? {
      total: 0,
      active: 0,
      ended: 0,
      totalCheckIns: 0,
      totalMissed: 0,
      totalWorkedMin: 0,
      totalBreakMin: 0,
    };

    res.json({
      success: true,
      data: {
        date: target,
        totalEmployees,
        sessions: s.total,
        notStarted: Math.max(0, totalEmployees - s.total),
        active: s.active,
        ended: s.ended,
        totalCheckIns: s.totalCheckIns,
        totalMissed: s.totalMissed,
        totalWorkedHours: Math.round((s.totalWorkedMin / 60) * 100) / 100,
        totalBreakMin: s.totalBreakMin,
      },
    });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/:id/force-end ──────────────────────────
export async function forceEndSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const rec = await AttendanceSession.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      return void res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (rec.endAt) {
      return void res.status(409).json({ success: false, message: 'Session already ended' });
    }

    await AttendanceSession.endDay(rec.user);
    const fresh = await AttendanceSession.findById(rec._id);

    res.json({ success: true, message: 'Session force-ended', data: fresh });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/:id/reset ──────────────────────────────
// Soft-deletes the session so the employee can start fresh. Admin-only.
export async function resetSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const rec = await AttendanceSession.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      return void res.status(404).json({ success: false, message: 'Session not found' });
    }

    rec.isDeleted = true;
    rec.isActive = false;
    await rec.save();

    res.json({ success: true, message: 'Session reset (soft-deleted)' });
  } catch (err: any) {
    fail(res, err);
  }
}

// ── POST /api/attendance-session/:id/adjust-break ───────────────────────
// Admin manual override of breakUsedMin. Body: { breakUsedMin: number }
export async function adjustBreak(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const rec = await AttendanceSession.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      return void res.status(404).json({ success: false, message: 'Session not found' });
    }

    const value = Number(req.body?.breakUsedMin);
    if (!Number.isFinite(value) || value < 0 || value > BREAK_LIMIT_MIN) {
      return void res.status(400).json({
        success: false,
        message: `breakUsedMin must be 0–${BREAK_LIMIT_MIN}`,
      });
    }

    rec.breakUsedMin = value;
    if (rec.endAt && rec.startAt) {
      const totalMin = Math.max(0, Math.round((rec.endAt.getTime() - rec.startAt.getTime()) / 60000));
      rec.workedMin = Math.max(0, totalMin - rec.breakUsedMin);
      rec.workedHours = Math.round((rec.workedMin / 60) * 100) / 100;
    }
    await rec.save();

    res.json({ success: true, message: 'Break total adjusted', data: rec });
  } catch (err: any) {
    fail(res, err);
  }
}