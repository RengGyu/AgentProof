/** Browser behavior is the default; the native shell supplies per-session memory and transport. */
export interface WorkspaceClient {
  /** Web PR workspace; native retains its existing analysis handoff. */
  readonly inPlacePrReports?: boolean;
  request(path: string, init?: RequestInit): Promise<Response>;
  readonly storage: Storage;
  readonly launchStorage: Storage;
  navigate(path: string): void;
  signIn?: () => Promise<void>;
  connectRepository?: () => Promise<void>;
}

export const webWorkspaceClient: WorkspaceClient = {
  inPlacePrReports: true,
  request: (path, init) => fetch(path, init),
  get storage() { return window.localStorage; },
  get launchStorage() { return window.sessionStorage; },
  navigate: path => window.location.assign(path)
};
