// routes/taskRoutes.ts
import { Router } from 'express';
import * as taskController from '../controller/taskController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const taskRouter = Router();

taskRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SELF-SERVICE ROUTES — NO authorize() — controller scopes to req.user._id
// ═════════════════════════════════════════════════════════════════════════

// My tasks (cross-project personal view; includes internal tasks)
taskRouter.get('/my', taskController.listMyTasks);

// Internal-only tasks (projectId: null)
taskRouter.get('/internal', taskController.listInternalTasks);

// ═════════════════════════════════════════════════════════════════════════
// ADMIN / STATS
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get(
  '/stats',
  authorize('tasks', 'view'),
  taskController.getTaskStats
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST — admin view (employees should call /tasks/my instead)
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get(
  '/',
  authorize('tasks', 'view'),
  taskController.listTasks
);

// ═════════════════════════════════════════════════════════════════════════
// CREATE — any authenticated user can create a task
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/', taskController.createTask);

// ═════════════════════════════════════════════════════════════════════════
// GET / UPDATE ONE — controller checks isAssignee / isAssigner / isCreator
// ═════════════════════════════════════════════════════════════════════════

taskRouter.get('/:taskId', taskController.getTask);
taskRouter.patch('/:taskId', taskController.updateTask);

// ═════════════════════════════════════════════════════════════════════════
// ASSIGNMENT — restricted to tasks:edit
// ═════════════════════════════════════════════════════════════════════════

taskRouter.patch(
  '/:taskId/assign',
  authorize('tasks', 'edit'),
  taskController.assignTask
);

// ═════════════════════════════════════════════════════════════════════════
// STATUS / TIME / ESTIMATE
// Status + time: assignee can act on their own task (controller checks)
// Estimate: restricted to tasks:edit
// ═════════════════════════════════════════════════════════════════════════

taskRouter.patch('/:taskId/status', taskController.changeTaskStatus);
taskRouter.post('/:taskId/time', taskController.logTaskTime);

taskRouter.patch(
  '/:taskId/estimate',
  authorize('tasks', 'edit'),
  taskController.changeTaskEstimate
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES
// POST — anyone assigned can add; DELETE — restricted to tasks:edit
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/:taskId/activities', taskController.addTaskActivity);

taskRouter.delete(
  '/:taskId/activities/:activityId',
  authorize('tasks', 'edit'),
  taskController.removeTaskActivity
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: COMMENTS
// POST — anyone assigned can comment; DELETE — restricted
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/:taskId/comments', taskController.addTaskComment);

taskRouter.delete(
  '/:taskId/comments/:commentId',
  authorize('tasks', 'edit'),
  taskController.removeTaskComment
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// POST — anyone assigned can attach; DELETE — restricted
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post('/:taskId/attachments', taskController.addTaskAttachment);

taskRouter.delete(
  '/:taskId/attachments/:attachmentId',
  authorize('tasks', 'edit'),
  taskController.removeTaskAttachment
);

// ═════════════════════════════════════════════════════════════════════════
// RECOMPUTE PARENT PROJECT PROGRESS
// ═════════════════════════════════════════════════════════════════════════

taskRouter.post(
  '/:taskId/recompute-progress',
  authorize('tasks', 'edit'),
  taskController.recomputeFromTask
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE
// ═════════════════════════════════════════════════════════════════════════

taskRouter.delete(
  '/:taskId',
  authorize('tasks', 'delete'),
  taskController.deleteTask
);

taskRouter.post(
  '/:taskId/restore',
  authorize('tasks', 'edit'),
  taskController.restoreTask
);

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent, main admin only)
// ═════════════════════════════════════════════════════════════════════════

taskRouter.delete('/:taskId/permanent', taskController.hardDeleteTask);

export default taskRouter;