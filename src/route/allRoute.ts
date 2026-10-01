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

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/employees', emprouter);
router.use('/roles', roleRoutes);
router.use('/uploads', uploadRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/holidays', holidayRoutes);
router.use('/clients', clientRouter);

export default router;