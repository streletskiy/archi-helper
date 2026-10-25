import {build,Platform,Arch} from 'electron-builder';

// Each target needs its own app directory: NSIS carries a reusable runtime
// archive, whereas portable carries the immediately usable Python directory.
for(const target of ['nsis','portable']) {
  // Portable uses the same legacy Nsis7z decoder. Restrict its executable
  // filter so the archive cannot contain the unsupported ARM64 codec.
  if(target==='portable')process.env.ELECTRON_BUILDER_7Z_FILTER='BCJ';
  await build({targets:Platform.WINDOWS.createTarget([target],Arch.x64),publish:'never'});
}
