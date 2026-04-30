import type { Severity } from '@/lib/db/schema/services';
import type { IncidentStatus } from '@/lib/db/schema/incidents';
import type {
  ServiceStatus,
  SnapshotActiveIncident,
  SnapshotDayCell,
  SnapshotService,
  StatusSnapshotPayload,
} from './payload';

const SEVERITY_TO_SERVICE_STATUS: Record<Severity, ServiceStatus> = {
  SEV1: 'major_outage',
  SEV2: 'partial_outage',
  SEV3: 'degraded',
  SEV4: 'operational',
};

const SERVICE_STATUS_RANK: Record<ServiceStatus, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

const SEVERITY_RANK: Record<Severity, number> = {
  SEV4: 0,
  SEV3: 1,
  SEV2: 2,
  SEV1: 3,
};

export interface ActiveIncidentForBuilder {
  id: string;
  severity: Severity;
  affectedServiceIds: readonly string[];
}

export function serviceStatusFromActive(
  serviceId: string,
  active: readonly ActiveIncidentForBuilder[],
): ServiceStatus {
  let worst: ServiceStatus = 'operational';
  for (const incident of active) {
    if (!incident.affectedServiceIds.includes(serviceId)) continue;
    const candidate = SEVERITY_TO_SERVICE_STATUS[incident.severity];
    if (SERVICE_STATUS_RANK[candidate] > SERVICE_STATUS_RANK[worst]) {
      worst = candidate;
    }
  }
  return worst;
}

export function worstSeverityFromIncidents(
  incidents: readonly { severity: Severity }[],
): Severity | null {
  let best: Severity | null = null;
  for (const i of incidents) {
    if (best === null || SEVERITY_RANK[i.severity] > SEVERITY_RANK[best]) {
      best = i.severity;
    }
  }
  return best;
}

export interface BuildSnapshotInput {
  services: ReadonlyArray<{
    id: string;
    slug: string;
    name: string;
    teamId: string;
    uptime30d: number;
  }>;
  activeIncidents: ReadonlyArray<{
    slug: string;
    title: string;
    severity: Severity;
    status: IncidentStatus;
    declaredAt: Date;
    affectedServiceIds: readonly string[];
    latestPublicUpdate?: {
      body: string;
      postedAt: Date;
      author?: string | null;
    };
  }>;
  severityByDay: ReadonlyArray<SnapshotDayCell>;
}

export function buildPublicSnapshot(input: BuildSnapshotInput): StatusSnapshotPayload {
  const services: SnapshotService[] = input.services.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    teamId: s.teamId,
    status: serviceStatusFromActive(
      s.id,
      input.activeIncidents.map((i) => ({
        id: i.slug,
        severity: i.severity,
        affectedServiceIds: i.affectedServiceIds,
      })),
    ),
    uptime30d: s.uptime30d,
  }));

  const activeIncidents: SnapshotActiveIncident[] = input.activeIncidents.map((i) => ({
    slug: i.slug,
    title: i.title,
    severity: i.severity,
    status: i.status,
    declaredAt: i.declaredAt,
    ...(i.latestPublicUpdate
      ? {
          latestPublicUpdate: {
            body: i.latestPublicUpdate.body,
            postedAt: i.latestPublicUpdate.postedAt,
            author: i.latestPublicUpdate.author ?? null,
          },
        }
      : {}),
  }));

  return {
    services,
    activeIncidents,
    severityByDay: [...input.severityByDay],
  };
}

export function buildTeamSnapshot(
  teamId: string,
  input: BuildSnapshotInput,
): StatusSnapshotPayload {
  const teamServices = input.services.filter((s) => s.teamId === teamId);
  const teamServiceIds = new Set(teamServices.map((s) => s.id));
  const teamIncidents = input.activeIncidents.filter((i) =>
    i.affectedServiceIds.some((sid) => teamServiceIds.has(sid)),
  );
  return buildPublicSnapshot({
    services: teamServices,
    activeIncidents: teamIncidents,
    severityByDay: input.severityByDay,
  });
}
