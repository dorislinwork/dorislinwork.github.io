@echo off
rem Thin ASCII-only shim. All logic lives in tools/admin.mjs because
rem cmd.exe reads .cmd files in the system ANSI codepage and mangles UTF-8.
rem Opens the local admin panel in your browser. Ctrl+C in this window stops it.
node "%~dp0tools\admin.mjs" %*
exit /b %errorlevel%
