# verify.ps1 - jalankan di root repo ShiniTrack (PowerShell). Ringkasan PASS/FAIL ada di akhir.
# Pemakaian: .\verify.ps1            (bandingkan dengan cabang main)
#            .\verify.ps1 -Base abc123
param([string]$Base = "main")

$ErrorActionPreference = "Continue"
$report = Join-Path (Get-Location) "verify-report.txt"
"VERIFY REPORT $(Get-Date -Format s)" | Out-File $report -Encoding utf8
$results = [ordered]@{}

function Log([string]$t) { $t | Tee-Object -FilePath $report -Append }

function Step([string]$name, [scriptblock]$sb, [bool]$gate = $true) {
    Log ""
    Log "=== $name ==="
    $global:LASTEXITCODE = 0
    $o = & $sb 2>&1 | Out-String
    $code = $LASTEXITCODE
    $lines = $o -split "`r?`n"
    Log (($lines | Select-Object -Last 40) -join "`n")
    Log "EXIT CODE: $code"
    if ($gate) { $results[$name] = $(if ($code -eq 0) { "PASS" } else { "FAIL" }) }
}

Step "Cabang dan commit" { git branch --show-current; git log --oneline -15 } $false
Step "File liar di working tree" { git status --short } $false
Step "Diff ringkas vs $Base" { git diff --stat "$Base...HEAD" } $false

Step "1 ESLint (variabel tak dideklarasi + sintaks) seluruh app/ui/js" {
    npx --yes eslint@8 --no-eslintrc --env browser,es2022 --global Icons --parser-options=ecmaVersion:2022 --parser-options=sourceType:module --rule '{"no-undef":"error"}' app/ui/js
}
Step "2 cargo check --workspace --all-targets" { cargo check --workspace --all-targets }
Step "3 cargo test --workspace --no-fail-fast" { cargo test --workspace --no-fail-fast }
Step "4 Build Android debug (cargo tauri android build --debug --apk -t aarch64)" {
    # Perintah yang sama dengan CI (.github/workflows/release.yml) tetapi --debug agar tidak butuh keystore rilis.
    # Gradle TIDAK boleh dijalankan langsung: Tauri CLI harus yang memulainya.
    cargo tauri android build --debug --apk -t aarch64
}

Step "5 Stub / kode belum jadi pada baris yang ditambahkan" {
    $pattern = '^\+.*(un' + 'implemented!|to' + 'do!|TO' + 'DO|FIX' + 'ME)'
    $hits = git diff "$Base...HEAD" -U0 | Select-String -Pattern $pattern
    $hits
    if ($hits) { cmd /c "exit 1" } else { cmd /c "exit 0" }
}
Step "6 File sampah ter-commit" {
    $junk = git ls-files | Select-String -Pattern '(^|/)(T\d+_.*\.(txt|md)|fix_.*\.py|update_.*\.py|msg\.txt|all_files\.txt)$'
    $junk
    if ($junk) { cmd /c "exit 1" } else { cmd /c "exit 0" }
}

git diff "$Base...HEAD" -- . ":(exclude)Cargo.lock" | Out-File (Join-Path (Get-Location) "review.patch") -Encoding utf8

Log ""
Log "================ RINGKASAN ================"
foreach ($k in $results.Keys) { Log ("{0,-6} {1}" -f $results[$k], $k) }
$fails = ($results.Values | Where-Object { $_ -eq "FAIL" }).Count
if ($fails -eq 0) { Log "HASIL AKHIR: SEMUA PASS" } else { Log "HASIL AKHIR: $fails LANGKAH GAGAL - JANGAN COMMIT" }
Log "File: verify-report.txt, review.patch"
