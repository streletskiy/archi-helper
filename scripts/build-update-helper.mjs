import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
if(process.platform!=='win32')throw new Error('The Windows update helper must be built on Windows');
const output=path.join(root,'.cache','update-helper','update-helper.exe');
await fs.mkdir(path.dirname(output),{recursive:true});
const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(compiler,['/nologo','/utf8output','/nowarn:0649','/target:winexe','/platform:x64','/optimize+','/debug-',`/out:${output}`,`/win32icon:${path.join(root,'public','icon.ico')}`,
  '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',path.join(root,'assets','update-helper.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
console.log(`Native update helper: ${(await fs.stat(output)).size} bytes`);
const runtimeHelper=path.join(root,'.cache','update-helper','runtime-helper.exe');
execFileSync(compiler,['/nologo','/utf8output','/nowarn:0649','/target:winexe','/platform:x64','/optimize+','/debug-',`/out:${runtimeHelper}`,
  '/reference:System.Web.Extensions.dll',path.join(root,'assets','runtime-helper.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
console.log(`Native runtime verifier: ${(await fs.stat(runtimeHelper)).size} bytes`);
