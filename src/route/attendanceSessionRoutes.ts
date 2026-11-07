import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controller/attendanceSessionController';

const router = Router(); 

// Every route requires login. Self-service routes resolve the
// another user's data even without explicit permission checks.
router.use(authenticate);

// ── Self-service (employee) ─────────────────────────────────
router.get   ('/me/today',        ctrl.getMyToday);
router.get   ('/me/day',          ctrl.getMyDay);
router.get   ('/me/monthly',      ctrl.getMyMonthly);
router.post  ('/me/start',        ctrl.startMyDay);
router.post  ('/me/check-in',     ctrl.checkIn);
router.post  ('/me/break/start',  ctrl.startBreak);
router.post  ('/me/break/end',    ctrl.endBreak);
router.post  ('/me/end',          ctrl.endMyDay);

// ── Admin (requireAdmin inside controller) ──────────────────
router.get   ('/stats',                       ctrl.getDayStats);
router.get   ('/',                            ctrl.listSessions);
router.get   ('/:id',                         ctrl.getSession);
router.get   ('/employee/:employeeId/monthly', ctrl.getEmployeeMonthly);
router.post  ('/:id/force-end',               ctrl.forceEndSession);
router.post  ('/:id/reset',                   ctrl.resetSession);
router.post  ('/:id/adjust-break',            ctrl.adjustBreak);

export default router;