; Report installer stages while the application's update screen stays open.
!ifndef BUILD_UNINSTALLER
Var archiUpdateStatusFile

!macro archiUpdateStatus VALUE
  ${if} $archiUpdateStatusFile != ""
    Push $0
    FileOpen $0 "$archiUpdateStatusFile" w
    FileWrite $0 "${VALUE}"
    FileClose $0
    Pop $0
    ClearErrors
  ${endif}
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
