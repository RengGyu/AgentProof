// Fixed trusted compiler driver. Collected source is parsed, never evaluated.
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

let compilerDigest = null;
const unavailable = () => ({ state: "unavailable", path: null, configPath: null, compilerVersion: ts.version, compilerDigest });
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 6 * 1024 * 1024) process.exit(1);
}
try {
  const { snapshot, targets } = JSON.parse(input);
  if (ts.version !== "5.9.3" || typeof ts.matchFiles !== "function" || !Array.isArray(targets) || targets.length > 8) throw new Error();
  const files = new Map(snapshot.blobs.map(blob => [`/project/${blob.path}`, blob.content]));
  const compilerPath = createRequire(import.meta.url).resolve("typescript");
  const libDir = dirname(compilerPath);
  const libraries = new Map(readdirSync(libDir).filter(name => /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/.test(name)).sort().map(name => [`/trusted/${name}`, readFileSync(join(libDir, name), "utf8")]));
  compilerDigest = createHash("sha256").update(JSON.stringify({ node: process.version, version: ts.version, driver: readFileSync(fileURLToPath(import.meta.url), "utf8"), compiler: readFileSync(compilerPath, "utf8"), libraries: [...libraries] })).digest("hex");
  const normalize = path => posix.normalize(path);
  const readFile = path => files.get(normalize(path)) ?? libraries.get(normalize(path));
  const fileExists = path => files.has(normalize(path)) || libraries.has(normalize(path));
  const allPaths = [...files.keys(), ...libraries.keys()];
  const directoryExists = path => allPaths.some(file => file.startsWith(`${normalize(path).replace(/\/$/, "")}/`));
  function entries(path) {
    const prefix = `${normalize(path).replace(/\/$/, "")}/`;
    const children = allPaths.filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length));
    return { files: children.filter(file => !file.includes("/")), directories: [...new Set(children.filter(file => file.includes("/")).map(file => file.split("/")[0]))] };
  }
  const host = { useCaseSensitiveFileNames: true, readFile, fileExists, directoryExists, realpath: normalize,
    readDirectory: (root, extensions, excludes, includes, depth) => ts.matchFiles(root, extensions, excludes, includes, true, "/project", depth, entries, normalize),
    getCurrentDirectory: () => "/project", onUnRecoverableConfigFileDiagnostic: () => {} };
  const parsedSources = [...files].filter(([path]) => /\.(?:[cm]?ts|tsx)$/.test(path)).map(([path, content]) => ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true));
  function declarations(source, name) {
    const found = [];
    function visit(node, namespace = []) {
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name && (name.includes(".") ? [...namespace, node.name.text].join(".") : node.name.text) === name) found.push(node);
      if (ts.isSourceFile(node) || ts.isModuleBlock(node)) node.statements.forEach(statement => visit(statement, namespace));
      else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && !(node.flags & ts.NodeFlags.GlobalAugmentation) && node.body) visit(node.body, [...namespace, node.name.text]);
    }
    visit(source);
    return found;
  }
  const programs = new Map();
  function programAt(configPath) {
    if (programs.has(configPath)) return programs.get(configPath);
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
    if (!parsed || parsed.errors.length || parsed.projectReferences?.length || parsed.options.plugins?.length) { programs.set(configPath, null); return null; }
    const configFiles = [configPath, ...(parsed.options.configFile?.extendedSourceFiles ?? [])];
    if (configFiles.some(path => {
      if (!path.startsWith("/project/")) return true;
      const config = ts.readConfigFile(path, readFile);
      const bases = config.config?.extends === undefined ? [] : Array.isArray(config.config.extends) ? config.config.extends : [config.config.extends];
      return Boolean(config.error) || bases.some(base => typeof base !== "string" || !/^(?:\.\/|\.\.\/)/.test(base));
    })) { programs.set(configPath, null); return null; }
    // Diagnostics may not be suppressed into a recovery-to-any success.
    const options = { ...parsed.options, noEmit: true, noCheck: false, skipLibCheck: false, skipDefaultLibCheck: false };
    const compilerHost = { ...host, useCaseSensitiveFileNames: () => true, getCanonicalFileName: normalize, getNewLine: () => "\n", getDefaultLibFileName: options => `/trusted/${ts.getDefaultLibFileName(options)}`, getDefaultLibLocation: () => "/trusted", getDirectories: path => entries(path).directories,
      getSourceFile: (path, languageVersion) => { const text = readFile(path); return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true); }, writeFile: () => {} };
    const program = ts.createProgram({ rootNames: parsed.fileNames, options, host: compilerHost });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const checker = program.getTypeChecker();
    // JS check suppression must not conceal a missing import; native resolution
    // supplies the dependency closure independently of source diagnostic comments.
    const incomplete = program.getSourceFiles().some(source => {
      if (source.fileName.startsWith("/trusted/")) return false;
      if (!source.fileName.startsWith("/project/") || source.fileName.includes("/node_modules/")) return true;
      let recovery = false;
      function inspect(node) {
        if (ts.isTypeNode(node)) {
          const type = checker.getTypeFromTypeNode(node);
          if ((type.flags & ts.TypeFlags.Any) && type.intrinsicName !== "any") recovery = true;
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
      if (recovery) return true;
      return (source.imports ?? []).some(specifier => {
        const resolved = ts.resolveModuleName(specifier.text, source.fileName, options, compilerHost, undefined, undefined, ts.getModeForUsageLocation(source, specifier, options)).resolvedModule;
        return !resolved || resolved.isExternalLibraryImport || !resolved.resolvedFileName.startsWith("/project/") || !fileExists(resolved.resolvedFileName);
      });
    });
    const valid = !incomplete && diagnostics.length === 0 ? { program, parsed } : null;
    programs.set(configPath, valid);
    return valid;
  }
  const results = targets.map(target => {
    try {
      const candidates = parsedSources.flatMap(source => (target.path === null || source.fileName === `/project/${target.path}`) ? declarations(source, target.typeName).map(node => ({ source, node })) : []);
      // A repository-wide path-free match needs every candidate source parseable.
      if (candidates.length !== 1 || parsedSources.some(source => source.parseDiagnostics.length)) return unavailable();
      const { source } = candidates[0];
      const configPath = ts.findConfigFile(dirname(source.fileName), fileExists);
      if (!configPath?.startsWith("/project/")) return unavailable();
      const built = programAt(configPath);
      if (!built || !built.parsed.fileNames.includes(source.fileName)) return unavailable();
      const compiledSource = built.program.getSourceFile(source.fileName);
      const matches = compiledSource ? declarations(compiledSource, target.typeName) : [];
      if (matches.length !== 1 || matches[0].typeParameters?.length) return unavailable();
      const checker = built.program.getTypeChecker();
      const symbol = checker.getSymbolAtLocation(matches[0].name);
      if (!symbol) return unavailable();
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      if (type.flags & ts.TypeFlags.TypeParameter) return unavailable();
      const primitives = { string: () => checker.getStringType(), number: () => checker.getNumberType(), boolean: () => checker.getBooleanType(), bigint: () => checker.getBigIntType(), symbol: () => checker.getESSymbolType(), undefined: () => checker.getUndefinedType(), null: () => checker.getNullType() };
      const primitive = primitives[target.primitive]?.();
      if (!primitive) return unavailable();
      return { state: checker.isTypeAssignableTo(primitive, type) ? "satisfied" : "violated", path: source.fileName.slice(9), configPath: configPath.slice(9), compilerVersion: ts.version, compilerDigest };
    } catch { return unavailable(); }
  });
  process.stdout.write(JSON.stringify(results));
} catch { process.exitCode = 1; }
