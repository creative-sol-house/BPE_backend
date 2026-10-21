import { Router } from 'express';
import * as me from '../controller/meController';
import * as payroll from '../controller/payrollController';
import * as task from '../controller/taskController';
import * as attendance from '../controller/attendanceController';
import * as request from '../controller/requestController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// ── Aggregate dashboard ──────────────────────────────────────────────
router.get('/', me.getDashboard);

// ── Profile ──────────────────────────────────────────────────────────
router.get('/profile', me.getMyProfile);
router.patch('/profile', me.updateMyProfile);

// ── Attendance ────────────────────────────────────────────────────────
router.get('/attendance', me.getMyAttendance);
router.get('/attendance/today', attendance.getMyToday);
router.post('/attendance/check-in', attendance.checkIn);
router.post('/attendance/check-out', attendance.checkOut);

// ── Requests ──────────────────────────────────────────────────────────
router.get('/requests', me.getMyRequests);
router.post('/requests', request.submitRequest);
router.patch('/requests/:requestId', request.editRequest);
router.post('/requests/:requestId/cancel', request.cancelRequest);
router.post('/requests/:requestId/comments', request.addComment);

// ── Leave balance ─────────────────────────────────────────────────────
router.get('/leave-balance', me.getMyLeaveBalance);

// ── Loans ─────────────────────────────────────────────────────────────
router.get('/loans', me.getMyLoans);

// ── Payslip ───────────────────────────────────────────────────────────
router.get('/payslip', payroll.getMyPayroll);

// ── Bank accounts ─────────────────────────────────────────────────────
router.get('/bank-accounts', me.getMyBankAccounts);

// ── Projects (self-service — own only) ────────────────────────────────
// NOTE: /projects/:projectId MUST come after /projects
router.get('/projects', me.getMyProjectsSelf);
router.get('/projects/:projectId', me.getMyProjectDetail);

// ── Tasks ─────────────────────────────────────────────────────────────
router.get('/tasks', me.getMyTasks);
router.get('/tasks/:taskId', task.getTask);
router.patch('/tasks/:taskId/status', task.changeTaskStatus);
router.post('/tasks/:taskId/time', task.logTaskTime);
router.post('/tasks/:taskId/comments', task.addTaskComment);

// ── Stats ─────────────────────────────────────────────────────────────
router.get('/stats', me.getMyStats);

export default router;