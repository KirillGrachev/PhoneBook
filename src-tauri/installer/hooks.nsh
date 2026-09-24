; Хуки NSIS-шаблона Tauri: закрываем запущенное приложение до установки
; и удаления. Без этого exe и файлы кэша залочены живым процессом, и
; повторная установка падает ошибкой «файл используется» (или оставляет
; старую версию поверх трей-зомби).
;
; Сначала мягкое завершение (WM_CLOSE): приложение успевает сбросить
; отложенное сохранение конфигурации (flushConfigSave на beforeunload).
; Затем страховочное жёсткое — если окно не закрылось само. Обе команды
; безопасны при незапущенном приложении: ненулевой код игнорируется.

!macro NSIS_HOOK_PREINIT
  ; Вместо стоковой строки футера «Nullsoft Install System v3.11» —
  ; наш нейминг: футер страниц установщика показывает продукт, а не NSIS.
  BrandingText "KMAruda Phonebook · (c) КМАруда, 2026"
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
