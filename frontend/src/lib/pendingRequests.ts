import { listMyRequests, type RequestItem } from '../api/requests';

// "Is a request already waiting on this?" lookup keys — one per target,
// mirroring the backend's one-pending-request-per-target unique indexes.
export const pendingKey = {
  project: (projectId: string) => `project:${projectId}`,
  environment: (environmentId: string) => `environment:${environmentId}`,
  component: (environmentId: string, componentId: string) => `component:${environmentId}:${componentId}`,
  variable: (environmentId: string, componentId: string, key: string) =>
    `variable:${environmentId}:${componentId}:${key}`,
  rollback: (environmentId: string, componentId: string, key: string | null) =>
    `rollback:${environmentId}:${componentId}:${key ?? ''}`,
};

// Only for Members — Admins act directly and never file requests.
export const fetchMyPendingKeys = (): Promise<Set<string>> => listMyRequests().then(toPendingKeys);

function toPendingKeys(requests: RequestItem[]): Set<string> {
  const keys = new Set<string>();
  for (const request of requests) {
    if (request.status !== 'pending') continue;
    const { projectId, environmentId, projectComponentId, key } = request;
    if (request.kind === 'rollback') {
      if (environmentId && projectComponentId) keys.add(pendingKey.rollback(environmentId, projectComponentId, key));
    } else if (request.targetType === 'project' && projectId) {
      keys.add(pendingKey.project(projectId));
    } else if (request.targetType === 'environment' && environmentId) {
      keys.add(pendingKey.environment(environmentId));
    } else if (request.targetType === 'component' && environmentId && projectComponentId) {
      keys.add(pendingKey.component(environmentId, projectComponentId));
    } else if (request.targetType === 'variable' && environmentId && projectComponentId && key) {
      keys.add(pendingKey.variable(environmentId, projectComponentId, key));
    }
  }
  return keys;
}
