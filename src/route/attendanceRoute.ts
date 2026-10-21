// routes/attendanceRoutes.ts
import { Router } from 'express';
import * as attendanceController from '../controller/attendanceController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate);

// ─────────────────────────────────────────────────────────────────
// SELF-SERVICE — any authenticated user, NO authorize() check.
// The controller resolves the Employee from req.user._id, so the
// user can only ever see/mark their own records.
//
// Order matters: '/me/monthly' and '/me' MUST come before '/:id'.
// ─────────────────────────────────────────────────────────────────
router.get('/me', attendanceController.getMyAttendance);
router.get('/me/monthly', attendanceController.getMyMonthly);
router.get('/today', attendanceController.getMyToday);

router.post('/check-in', attendanceController.checkIn);
router.post('/check-out', attendanceController.checkOut);

// ─────────────────────────────────────────────────────────────────
// ADMIN ONLY — everything below requires attendance permissions.
// ─────────────────────────────────────────────────────────────────

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

// ── Dedicated employee monthly view (admin) ──────────────────────
// MUST come before '/:id'
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