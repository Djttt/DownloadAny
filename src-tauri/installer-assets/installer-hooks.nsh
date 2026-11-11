!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Preparing LumeAny ${VERSION}..."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "LumeAny ${VERSION} is ready."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing LumeAny program files..."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "LumeAny program files were removed."
!macroend
