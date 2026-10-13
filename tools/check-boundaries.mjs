import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientRoots = ['apps/web', 'apps/extension', 'packages/editor', 'packages/contracts', 'packages/language-profiles'];
const allowedExternal = /^(?:@angular\/(?:core|common|forms|platform-browser|router|material|cdk)|rxjs|tslib|zod)(?:\/|$)|^socket\.io-client$/;
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);

function isClientFile(file) {
  const path = relative(root, file).split(sep).join('/');
  return clientRoots.some(prefix => path.startsWith(`${prefix}/`));
}

export function checkSource(file, source = readFileSync(file, 'utf8')) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const errors = [];
  function checkSpecifier(node) {
    if (!node || !ts.isStringLiteralLike(node)) {
      errors.push('Non-literal module loading is forbidden in client code');
      return;
    }
    const name = node.text;
    if (allowedExternal.test(name)) return;
    const resolved = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule;
    if (!resolved || !isClientFile(resolved.resolvedFileName)) {
      errors.push(`Client import is not allowed: ${name}`);
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) checkSpecifier(node.moduleSpecifier);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) checkSpecifier(node.moduleReference.expression);
    }
    if (ts.isImportTypeNode(node)) {
      checkSpecifier(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      checkSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return errors;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?tsx?$/.test(file) ? [file] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = clientRoots.flatMap(directory => sourceFiles(resolve(root, directory)).flatMap(file => checkSource(file).map(error => `${relative(root, file)}: ${error}`)));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.info('Client/server boundaries passed');
}
