import { describe, expect, it } from 'vitest';
import { readAnalyzeResponse } from './analyze-response';

describe('public analysis response handling', () => {
  it.each([429, 503, 504])('gives safe retry guidance for non-JSON upstream status %s', async status => {
    const result = await readAnalyzeResponse(new Response('<html>INTERNAL_SECRET</html>', {status}));
    expect(result.report).toBeUndefined();
    expect(result.error).toContain(status===429?'Too many requests':'temporarily unavailable');
    expect(result.hint).toContain('retry');
    expect(JSON.stringify(result)).not.toContain('INTERNAL_SECRET');
  });
  it('asks users to correct invalid input instead of waiting for a rate limit', async () => {
    const result=await readAnalyzeResponse(Response.json({error:'PR URL is invalid.'},{status:400}));
    expect(result.hint).toContain('Check the input');
    expect(result.hint).not.toContain('Wait');
  });
  it('retains bounded GitHub permission guidance and never treats an error report as success', async () => {
    const result = await readAnalyzeResponse(Response.json({error:'GitHub access unavailable.', hint:'Check access.', guidance:['Check access.', 'Reconnect the GitHub App.', 5], report:{source:'untrusted'}}, {status:400}));
    expect(result).toEqual({error:'GitHub access unavailable.', hint:'Check access.', guidance:['Reconnect the GitHub App.']});
  });
  it('rejects a malformed successful response without displaying the response body', async () => {
    const result=await readAnalyzeResponse(new Response('RAW_PRIVATE_BODY',{status:200}));
    expect(result.error).toBe('Analysis response did not include a report.');
    expect(JSON.stringify(result)).not.toContain('RAW_PRIVATE_BODY');
  });
  it('returns a successful report without operator diagnostics', async () => {
    const report={source:{title:'Fixture'}};
    expect(await readAnalyzeResponse(Response.json({report,operatorNavigationDiagnostics:[{private:'INTERNAL'}]}))).toEqual({report});
  });
});

it('exposes a login action only for the explicit authentication error', async () => {
  expect(await readAnalyzeResponse(Response.json({error:'Sign in',code:'github_login_required'},{status:401}))).toMatchObject({loginRequired:true});
  expect(await readAnalyzeResponse(Response.json({error:'Reconnect',code:'github_reauth_required'},{status:401}))).toMatchObject({loginRequired:true});
  expect((await readAnalyzeResponse(Response.json({error:'Other',code:'github_login_required'},{status:500}))).loginRequired).toBeUndefined();
});

it('exposes installation and connection actions only for their explicit codes', async () => {
  expect(await readAnalyzeResponse(Response.json({error:'Install',code:'github_install_required'},{status:409}))).toMatchObject({installRequired:true});
  expect(await readAnalyzeResponse(Response.json({error:'Reconnect',code:'github_connection_required'},{status:409}))).toMatchObject({connectionRequired:true});
});
