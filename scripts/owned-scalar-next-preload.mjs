// Fixed owned transport fixtures for the local Next integration test only.
globalThis.fetch = async (value) => {
  const url = String(value);
  if (url === 'https://api.github.com/repos/owned/scalar/pulls/12') return Response.json({ title: 'Owned scalar', body: 'Owned implementation', base: { ref: 'main', sha: 'b'.repeat(40), repo: { private: false } }, head: { ref: 'scalar', sha: 'a'.repeat(40) } });
  if (url.startsWith('https://api.github.com/repos/owned/scalar/pulls/12/files?')) return Response.json([{ filename: 'src/owned.js', status: 'modified', patch: '+ owned fixture' }]);
  if (url === `https://api.github.com/repos/owned/scalar/commits/${'a'.repeat(40)}/check-runs`) return Response.json({}, { status: 503 });
  if (url === `https://api.github.com/repos/owned/scalar/commits/${'a'.repeat(40)}/status`) return Response.json({ statuses: [] });
  if (url === `https://api.github.com/repos/owned/scalar/contents/src/owned.js?ref=${'a'.repeat(40)}`) return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from('function answer() { return 42; }').toString('base64') });
  throw new Error('Unrecognized owned test transport');
};
