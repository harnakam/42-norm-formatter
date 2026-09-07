$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'tests\cases\manifest.json'
$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$username = 'username'
$email = 'username@student.42tokyo.jp'
$failures = New-Object System.Collections.Generic.List[string]

foreach ($case in $manifest.cases) {
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("normfmt-" + [System.Guid]::NewGuid().ToString())
    $tempFile = Join-Path $tempDir ([System.IO.Path]::GetFileName($case.file))
    try {
        New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
        $formatArgs = @(
            (Join-Path $root 'scripts\format-case.js'),
            '--file', (Join-Path $root $case.file),
            '--output', $tempFile,
            '--username', $username,
            '--email', $email
        )
        if ($case.headerEnabled -eq $false) {
            $formatArgs += '--no-header'
        }
        if ($case.unsafe -eq $true) {
            $formatArgs += '--unsafe'
        }
        if ($case.transforms -and $case.transforms.stripFunctionComments -eq $true) {
            $formatArgs += '--strip-function-comments'
        }
        if ($case.transforms -and $case.transforms.wrapSingleStatementBodies -eq $true) {
            $formatArgs += '--wrap-single-statement-bodies'
        }
        if ($case.transforms -and $case.transforms.splitMultiInstructions -eq $true) {
            $formatArgs += '--split-multi-instructions'
        }
        if ($case.transforms -and $case.transforms.splitDeclarationAssignment -eq $true) {
            $formatArgs += '--split-declaration-assignment'
        }
        if ($case.transforms -and $case.transforms.hoistDeclarationsToFunctionTop -eq $true) {
            $formatArgs += '--hoist-declarations-to-function-top'
        }
        if ($case.transforms -and $case.transforms.rewriteForToWhile -eq $true) {
            $formatArgs += '--rewrite-for-to-while'
        }

        & node @formatArgs
        if ($LASTEXITCODE -ne 0) {
            $failures.Add("$($case.name): formatter exited with code $LASTEXITCODE")
            continue
        }

        $formatted = Get-Content -Path $tempFile -Raw

        if ($case.expectContains) {
            foreach ($needle in $case.expectContains) {
                if ($formatted -notmatch [regex]::Escape($needle)) {
                    $failures.Add("$($case.name): formatted output is missing '$needle'")
                }
            }
        }

        if ($case.expectNotContains) {
            foreach ($needle in $case.expectNotContains) {
                if ($formatted -match [regex]::Escape($needle)) {
                    $failures.Add("$($case.name): formatted output unexpectedly contains '$needle'")
                }
            }
        }

        if ($case.expectCreated) {
            $createdText = "Created: $($case.expectCreated) by $username"
            if ($formatted -notmatch [regex]::Escape($createdText)) {
                $failures.Add("$($case.name): Created timestamp was not preserved")
            }
        }

        $payloadRaw = python (Join-Path $root 'python\norm_runner.py') $tempFile
        if ($LASTEXITCODE -ne 0) {
            $failures.Add("$($case.name): runner exited with code $LASTEXITCODE")
            continue
        }

        $payload = $payloadRaw | ConvertFrom-Json
        $actual = @($payload.files[0].errors | Where-Object { $_.level -ne 'Notice' } | ForEach-Object { $_.name } | Sort-Object)
        $expected = @($case.expectedErrors | Sort-Object)

        if (($actual -join ',') -ne ($expected -join ',')) {
            $failures.Add("$($case.name): expected [$($expected -join ', ')] but got [$($actual -join ', ')]")
        }
    }
    finally {
        if (Test-Path $tempDir) {
            Remove-Item $tempDir -Recurse -Force
        }
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host "Smoke tests passed: $($manifest.cases.Count) case(s)."
