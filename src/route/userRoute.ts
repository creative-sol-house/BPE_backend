// routes/userRoutes.ts
import { Router } from 'express';
import * as userController from '../controller/userController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

// All routes below require a valid JWT
router.use(authenticate);

// ── Self-service (no permission needed) ──
router.get('/me', userController.getMe);
router.patch('/me', userController.updateMyProfile);

// ── Pending registrations ──
router.get('/pending', authorize('users', 'view'), userController.listPendingUsers);

// Approve pending user
// Body: { pendingUserId, roleId?, department?, permissions?, permissionMode?, isEmployee? }
// isEmployee defaults to true → Employee record auto-created with EMP-XXXXX id
router.post('/approve', authorize('users', 'add'), userController.approveUser);

router.post('/reject', authorize('users', 'delete'), userController.rejectUser);

// ── Block / unblock ──
router.patch('/:userId/block', authorize('users', 'edit'), userController.blockUser);
router.patch('/:userId/unblock', authorize('users', 'edit'), userController.unblockUser);

// ── CRUD ──
// Create user directly (bypasses registration flow)
// Body: { name, username, email, password, dob, gender, cnic, phoneNo,
//         designation, dateOfJoining, address?, profileImage?, role?, department?,
//         permissions?, permissionMode?, isEmployee? }
// isEmployee defaults to true
router.post('/', authorize('users', 'add'), userController.createUser);

// List users — supports ?status=&department=&role=&search=&isEmployee=&page=&limit=
router.get('/', authorize('users', 'view'), userController.listUsers);

router.get('/:userId', authorize('users', 'view'), userController.getUser);

// Update user
// Body may include isEmployee to toggle employee status
// (true → employee record created/revived, false → soft-deleted)
router.patch('/:userId', authorize('users', 'edit'), userController.updateUser);

router.delete('/:userId', authorize('users', 'delete'), userController.deleteUser);

export default router;