$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$displayName = 'KMAruda PhoneBook'
$productCode = $null
$uninstallRoot = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'

Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object {
    $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
    if ($item.DisplayName -eq $displayName) {
        $productCode = $_.PSChildName
    }
}

if (-not $productCode) {
    [System.Windows.Forms.MessageBox]::Show(
        'Не удалось найти установленный KMAruda PhoneBook.',
        'KMAruda PhoneBook',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Удаление KMAruda PhoneBook'
$form.ClientSize = New-Object System.Drawing.Size(480, 220)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Удалить KMAruda PhoneBook?'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(18, 16)
$title.Size = New-Object System.Drawing.Size(440, 26)

$description = New-Object System.Windows.Forms.Label
$description.Text = 'Программа будет удалена с этого компьютера.'
$description.Location = New-Object System.Drawing.Point(20, 50)
$description.Size = New-Object System.Drawing.Size(440, 20)

$deleteDataCheckBox = New-Object System.Windows.Forms.CheckBox
$deleteDataCheckBox.Text = 'Удалить данные приложения (настройки, кэш и пароли LDAP)'
$deleteDataCheckBox.Location = New-Object System.Drawing.Point(20, 82)
$deleteDataCheckBox.Size = New-Object System.Drawing.Size(440, 24)
$deleteDataCheckBox.Checked = $false

$note = New-Object System.Windows.Forms.Label
$note.Text = 'Если галочка не отмечена, настройки и кэш останутся на компьютере.'
$note.ForeColor = [System.Drawing.Color]::DimGray
$note.Location = New-Object System.Drawing.Point(20, 112)
$note.Size = New-Object System.Drawing.Size(440, 36)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = 'Удалить'
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$okButton.Location = New-Object System.Drawing.Point(250, 176)
$okButton.Size = New-Object System.Drawing.Size(100, 28)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Отмена'
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancelButton.Location = New-Object System.Drawing.Point(360, 176)
$cancelButton.Size = New-Object System.Drawing.Size(100, 28)

$form.Controls.AddRange(@($title, $description, $deleteDataCheckBox, $note, $okButton, $cancelButton))
$form.AcceptButton = $okButton
$form.CancelButton = $cancelButton

if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    $form.Dispose()
    exit 0
}

$removeData = $deleteDataCheckBox.Checked
$form.Dispose()

$arguments = @('/x', $productCode)
if ($removeData) {
    $arguments += 'DELETEAPPDATA=1'
}

try {
    Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Verb RunAs -Wait
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        "Не удалось запустить удаление: $($_.Exception.Message)",
        'KMAruda PhoneBook',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

exit 0
