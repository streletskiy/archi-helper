; Report installer stages while the application's update screen stays open.
!ifndef BUILD_UNINSTALLER
Var archiUpdateStatusFile

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
  ${if} ${isUpdated}
    ${if} ${UAC_IsInnerInstance}
      ; RunAs does not inherit the environment set by the running app.
      !insertmacro UAC_AsUser_GetGlobal $archiUpdateStatusFile $archiUpdateStatusFile
    ${else}
      ReadEnvStr $archiUpdateStatusFile "ARCHI_UPDATE_STATUS_FILE"
    ${endif}
    !insertmacro archiUpdateStatus "applying"
  ${endif}
!macroend

!macro customInstall
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

  Function .onInstSuccess
    !insertmacro archiUpdateStatus "complete"
  FunctionEnd

  Function .onInstFailed
    !insertmacro archiUpdateStatus "error"
  FunctionEnd
!endif
