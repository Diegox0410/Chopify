export interface PlatformOwnerIdentity { uid: string; email?: string }
export type PlatformOwnerAuthorization =
  | { ok: true; status: 200; identity: PlatformOwnerIdentity }
  | { ok: false; status: 401 | 403; error: string }

export function authorizePlatformOwner(request: unknown): Promise<PlatformOwnerAuthorization>
