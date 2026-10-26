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
// SELF-SERVICE: MY PROJECTS  (authenticated only — no permission needed)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get('/my-projects', projectController.listMyProjects);

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

// ═════════════════════════════════════════════════════════════════════════
// TASKS BY PROJECT  (authenticated only — controller enforces access)
// ═════════════════════════════════════════════════════════════════════════

projectRouter.get(
  '/:projectId/tasks',
  taskController.listTasksByProject
);

projectRouter.post(
  '/:projectId/tasks',
  taskController.createTask
);

projectRouter.patch(
  '/:projectId/tasks/:taskId',
  taskController.updateTask
);

projectRouter.delete(
  '/:projectId/tasks/:taskId',
  taskController.deleteTask
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
// SUB-RESOURCE: MILESTONES  (add / remove = authenticated only;
// toggle is above)
//
// These routes rely on canActOnProject() inside the controller to enforce
// "admin OR projects:edit OR is-PM-of-this-project".
// ═════════════════════════════════════════════════════════════════════════

projectRouter.post(
  '/:projectId/milestones',
  projectController.addProjectMilestone
);

projectRouter.delete(
  '/:projectId/milestones/:milestoneId',
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