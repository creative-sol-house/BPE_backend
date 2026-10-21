// routes/payrollRoutes.ts
import { Router } from 'express';
import * as payrollController from '../controller/payrollController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const payrollRouter = Router();

payrollRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SELF-SERVICE — no authorize() — controller scopes to req.user._id
// ═════════════════════════════════════════════════════════════════════════

// GET /api/payroll/me/payslip?year=2026&month=3
payrollRouter.get('/me/payslip', payrollController.getMyPayroll);

// ═════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═════════════════════════════════════════════════════════════════════════

// ─── Preview one employee's payroll ──────────────────────────────────────
// GET /api/payroll/preview/:employeeId?year=2026&month=3
payrollRouter.get(
  '/preview/:employeeId',
  authorize('payroll', 'view'),
  payrollController.previewPayroll
);

// ─── Batch: all employees for a month ────────────────────────────────────
// GET /api/payroll/batch?year=2026&month=3&department=&search=&page=&limit=
payrollRouter.get(
  '/batch',
  authorize('payroll', 'view'),
  payrollController.batchPayroll
);

// ─── Summary across all employees ────────────────────────────────────────
// GET /api/payroll/summary?year=2026&month=3
payrollRouter.get(
  '/summary',
  authorize('payroll', 'view'),
  payrollController.payrollSummary
);

// ─── Finalize payroll (commits loan recovery) ────────────────────────────
// POST /api/payroll/finalize/:employeeId
// Body: { year, month }
payrollRouter.post(
  '/finalize/:employeeId',
  authorize('payroll', 'edit'),
  payrollController.finalizePayroll
);

// ─── Overtime management for one employee ────────────────────────────────
// GET /api/payroll/overtime/:employeeId?year=2026&month=3&status=pending,approved
payrollRouter.get(
  '/overtime/:employeeId',
  authorize('payroll', 'view'),
  payrollController.listOvertimeForEmployee
);

// POST /api/payroll/overtime/:requestId/approve
payrollRouter.post(
  '/overtime/:requestId/approve',
  authorize('payroll', 'edit'),
  payrollController.approveOvertime
);

// POST /api/payroll/overtime/:requestId/reject
payrollRouter.post(
  '/overtime/:requestId/reject',
  authorize('payroll', 'edit'),
  payrollController.rejectOvertime
);

// POST /api/payroll/overtime/:requestId/cancel
payrollRouter.post(
  '/overtime/:requestId/cancel',
  authorize('payroll', 'edit'),
  payrollController.cancelOvertime
);

export default payrollRouter;