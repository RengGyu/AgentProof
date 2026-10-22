import {startAnalysisClientDiagnostic,analysisClientErrorKind} from './analysis-client-diagnostics';
/** Browser behavior is the default; the native shell supplies per-session memory and transport. */
export interface WorkspaceClient {
  /** Web PR workspace; native retains its existing analysis handoff. */
  readonly inPlacePrReports?: boolean;
  /** Native foreground signal; it never restarts analysis. */
  subscribeResume?: (listener: () => void) => () => void;
  request(path: string, init?: RequestInit): Promise<Response>;
  readonly storage: Storage;
  readonly launchStorage: Storage;
  navigate(path: string): void;
  signIn?: () => Promise<void>;
  connectRepository?: () => Promise<void>;
}

export const webWorkspaceClient: WorkspaceClient = {
  inPlacePrReports: true,
  request: async (path, init) => {
    const kind=path.startsWith('/api/dashboard/reports?id=')?'report_detail_read':path.startsWith('/api/dashboard/reports')?'report_list_read':null;
    const diagnostic=kind?startAnalysisClientDiagnostic(undefined,undefined,kind==='report_detail_read'?'report_detail':'report_list'):undefined;
    try{
      const headers=diagnostic?new Headers(init?.headers):undefined;
      headers?.set('x-agentproof-analysis-key',diagnostic!.client);
      const response=await fetch(path,headers?{...init,headers}:init);diagnostic?.headers(response);
      if(diagnostic&&kind){try{
        const json=response.json.bind(response);
        response.json=async()=>{try{const body=await json();diagnostic.record('body_parsed');diagnostic.record(kind,{status:response.status});return body;}catch(error){diagnostic.record('body_failed',{errorKind:analysisClientErrorKind(error)});throw error;}};
      }catch{/* Observation must not change a non-writable response or its outcome. */}}
      return response;
    }catch(error){diagnostic?.record(init?.signal?.aborted?'abort':'network_error',{errorKind:analysisClientErrorKind(error),aborted:init?.signal?.aborted??false});throw error;}
  },
  get storage() { return window.localStorage; },
  get launchStorage() { return window.sessionStorage; },
  navigate: path => window.location.assign(path)
};
