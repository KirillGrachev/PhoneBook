; Tauri NSIS template hooks: close a running app before install and uninstall.
; Otherwise the exe and cache files are locked by a live process, and a repeated
; install fails with "file in use" (or leaves the old version over a tray zombie).
;
; First a soft close (WM_CLOSE): the app can flush deferred configuration saves
; (flushConfigSave on beforeunload). Then a forced fallback if the window did not
; close itself. Both commands are safe when the app is not running: a non-zero
; exit code is ignored.

; The final-page checkbox text is Russian because this installer is ru-RU.
!define MUI_FINISHPAGE_RUN_TEXT "Запустить KMAruda PhoneBook"

!macro NSIS_HOOK_PREINIT
  ; Instead of the stock "Nullsoft Install System v3.11" footer, use the product
  ; name: installer pages should show the product, not NSIS.
  BrandingText "KMAruda Phonebook · (c) КМАруда, 2026"
  ; Company in the file version-info ("Details" in properties).
  ; This does not affect the UAC publisher: that comes only from the signature.
  VIAddVersionKey "CompanyName" "КМАруда"
!macroend

!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /IM "KMAruda Phonebook.exe"'
  Pop $0
  Sleep 1500
  nsExec::ExecToLog 'taskkill /F /IM "KMAruda Phonebook.exe"'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /IM "KMAruda Phonebook.exe"'
  Pop $0
  Sleep 1500
  nsExec::ExecToLog 'taskkill /F /IM "KMAruda Phonebook.exe"'
  Pop $0
!macroend
