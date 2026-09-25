#!/usr/bin/env node
'use strict';

/*
 * Creates the distributable file:// edition without a bundler or a runtime
 * dependency.  The source page remains the canonical Pages edition: this
 * script only replaces its local stylesheet and classic scripts with inline
 * equivalents after the document body, preserving their original defer-like
 * execution order.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = {
  html: path.join(root, 'index.html'),
  css: path.join(root, 'assets', 'style.css'),
  authCss: path.join(root, 'assets', 'auth-flow.css'),
  templates: path.join(root, 'assets', 'script-template.js'),
  app: path.join(root, 'assets', 'app.js'),
  output: path.join(root, 'dist', 'JavaIDEA自检工具-离线版.html')
};

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function replaceExactly(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(label + ' must occur exactly once in index.html; found ' + count + '.');
  }
  return source.replace(needle, replacement);
}

function inlineScript(source) {
  // Keep an accidental literal closing script tag from ending the wrapper.
  return source.replace(/<\/script/gi, '<\\/script');
}

function build() {
  const css = read(files.css) + '\n' + read(files.authCss);
  const templates = read(files.templates);
  const app = read(files.app);
  let html = read(files.html);

  const cspPattern = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/i;
  if (!cspPattern.test(html)) {
    throw new Error('index.html is missing its Content-Security-Policy meta tag.');
  }
  html = html.replace(
    cspPattern,
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
  );

  html = replaceExactly(
    html,
    '<link rel="stylesheet" href="assets/style.css">',
    '<style data-offline-inline="style">\n' + css + '\n</style>',
    'The stylesheet link'
  );
  html = replaceExactly(html, '<link rel="stylesheet" href="assets/auth-flow.css">', '', 'The authentication stylesheet link');

  html = replaceExactly(
    html,
    '<script src="assets/script-template.js" defer></script>',
    '',
    'The script-template.js script tag'
  );
  html = replaceExactly(
    html,
    '<script src="assets/app.js" defer></script>',
    '',
    'The app.js script tag'
  );
  // Removing indented external tags can leave whitespace-only lines. Keep the
  // checked-in distributable clean so git diff --check remains useful.
  html = html.replace(/^[\t ]+\r?\n/gm, '');

  const scripts = [
    '<script data-offline-inline="script-template">\n' + inlineScript(templates) + '\n</script>',
    '<script data-offline-inline="app">\n' + inlineScript(app) + '\n</script>'
  ].join('\n');
  html = replaceExactly(html, '</body>', scripts + '\n</body>', 'The closing body tag');

  validateOfflineHtml(html);
  return html;
}

function validateOfflineHtml(html) {
  if (!/script-src 'unsafe-inline'/.test(html) || !/style-src 'unsafe-inline'/.test(html)) {
    throw new Error('Offline CSP must permit the generated inline script and style tags.');
  }
  if (!/connect-src 'none'/.test(html)) {
    throw new Error('Offline CSP must keep connect-src none.');
  }
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) {
    throw new Error('Offline edition must not retain external script tags.');
  }
  if (/<link\b[^>]*\brel=["']stylesheet["']/i.test(html)) {
    throw new Error('Offline edition must not retain external stylesheet links.');
  }
  if (!/<style data-offline-inline="style">/.test(html) || !/<script data-offline-inline="app">/.test(html)) {
    throw new Error('Offline inline assets were not emitted.');
  }
}

function main() {
  const output = build();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(files.output)) {
      throw new Error('Offline distribution is missing. Run node tools/build-offline.js first.');
    }
    if (read(files.output) !== output) {
      throw new Error('Offline distribution is stale. Run node tools/build-offline.js again.');
    }
    process.stdout.write('Offline distribution is current: ' + path.relative(root, files.output) + '\n');
    return;
  }

  fs.mkdirSync(path.dirname(files.output), { recursive: true });
  fs.writeFileSync(files.output, output, 'utf8');
  process.stdout.write('Built ' + path.relative(root, files.output) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write('Offline build failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { build, validateOfflineHtml };
