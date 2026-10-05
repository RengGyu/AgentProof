import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PullRequestBrowser, RepositoryCommitBrowser } from "./RepositoryCommitBrowser";
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => void>, localReports: [] as any[] }));
vi.mock("@/lib/report-history", () => ({ readReportHistory: () => hooks.localReports }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState(initial: any) {
    const index=hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index]=initial;
    return [hooks.slots[index],(value:any)=>{hooks.slots[index]=typeof value==="function"?value(hooks.slots[index]):value;}];
  },
  useRef(initial: any) {
    const index=hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index]={current:initial};
    return hooks.slots[index];
  },
  useEffect(work:()=>void|(()=>void),deps:unknown[]) {
    const index=hooks.index++, previous=hooks.slots[index];
    if (!previous || deps.some((value,i)=>value!==previous.deps[i])) {
      hooks.effects.push(()=>{previous?.cleanup?.();hooks.slots[index]={deps,cleanup:work()};});
    }
  }
}));
let tree:any;
let runtime: any;
let fetchMock:ReturnType<typeof vi.fn>;
const sha="a".repeat(40), older="b".repeat(40);
function render() {hooks.index=0;tree=PullRequestBrowser({repositoryId:100,repositoryFullName:"owner/repo", ...(runtime ? { runtime } : {})});hooks.effects.splice(0).forEach(work=>work());}
async function settle() {for(let i=0;i<12;i++)await Promise.resolve();render();}
function nodes(value:any=tree):any[] {return Array.isArray(value)?value.flatMap(item=>nodes(item)):value?.props?[value,...(value.props.children===undefined?[]:nodes(value.props.children))]:[];}
function text(value:any=tree):string {return Array.isArray(value)?value.map(item=>text(item)).join(" "):value?.props?(value.props.children===undefined?"":text(value.props.children)):typeof value==="string"?value:"";}
function select(label:string,value:string) {nodes().find(n=>n.props["aria-label"]===label).props.onChange({target:{value}});render();}
beforeEach(()=>{
  runtime=undefined;hooks.slots=[];hooks.index=0;hooks.effects=[];hooks.localReports=[];
  vi.stubGlobal("window",{location:{assign:vi.fn()},sessionStorage:{setItem:vi.fn()},localStorage:{getItem:vi.fn()}});
  vi.stubGlobal("crypto",{randomUUID:()=>"11111111-1111-4111-8111-111111111111"});
  fetchMock=vi.fn().mockResolvedValue(Response.json({pullRequests:[{number:12,title:"Change",state:"open",headSha:sha},{number:13,title:"Other",state:"closed",headSha:older}]}));
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>{hooks.slots.forEach(s=>s?.cleanup?.());vi.unstubAllGlobals();});
it("opens the selected full SHA and removes old links immediately when the PR changes",async()=>{
  render();await settle();
  fetchMock.mockResolvedValueOnce(Response.json({commits:[{sha,message:"Head",url:`https://github.com/owner/repo/commit/${sha}`},{sha:older,message:"Old",url:`https://github.com/owner/repo/commit/${older}`}]}));
  select("Recent pull request","12");await settle();
  select("Commit to open",older);
  expect(nodes().find(n=>n.type==="a").props.href).toBe(`https://github.com/owner/repo/commit/${older}`);
  fetchMock.mockImplementationOnce(()=>new Promise(()=>{}));
  select("Recent pull request","13");
  expect(nodes().filter(n=>n.type==="a")).toHaveLength(0);
});
it("ignores late responses from an earlier PR selection",async()=>{
  render();await settle();
  let resolveOld!:(response:Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  select("Recent pull request","12");
  fetchMock.mockResolvedValueOnce(Response.json({commits:[]}));
  select("Recent pull request","13");await settle();
  resolveOld(Response.json({commits:[{sha,message:"STALE",url:"old"}]}));await settle();
  expect(text()).toContain("No commits found");
  expect(text()).not.toContain("STALE");
});
it("shows empty and error states and allows retry",async()=>{
  fetchMock.mockReset().mockResolvedValueOnce(Response.json([],{status:503}));
  render();await settle();expect(text()).toContain("Could not load");
  fetchMock.mockResolvedValueOnce(Response.json({pullRequests:[]}));
  nodes().find(n=>n.type==="button").props.onClick();render();await settle();
  expect(text()).toContain("No pull requests found");
});
it("includes connected analysis-off repositories and excludes disabled connections",()=>{
  tree=RepositoryCommitBrowser({repositories:[{repositoryId:1,repositoryFullName:"owner/off",enabled:true,analysisEnabled:false},{repositoryId:2,repositoryFullName:"owner/disabled",enabled:false}] as any});
  expect(text()).toContain("owner/off");expect(text()).not.toContain("owner/disabled");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("starts one current-head PR analysis from the selected live PR, never a selected historical commit",async()=>{
  render();await settle();
  fetchMock.mockResolvedValueOnce(Response.json({analysisPrUrl:"https://github.com/owner/repo/pull/12",headSha:sha,commits:[{sha:older,message:"Old",url:`https://github.com/owner/repo/commit/${older}` }]}));
  select("Recent pull request","12");await settle();
  select("Commit to open",older);
  const action=nodes().find(n=>n.type==="button"&&text(n).includes("Analyze current PR head"));
  expect(action).toBeDefined();
  action.props.onClick();action.props.onClick();
  expect(window.location.assign).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.setItem).toHaveBeenCalledWith("agentproof.pendingAnalysis.v1",JSON.stringify({nonce:"11111111-1111-4111-8111-111111111111",prUrl:"https://github.com/owner/repo/pull/12",listedHeadSha:sha}));
  expect(window.location.assign).toHaveBeenCalledWith("/analyze?launch=11111111-1111-4111-8111-111111111111");
});
it("hides the old PR analysis action while another PR is loading",async()=>{
  render();await settle();
  fetchMock.mockResolvedValueOnce(Response.json({analysisPrUrl:"https://github.com/owner/repo/pull/12",headSha:sha,commits:[]}));
  select("Recent pull request","12");await settle();
  expect(nodes().some(n=>n.type==="button"&&text(n).includes("Analyze current PR head"))).toBe(true);
  fetchMock.mockImplementationOnce(()=>new Promise(()=>{}));
  select("Recent pull request","13");
  expect(nodes().some(n=>n.type==="button"&&text(n).includes("Analyze current PR head"))).toBe(false);
});
it("marks only a matching current-head local summary with its saved time", async()=>{
  hooks.localReports=[{id:"local-12",savedAt:"2026-09-30T01:00:00.000Z",report:{source:{url:"https://github.com/owner/repo/pull/12",provenance:{origin:"github_snapshot",headSha:sha}}}}];
  render();await settle();
  expect(text(nodes().find(n=>n.type==="option"&&n.props.value===12))).toContain("Local summary");
  expect(text(nodes().find(n=>n.type==="option"&&n.props.value===13))).not.toContain("Local summary");
  fetchMock.mockResolvedValueOnce(Response.json({analysisPrUrl:"https://github.com/owner/repo/pull/12",headSha:sha,commits:[]}));
  select("Recent pull request","12");await settle();
  expect(text()).toContain("Local summary saved");
  expect(text()).toContain("2026");
  expect(nodes().find(n=>n.props["aria-label"]==="Local summary available")).toBeDefined();
});
it("does not mark a summary from another PR head as current",async()=>{
  hooks.localReports=[{id:"old",savedAt:"2026-09-30T01:00:00.000Z",report:{source:{url:"https://github.com/owner/repo/pull/12",provenance:{origin:"github_snapshot",headSha:older}}}}];
  render();await settle();
  expect(text(nodes().find(n=>n.type==="option"&&n.props.value===12))).not.toContain("Local summary");
  fetchMock.mockResolvedValueOnce(Response.json({analysisPrUrl:"https://github.com/owner/repo/pull/12",headSha:sha,commits:[]}));
  select("Recent pull request","12");await settle();
  expect(text()).not.toContain("Local summary saved");
});

it("uses the supplied native request, memory launch storage and local navigation for PR analysis", async () => {
  const memory = new Map<string,string>();
  const navigations: string[] = [];
  runtime = {
    request: async (path: string) => Response.json(path.includes("pullRequestNumber=")
      ? { analysisPrUrl: "https://github.com/owner/repo/pull/88", headSha: sha, commits: [] }
      : { pullRequests: [{number:88,title:"Native account PR",state:"open",headSha:sha}] }),
    storage: window.localStorage,
    launchStorage: {getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)},
    navigate: (path:string)=>navigations.push(path)
  };
  render(); await settle();
  expect(text()).toContain("Native account PR");
  select("Recent pull request","88"); await settle();
  nodes().find(n=>n.type==="button"&&text(n).includes("Analyze current PR head")).props.onClick();
  expect(JSON.parse(memory.get("agentproof.pendingAnalysis.v1")!)).toMatchObject({prUrl:"https://github.com/owner/repo/pull/88",listedHeadSha:sha});
  expect(navigations).toEqual(["/analyze?launch=11111111-1111-4111-8111-111111111111"]);
  expect(window.location.assign).not.toHaveBeenCalled();
  expect(window.sessionStorage.setItem).not.toHaveBeenCalled();
});
