// routes/attendanceRoutes.ts
import { Router } from 'express';
import * as attendanceController from '../controller/attendanceController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate);

// ── Self-service ─────────────────────────────────────────────────
router.get('/me', attendanceController.getMyAttendance);
router.get('/today', attendanceController.getMyToday);

/**
 * Auto attendance from login/logout.
 * No `authorize()` needed — every authenticated user marks their own
 * attendance. The controller resolves the Employee from req.user._id.
 */
router.post('/check-in', attendanceController.checkIn);
router.post('/check-out', attendanceController.checkOut);

// ── Admin ────────────────────────────────────────────────────────
router.get(
  '/stats',
  authorize('attendance', 'view'),
  attendanceController.getAttendanceStats
);

router.post(
  '/preview-status',
  authorize('attendance', 'view'),
  attendanceController.previewStatus
);

router.get(
  '/',
  authorize('attendance', 'view'),
  attendanceController.listAttendance
);

router.post(
  '/',
  authorize('attendance', 'add'),
  attendanceController.upsertAttendance
);

router.post(
  '/bulk-mark',
  authorize('attendance', 'add'),
  attendanceController.bulkMarkDay
);

router.post(
  '/reconcile',
  authorize('attendance', 'edit'),
  attendanceController.reconcileDay
);

// ── Dedicated employee monthly view ──────────────────────────────
// IMPORTANT: this MUST come before '/:id'
router.get(
  '/employee/:employeeId/monthly',
  authorize('attendance', 'view'),
  attendanceController.getEmployeeMonthlyAttendance
);

router.get(
  '/:id',
  authorize('attendance', 'view'),
  attendanceController.getAttendance
);

router.patch(
  '/:id',
  authorize('attendance', 'edit'),
  attendanceController.updateAttendanceById
);

router.delete(
  '/:id',
  authorize('attendance', 'delete'),
  attendanceController.deleteAttendance
);

export default router;