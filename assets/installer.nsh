; Report installer stages while the application's update screen stays open.
!ifndef BUILD_UNINSTALLER
!define MUI_CUSTOMFUNCTION_ABORT archiOnUserAbort
!include "${PROJECT_DIR}\.cache\runtime-package\size.nsh"
!ifdef APP_64_UNPACKED_SIZE
  !define /redef /math APP_64_UNPACKED_SIZE ${APP_64_UNPACKED_SIZE} + ${ARCHI_RUNTIME_KIB}
!endif
!ifdef ESTIMATED_SIZE
  !define /redef /math ESTIMATED_SIZE ${ESTIMATED_SIZE} + ${ARCHI_RUNTIME_INSTALLED_KIB}
!endif
Var archiUpdateStatusFile
Var archiRuntimeBackup
Var archiRuntimeResult

!macro archiUpdateStatus VALUE
  Push $0
  ; The include is loaded before LogicLib: use only native instructions here.
  StrCmp $archiUpdateStatusFile "" +5
  FileOpen $0 "$archiUpdateStatusFile" w
  FileWrite $0 "${VALUE}"
  FileClose $0
  ClearErrors
  Pop $0
!macroend

!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\runtime-helper.exe "${PROJECT_DIR}\.cache\update-helper\runtime-helper.exe"
  File /oname=$PLUGINSDIR\runtime-manifest.json "${PROJECT_DIR}\.cache\runtime-package\manifest.json"
  ${if} ${isUpdated}
    ${if} ${UAC_IsInnerInstance}
      ; RunAs does not inherit the environment set by the running app.
      !insertmacro UAC_AsUser_GetGlobal $archiUpdateStatusFile $archiUpdateStatusFile
    ${else}
      ReadEnvStr $archiUpdateStatusFile "ARCHI_UPDATE_STATUS_FILE"
    ${endif}
    !insertmacro archiUpdateStatus "applying"
    ${if} ${Silent}
      ; The unelevated outer installer must leave per-machine files to its
      ; elevated inner instance. Both run this initialization hook.
      ${if} $hasPerMachineInstallation == "1"
      ${andIfNot} ${UAC_IsAdmin}
        Goto archiRuntimePrepared
      ${endif}
      ; Keep the builder's shutdown check in its install section. Reuse is an
      ; optional fast path and must not move a still-running application's files.
      nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
      Pop $0
      ${if} $0 == 0
        Goto archiRuntimePrepared
      ${endif}
      StrCpy $0 1
      ExecWait '"$PLUGINSDIR\runtime-helper.exe" verify "$PLUGINSDIR\runtime-manifest.json" "$INSTDIR\resources\runtime"' $0
      ${if} $0 == 0
        ; Reserve a sibling on the installation volume: directory rename must
        ; stay atomic even when Windows TEMP is on a different drive.
        ${GetParent} "$INSTDIR" $1
        ClearErrors
        GetTempFileName $archiRuntimeBackup "$1"
        ${ifNot} ${Errors}
          Delete "$archiRuntimeBackup"
          CreateDirectory "$archiRuntimeBackup"
          ${ifNot} ${Errors}
            Rename "$INSTDIR\resources\runtime" "$archiRuntimeBackup\runtime"
          ${endif}
          ${if} ${Errors}
            RMDir "$archiRuntimeBackup"
            StrCpy $archiRuntimeBackup ""
          ${endif}
        ${else}
          StrCpy $archiRuntimeBackup ""
        ${endif}
        ClearErrors
      ${endif}
    ${endif}
  ${endif}
  archiRuntimePrepared:
!macroend

!macro customInstall
  ${if} $archiRuntimeBackup != ""
    Call archiRestoreRuntime
    ${if} $archiRuntimeBackup != ""
      !insertmacro archiUpdateStatus "error"
      SetErrorLevel 2
      Abort "$(decompressionFailed)"
    ${endif}
    StrCpy $archiRuntimeResult "reused"
  ${else}
    SetOutPath "$INSTDIR\resources\runtime"
    Nsis7z::Extract "$INSTDIR\resources\runtime.7z"
    SetOutPath "$INSTDIR"
    StrCpy $0 1
    ExecWait '"$PLUGINSDIR\runtime-helper.exe" verify "$PLUGINSDIR\runtime-manifest.json" "$INSTDIR\resources\runtime"' $0
    ${if} $0 != 0
      !insertmacro archiUpdateStatus "error"
      SetErrorLevel 2
      Abort "$(decompressionFailed)"
    ${endif}
    StrCpy $archiRuntimeResult "extracted"
  ${endif}
  Delete "$INSTDIR\resources\runtime.7z"
  ${if} $archiUpdateStatusFile != ""
    FileOpen $0 "$archiUpdateStatusFile.runtime" w
    FileWrite $0 "$archiRuntimeResult"
    FileClose $0
    ClearErrors
  ${endif}
  ; The updater forces a launch after a silent installation. Keep the helper
  ; responsible for the original profile, readiness handshake and visible UI.
  ${if} $archiUpdateStatusFile != ""
    Push $0
    ${GetParent} "$archiUpdateStatusFile" $0
    IfFileExists "$0\Archi Helper Update.exe" 0 +2
      StrCpy $launchLink "$0\Archi Helper Update.exe"
    Pop $0
  ${endif}
!macroend

  Function archiRestoreRuntime
    StrCmp $archiRuntimeBackup "" archiRuntimeRestoreDone
    CreateDirectory "$INSTDIR\resources"
    ClearErrors
    Rename "$archiRuntimeBackup\runtime" "$INSTDIR\resources\runtime"
    IfErrors archiRuntimeRestoreDone
    RMDir "$archiRuntimeBackup"
    StrCpy $archiRuntimeBackup ""
    archiRuntimeRestoreDone:
    ClearErrors
  FunctionEnd

  Function .onInstSuccess
    !insertmacro archiUpdateStatus "complete"
  FunctionEnd

  Function .onInstFailed
    Call archiRestoreRuntime
    !insertmacro archiUpdateStatus "error"
  FunctionEnd

  Function archiOnUserAbort
    Call archiRestoreRuntime
    !insertmacro archiUpdateStatus "error"
  FunctionEnd
!endif
