// routes/projectRoutes.ts
import { Router } from 'express';
import * as projectController from '../controller/projectController';
import * as taskController from '../controller/taskController';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const projectRouter = Router();

projectRouter.use(authenticate);

// ═════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES FIRST (must come before /:projectId)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/stats',
  authorize('projects', 'view'),
  projectController.getProjectStats
);

projectRouter.get(
  '/internal',
  authorize('projects', 'view'),
  projectController.listInternalProjects
);

// ═════════════════════════════════════════════════════════════════════════
// GENERIC LIST / CREATE  (admin)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/',
  authorize('projects', 'view'),
  projectController.listProjects
);

projectRouter.post(
  '/',
  authorize('projects', 'add'),
  projectController.createProject
);

projectRouter.get(
  '/:projectId/tasks',
  authorize('tasks', 'view'),
  taskController.listTasksByProject
);

// ═════════════════════════════════════════════════════════════════════════
// GET ONE  (admin — self-service is /api/me/projects/:id)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/:projectId',
  authorize('projects', 'view'),
  projectController.getProject
);

// ═════════════════════════════════════════════════════════════════════════
// UPDATE / STATUS / TEAM / MILESTONE TOGGLE / RECOMPUTE
//
// These are PM-OR-ADMIN actions. The route NO LONGER uses authorize() —
// the controller enforces "admin OR projects:edit OR is-PM-of-this-project"
// via the canActOnProject() helper.
// ═════════════════════════════════════════════════════════════════════════

projectRouter.patch('/:projectId', projectController.updateProject);

projectRouter.patch(
  '/:projectId/status',
  projectController.changeProjectStatus
);

projectRouter.put('/:projectId/team', projectController.setProjectTeam);

projectRouter.patch(
  '/:projectId/milestones/:milestoneId',
  projectController.toggleProjectMilestone
);

projectRouter.post(
  '/:projectId/recompute-progress',
  projectController.recomputeProjectProgress
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: TASK CATEGORIES  (admin-only)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/task-categories',
  authorize('projects', 'edit'),
  projectController.addTaskCategory
);

projectRouter.patch(
  '/:projectId/task-categories/:categoryId',
  authorize('projects', 'edit'),
  projectController.updateTaskCategory
);

projectRouter.delete(
  '/:projectId/task-categories/:categoryId',
  authorize('projects', 'edit'),
  projectController.removeTaskCategory
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES  (admin-only)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/activities',
  authorize('projects', 'edit'),
  projectController.addProjectActivity
);

projectRouter.delete(
  '/:projectId/activities/:activityId',
  authorize('projects', 'edit'),
  projectController.removeProjectActivity
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS  (admin-only)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/attachments',
  authorize('projects', 'edit'),
  projectController.addProjectAttachment
);

projectRouter.delete(
  '/:projectId/attachments/:attachmentId',
  authorize('projects', 'edit'),
  projectController.removeProjectAttachment
);

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: MILESTONES  (add / remove = admin-only; toggle is above)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/milestones',
  authorize('projects', 'edit'),
  projectController.addProjectMilestone
);

projectRouter.delete(
  '/:projectId/milestones/:milestoneId',
  authorize('projects', 'edit'),
  projectController.removeProjectMilestone
);

// ═════════════════════════════════════════════════════════════════════════
// SOFT DELETE / RESTORE  (admin-only)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.delete(
  '/:projectId',
  authorize('projects', 'delete'),
  projectController.deleteProject
);

projectRouter.post(
  '/:projectId/restore',
  authorize('projects', 'edit'),
  projectController.restoreProject
);

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent, main admin only, must be soft-deleted first)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.delete(
  '/:projectId/permanent',
  projectController.hardDeleteProject
);

export default projectRouter;