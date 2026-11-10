// controller/attendanceSessionController.ts
import { Response } from 'express';
import AttendanceSession, {
  SLOT_INTERVAL_MIN,
  GRACE_MIN,
  BREAK_LIMIT_MIN,
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

/** Compute the next assignable grid slot (not inside a break, not recorded). */
function computeNextSlot(session: any): Date | null {
  const anchor: Date | null = session?.scheduleAnchorAt ?? session?.scheduledStartAt ?? null;
  if (!anchor) return null;
  const intervalMs = (session.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
  const recorded = new Set<number>(
    (session.checkIns || [])
      .filter((c: any) => c.type === 'regular' || c.type === 'missed')
      .map((c: any) => new Date(c.scheduledFor).getTime())
  );
  let cursor = anchor.getTime();
  for (let i = 0; i < 24 * 60; i++) {
    if (!recorded.has(cursor)) return new Date(cursor);
    cursor += intervalMs;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════
   SELF-SERVICE — ME
   ══════════════════════════════════════════════════════════════ */

// ── POST /api/attendance-session/me/start ───────────────────────────────
export async function startMyDay(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) return void res.status(401).json({ success: false, message: 'Not authenticated' });

    const emp = await resolveMyEmployee(req.user._id);
    if (!emp) return void res.status(404).json({ success: false, message: 'No employee record linked' });

    const session = await AttendanceSession.startDay(req.user._id);

    res.json({
      success: true,
      message: 'Day started',
      data: session,
      meta: {
        scheduleIntervalMin: session.scheduleIntervalMin || SLOT_INTERVAL_MIN,
        graceMin: GRACE_MIN,
        scheduledStartAt: session.scheduledStartAt,
        nextSlotAt: computeNextSlot(session),
      },
    });
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

    // Last regular done slot
    const lastDone = [...session.checkIns]
      .filter((c) => c.type === 'regular' && c.status === 'done')
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;

    res.json({
      success: true,
      message: 'Checked in',
      data: {
        checkInCount: session.checkInCount,
        missedCount: session.missedCount,
        lastCheckIn: lastDone,
        nextSlotAt: computeNextSlot(session),
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

    const openBreak = session.breaks.find((b) => !b.end) ?? null;

    res.json({
      success: true,
      message: 'Break started',
      data: {
        breakUsedMin: session.breakUsedMin,
        breakLimitMin: BREAK_LIMIT_MIN,
        remainingBreakMin: Math.max(0, BREAK_LIMIT_MIN - session.breakUsedMin),
        activeBreak: openBreak,
        breaks: session.breaks,
        breakStartMarker:
          session.checkIns.find(
            (c) =>
              c.type === 'break-start' &&
              (!openBreak || c.at.getTime() === openBreak.start.getTime())
          ) ?? null,
        // Slots inside the break are skipped, so the next assignable
        // slot is the first grid point AFTER the break that isn't recorded.
        nextSlotAt: computeNextSlot(session),
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

    // Break-end is recorded as a `done` marker (type=break-end).
    // The grid is NOT re-anchored — next slot stays on the original schedule
    // (e.g. break ends 10:37 → next real slot = 11:00).
    const breakEndMarker = [...session.checkIns]
      .filter((c) => c.type === 'break-end')
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;

    res.json({
      success: true,
      message: 'Break ended',
      data: {
        breakUsedMin: session.breakUsedMin,
        breakLimitMin: BREAK_LIMIT_MIN,
        remainingBreakMin: Math.max(0, BREAK_LIMIT_MIN - session.breakUsedMin),
        breaks: session.breaks,
        breakEndMarker,
        nextSlotAt: computeNextSlot(session),
        scheduleAnchorAt: session.scheduleAnchorAt ?? session.scheduledStartAt,
        scheduleIntervalMin: session.scheduleIntervalMin || SLOT_INTERVAL_MIN,
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
        breaks: session.breaks,
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

    // Live-compute missed slots before returning
    await AttendanceSession.markMissedCheckIns(req.user._id);

    const today = AttendanceSession.normalizeDate(new Date());
    const session = await AttendanceSession.findOne({
      user: req.user._id,
      date: today,
      isDeleted: false,
    });

    const onBreak = session ? session.breaks.some((b) => !b.end) : false;

    res.json({
      success: true,
      data: session,
      meta: {
        date: today,
        breakLimitMin: BREAK_LIMIT_MIN,
        slotIntervalMin: session?.scheduleIntervalMin ?? SLOT_INTERVAL_MIN,
        graceMin: GRACE_MIN,
        remainingBreakMin: session
          ? Math.max(0, BREAK_LIMIT_MIN - session.breakUsedMin)
          : BREAK_LIMIT_MIN,
        canCheckIn: session
          ? session.isWorkingDay && session.isActive && !session.endAt && !onBreak
          : false,
        canBreak: session
          ? session.isWorkingDay &&
            session.isActive &&
            !session.endAt &&
            session.breakUsedMin < BREAK_LIMIT_MIN &&
            !onBreak
          : false,
        onBreak,
        isWorkingDay: session ? session.isWorkingDay : true,
        nextSlotAt: session ? computeNextSlot(session) : null,
        missedCount: session ? session.missedCount : 0,
        checkInCount: session ? session.checkInCount : 0,
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

    if (date) {
      filter.date = AttendanceSession.normalizeDate(String(date));
    } else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = AttendanceSession.normalizeDate(String(from));
      if (to) filter.date.$lte = AttendanceSession.normalizeDate(String(to));
    }

    if (employeeId) {
      const v = String(employeeId).trim();
      if (/^[a-f\d]{24}$/i.test(v)) {
        filter.employee = v;
      } else {
        filter.employeeId = v;
      }
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
// Hard-deletes the session so the employee can start fresh. Admin-only.
export async function resetSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    await requireAdmin(req);

    const rec = await AttendanceSession.findById(req.params.id);
    if (!rec || rec.isDeleted) {
      return void res.status(404).json({ success: false, message: 'Session not found' });
    }

    await AttendanceSession.deleteOne({ _id: rec._id });

    res.json({ success: true, message: 'Session deleted. Employee can start a new day.' });
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