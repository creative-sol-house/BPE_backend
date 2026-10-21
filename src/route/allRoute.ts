// routes/allRoutes.ts
import { Router } from 'express';
import authRoutes from './authRoute';
import userRoutes from './userRoute';
import roleRoutes from './roleRoute';
import uploadRoutes from './uploadRoute';
import emprouter from './employeeRoute';
import attendanceRoutes from './attendanceRoute';
import holidayRoutes from './holidayRoute';
import clientRouter from './clientRoute';
import leadRouter from './leadRoute';
import serviceRouter from './serviceRoute';
import projectRouter from './projectRoute';
import taskRouter from './taskRoute';
import leaveRoutes from './leaveRoute';
import requestRoutes from './requestRoute';
import loanRoute from './loanRoute';
import payrollRouter from './payrollRoute';
import providerRoutes from './providerRoute';
import proposalRouter from './proposalRoute';
import accountingRouter from './accounting';
import reportRoutes from './reportRoute';
import employeeBankAccountRoutes from './employeeBankAccountRoutes';
import meRoute from './meRoute';

const router = Router();

// ─── Auth & Users ──────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/uploads', uploadRoutes);
router.use('/me', meRoute);

// ─── HR / Employees ────────────────────────────────────────────────────
router.use('/employees', emprouter);
router.use('/attendance', attendanceRoutes);
router.use('/holidays', holidayRoutes);
router.use('/leaves', leaveRoutes);
router.use('/requests', requestRoutes);
router.use('/loans', loanRoute);
router.use('/payroll', payrollRouter);

// ─── CRM / Sales ───────────────────────────────────────────────────────
router.use('/clients', clientRouter);
router.use('/leads', leadRouter);
router.use('/proposals', proposalRouter);
router.use('/services', serviceRouter);

// ─── Project Management ────────────────────────────────────────────────
router.use('/projects', projectRouter);
router.use('/tasks', taskRouter);

// ─── Procurement / Providers ───────────────────────────────────────────
router.use('/providers', providerRoutes);

// ─── Accounting ────────────────────────────────────────────────────────
router.use('/accounting', accountingRouter);
router.use('/reports', reportRoutes);

// ─── Employee Bank Accounts ──────────────────────────────────────────
router.use('/', employeeBankAccountRoutes);

export default router;