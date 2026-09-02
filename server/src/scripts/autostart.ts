import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Starts the Brotomap server with Windows, without a terminal.
 *
 * The extension needs the server, because the AI key must not live inside a
 * browser extension. But "keep a terminal open forever" is not a way to use
 * software, and a console window on every login is not much better.
 *
 * So: a tiny launcher in the Startup folder that runs the server hidden. No
 * service to install, no dependency to add, and removing it is deleting one
 * file - which the same command will do.
 */

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

function startupFolder(): string {
  const appData = process.env['APPDATA'];

  if (appData === undefined) {
    throw new Error('APPDATA is not set: this command is for Windows.');
  }

  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

const launcher = (): string => join(startupFolder(), 'brotomap-server.vbs');

/**
 * VBScript wants a Windows path, and Node hands back a mixture of separators.
 * Built from a character code so the source itself stays free of the escaping
 * that makes this kind of line hard to read and easy to break.
 */
function windowsPath(path: string): string {
  const separator = String.fromCharCode(92);
  const parts = path.split('/').join(separator).split(separator).filter(Boolean);
  return parts.join(separator);
}

/**
 * VBScript rather than a .bat, for one reason: the third argument to Run is
 * "window style", and 0 means no window at all. A .bat leaves a console open
 * for as long as the server runs.
 */
function script(): string {
  return [
    "' Starts the Brotomap server hidden when Windows starts.",
    "' Created by: npm run autostart. Remove with: npm run autostart:remove",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${windowsPath(projectRoot)}"`,
    'shell.Run "cmd /c npm run server", 0, False',
    '',
  ].join('\r\n');
}

function install(): void {
  const folder = startupFolder();

  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
  }

  writeFileSync(launcher(), script(), 'utf8');

  console.log('\nBrotomap will now start with Windows.\n');
  console.log(`  launcher : ${launcher()}`);
  console.log(`  project  : ${projectRoot}`);
  console.log('\nIt runs hidden - no window. To start it now without restarting:');
  console.log('  npm run server\n');
  console.log('To undo:  npm run autostart:remove\n');
}

function remove(): void {
  const file = launcher();

  if (!existsSync(file)) {
    console.log('\nNothing to remove: Brotomap was not set to start with Windows.\n');
    return;
  }

  rmSync(file);
  console.log('\nBrotomap will no longer start with Windows.');
  console.log('Anything already running stays running until you close it or restart.\n');
}

if (process.argv.includes('--remove')) {
  remove();
} else {
  install();
}
