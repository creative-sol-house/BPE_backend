// controller/holidayController.ts
import { Response } from 'express';
import Holiday, {
  HOLIDAY_PATTERNS,
  type HolidayPattern,
} from '../model/holiday';
import { AuthRequest } from '../middleware/auth';

export async function listHolidays(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { search, pattern, activeOnly = 'true' } = req.query;

    const filter: any = { isDeleted: false };
    if (activeOnly === 'true') filter.isActive = true;
    if (pattern) filter.pattern = pattern;
    if (search) filter.name = { $regex: search, $options: 'i' };

    const holidays = await Holiday.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: holidays });
  } catch (err: any) {
    console.error('listHolidays error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getHoliday(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const h = await Holiday.findById(req.params.id);
    if (!h || h.isDeleted) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }
    res.json({ success: true, data: h });
  } catch (err: any) {
    console.error('getHoliday error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createHoliday(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      name,
      description,
      pattern,
      date,
      weekday,
      anchorDate,
      dayOfMonth,
      month,
      day,
    } = req.body;

    if (!name || !pattern) {
      res.status(400).json({ success: false, message: 'name and pattern are required' });
      return;
    }
    if (!HOLIDAY_PATTERNS.includes(pattern)) {
      res.status(400).json({
        success: false,
        message: `Invalid pattern. Allowed: ${HOLIDAY_PATTERNS.join(', ')}`,
      });
      return;
    }

    // Validate pattern-specific fields
    if (pattern === 'once' && !date) {
      res.status(400).json({ success: false, message: 'date is required for "once"' });
      return;
    }
    if ((pattern === 'weekly' || pattern === 'biweekly') && weekday === undefined) {
      res.status(400).json({
        success: false,
        message: 'weekday (0-6) is required for weekly/biweekly',
      });
      return;
    }
    if (pattern === 'biweekly' && !anchorDate) {
      res.status(400).json({
        success: false,
        message: 'anchorDate is required for biweekly',
      });
      return;
    }
    if (pattern === 'monthly' && !dayOfMonth) {
      res.status(400).json({
        success: false,
        message: 'dayOfMonth is required for monthly',
      });
      return;
    }
    if (pattern === 'yearly' && (!month || !day)) {
      res.status(400).json({
        success: false,
        message: 'month and day are required for yearly',
      });
      return;
    }

    const payload: any = {
      name: String(name).trim(),
      description: description || undefined,
      pattern: pattern as HolidayPattern,
      createdBy: req.user!._id,
      isActive: true,
      isDeleted: false,
    };

    if (pattern === 'once') payload.date = new Date(date);
    if (pattern === 'weekly' || pattern === 'biweekly') payload.weekday = weekday;
    if (pattern === 'biweekly') payload.anchorDate = new Date(anchorDate);
    if (pattern === 'monthly') payload.dayOfMonth = dayOfMonth;
    if (pattern === 'yearly') {
      payload.month = month;
      payload.day = day;
    }

    const holiday = await Holiday.create(payload);

    res.status(201).json({
      success: true,
      message: 'Holiday created',
      data: holiday,
    });
  } catch (err: any) {
    console.error('createHoliday error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateHoliday(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const h = await Holiday.findById(req.params.id);
    if (!h || h.isDeleted) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }

    const {
      name,
      description,
      pattern,
      date,
      weekday,
      anchorDate,
      dayOfMonth,
      month,
      day,
      isActive,
    } = req.body;

    if (name !== undefined) h.name = name;
    if (description !== undefined) h.description = description;
    if (pattern !== undefined && HOLIDAY_PATTERNS.includes(pattern)) {
      h.pattern = pattern;
    }
    if (date !== undefined) h.date = date ? new Date(date) : undefined;
    if (weekday !== undefined) h.weekday = weekday;
    if (anchorDate !== undefined) h.anchorDate = anchorDate ? new Date(anchorDate) : undefined;
    if (dayOfMonth !== undefined) h.dayOfMonth = dayOfMonth;
    if (month !== undefined) h.month = month;
    if (day !== undefined) h.day = day;
    if (isActive !== undefined) h.isActive = Boolean(isActive);

    await h.save();
    res.json({ success: true, message: 'Holiday updated', data: h });
  } catch (err: any) {
    console.error('updateHoliday error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteHoliday(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const h = await Holiday.findById(req.params.id);
    if (!h || h.isDeleted) {
      res.status(404).json({ success: false, message: 'Holiday not found' });
      return;
    }
    h.isDeleted = true;
    await h.save();
    res.json({ success: true, message: 'Holiday deleted' });
  } catch (err: any) {
    console.error('deleteHoliday error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/** Preview which days match a holiday within a range. Handy for the UI. */
export async function previewHolidayDates(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      res.status(400).json({ success: false, message: 'from and to required' });
      return;
    }
    const start = new Date(String(from));
    const end = new Date(String(to));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      res.status(400).json({ success: false, message: 'Invalid dates' });
      return;
    }
    const holidays = await Holiday.find({ isDeleted: false, isActive: true });
    const matches: { date: string; holiday: string }[] = [];
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    );
    const max = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
    );

    while (cursor <= max) {
      for (const h of holidays) {
        if (Holiday.matchesDate(h, cursor)) {
          matches.push({
            date: cursor.toISOString().slice(0, 10),
            holiday: h.name,
          });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    res.json({ success: true, data: matches });
  } catch (err: any) {
    console.error('previewHolidayDates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
} 

//checking