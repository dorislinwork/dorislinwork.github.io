@echo off
rem Thin ASCII-only shim. All logic lives in tools/publish.mjs because
rem cmd.exe reads .cmd files in the system ANSI codepage and mangles UTF-8.
node "%~dp0tools\publish.mjs" %*
exit /b %errorlevel%
