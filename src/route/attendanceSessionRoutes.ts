import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controller/attendanceSessionController';

const router = Router(); 

// Every route requires login. Self-service routes resolve the
// user from req.user._id, preventing cross-user data access.
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

// Static routes MUST come before dynamic `/:id` routes
router.get   ('/stats',                       ctrl.getDayStats);
router.get   ('/employee/:employeeId/monthly', ctrl.getEmployeeMonthly);

// List & Dynamic routes
router.get   ('/',                            ctrl.listSessions);
router.get   ('/:id',                         ctrl.getSession);

// Actions
router.post  ('/:id/force-end',               ctrl.forceEndSession);
router.post  ('/:id/reset',                   ctrl.resetSession);
router.post  ('/:id/adjust-break',            ctrl.adjustBreak);

export default router;