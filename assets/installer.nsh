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
    ReadEnvStr $archiUpdateStatusFile "ARCHI_UPDATE_STATUS_FILE"
    !insertmacro archiUpdateStatus "applying"
  ${endif}
!macroend

!macro customInstall
  !insertmacro archiUpdateStatus "complete"
!macroend

  Function .onInstFailed
    !insertmacro archiUpdateStatus "error"
  FunctionEnd
!endif
