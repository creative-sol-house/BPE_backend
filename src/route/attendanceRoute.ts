// route/attendanceRoute.ts
import { Router } from 'express';
import * as attendanceController from '../controller/attendanceController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate);

// ── Self-service ─────────────────────────────────────────────────
router.get('/me',    attendanceController.getMyAttendance);
router.get('/today', attendanceController.getMyToday);

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