import { readFileSync, openSync, closeSync } from 'node:fs';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';

// Trusted bridge: nothing from Node is installed in the guest realm.
const status = readFileSync('/proc/self/status', 'utf8');
const field = (name) => status.match(new RegExp(`^${name}:\\s*(\\S+)`, 'm'))?.[1];
let parentChannelsBlocked = true;
for (const fd of [0, 1]) {
  try { closeSync(openSync(`/proc/${process.ppid}/fd/${fd}`, 'r+')); parentChannelsBlocked = false; }
  catch (error) { if (error.code !== 'EACCES' && error.code !== 'EPERM') parentChannelsBlocked = false; }
}
try { process.kill(process.ppid, 0); parentChannelsBlocked = false; }
catch (error) { if (error.code !== 'EPERM') parentChannelsBlocked = false; }
const isolation = { targetUid: process.getuid(), targetGid: process.getgid(), capEff: field('CapEff'), capPrm: field('CapPrm'), noNewPrivs: field('NoNewPrivs'), parentChannelsBlocked };
if (isolation.targetUid !== 10001 || isolation.targetGid !== 10001 || isolation.capEff !== '0000000000000000' ||
  isolation.capPrm !== '0000000000000000' || isolation.noNewPrivs !== '1' || !parentChannelsBlocked) process.exit(2);
const sourcePacket = [];
let inputBytes = 0;
for await (const chunk of process.stdin) {
  inputBytes += chunk.length;
  if (inputBytes > 64 * 1024 + 4096) process.exit(2);
  sourcePacket.push(chunk);
}
const payload = JSON.parse(Buffer.concat(sourcePacket).toString('utf8'));
const module = await newQuickJSWASMModuleFromVariant(variant);
const runtime = module.newRuntime();
runtime.setMemoryLimit(32 * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
const deadline = Date.now() + 1000;
runtime.setInterruptHandler(() => Date.now() > deadline);
runtime.removeModuleLoader();
const context = runtime.newContext();
const handles = [];
const keep = (result) => {
  if (result.error) { result.error.dispose(); throw new Error('unavailable'); }
  handles.push(result.value);
  return result.value;
};
try {
  // Private handle created before the guest. The typeof operator cannot coerce
  // an object, call a getter, or be replaced by guest mutations of globals.
  const typeOf = keep(context.evalCode('(value) => typeof value', 'observer', { type: 'global' }));
  const stringLength = keep(context.evalCode('(value) => value.length', 'observer', { type: 'global' }));
  const charCodeAt = keep(context.evalCode('String.prototype.charCodeAt', 'observer', { type: 'global' }));
  const functionSource = keep(context.evalCode('Function.prototype.toString', 'observer', { type: 'global' }));
  const evaluatedSource = keep(context.evalCode(payload.source, payload.modulePath, { type: payload.sourceType === 'module' ? 'module' : 'global' }));
  let fn;
  if (payload.sourceType === 'module') {
    // Native promise inspection does not call guest .then or object coercion.
    // Never unwrap/drain unfinished module evaluation or trust a Promise property
    // as if it belonged to a module namespace.
    const state = context.getPromiseState(evaluatedSource);
    if (!state.notAPromise) {
      if (state.type === 'fulfilled') handles.push(state.value);
      if (state.type === 'rejected') handles.push(state.error);
      throw new Error('unavailable');
    }
    fn = context.getProp(evaluatedSource, payload.exportName);
    handles.push(fn);
  } else fn = keep(context.evalCode(payload.functionName, 'target-binding', { type: 'global' }));
  const fnType = keep(context.callFunction(typeOf, context.undefined, fn));
  if (context.getString(fnType) !== 'function' || runtime.hasPendingJob()) throw new Error('unavailable');
  // A mutable export must not replace its owned declaration with a builtin,
  // bound function, or callable proxy. Use the captured intrinsic, not fn.toString.
  const fnSource = keep(context.callFunction(functionSource, fn));
  if (/^\s*function\b[^{}]*\{\s*\[native code\]\s*\}\s*$/.test(context.getString(fnSource))) throw new Error('unavailable');
  const args = [];
  if (payload.hasInput) {
    const value = payload.input;
    if (typeof value === 'string') args.push(keep(context.evalCode(JSON.stringify(value), 'scalar-input', { type: 'global' })));
    else if (typeof value === 'number') { const handle = context.newNumber(value); handles.push(handle); args.push(handle); }
    else if (value === null) args.push(context.null);
    else if (value === true) args.push(context.true);
    else if (value === false) args.push(context.false);
    else throw new Error('unavailable');
  }
  const actualHandle = keep(context.callFunction(fn, context.undefined, ...args));
  if (runtime.hasPendingJob()) throw new Error('unavailable');
  const typeHandle = keep(context.callFunction(typeOf, context.undefined, actualHandle));
  const type = context.getString(typeHandle);
  let actual;
  if (type === 'number') {
    actual = context.getNumber(actualHandle);
    if (!Number.isFinite(actual) || Object.is(actual, -0)) throw new Error('unavailable');
  } else if (type === 'string') {
    const lengthHandle = keep(context.callFunction(stringLength, context.undefined, actualHandle));
    const length = context.getNumber(lengthHandle);
    if (!Number.isInteger(length) || length < 0 || length > 200) throw new Error('unavailable');
    actual = '';
    for (let index = 0; index < length; index++) {
      const indexHandle = context.newNumber(index);
      handles.push(indexHandle);
      const codeHandle = keep(context.callFunction(charCodeAt, actualHandle, indexHandle));
      actual += String.fromCharCode(context.getNumber(codeHandle));
    }
  } else if (type === 'boolean') actual = context.sameValue(actualHandle, context.true);
  else if (type === 'object' && context.sameValue(actualHandle, context.null)) actual = null;
  else throw new Error('unavailable');
  process.stdout.write(JSON.stringify({ kind: 'returned', actual, isolation, nodeVersion: process.version, quickjsVersion: '0.32.0' }));
} catch {
  process.exitCode = 2;
} finally {
  for (const handle of handles.reverse()) handle.dispose();
  context.dispose();
  runtime.dispose();
}
