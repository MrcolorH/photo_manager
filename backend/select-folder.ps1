Add-Type -AssemblyName System.Windows.Forms
$folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
$result = $folderBrowser.ShowDialog()
if ($result -eq 'OK') {
    Write-Output $folderBrowser.SelectedPath
} else {
    Write-Output ""
}
